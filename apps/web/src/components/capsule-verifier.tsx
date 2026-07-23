"use client";

import type { ProofVerificationReceipt } from "@runbook/capsule-browser";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Check,
  Clipboard,
  Download,
  FileArchive,
  FileCheck2,
  FileWarning,
  Fingerprint,
  LoaderCircle,
  LockKeyhole,
  Network,
  RadioTower,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "./brand-mark";
import { CapsuleVerifierClient, CapsuleVerifierClientError } from "../lib/capsule-verifier-client";
import {
  BROWSER_FIXTURES,
  decodeBrowserFixture,
  downloadBrowserFixture,
} from "../lib/browser-fixtures";
import {
  validateCapsuleSelection,
  type CapsuleWorkerStage,
} from "../lib/capsule-worker-protocol";
import styles from "./capsule-verifier.module.css";

type Capability = "checking" | "ready" | "unavailable";
type Guide = "golden" | "tampered" | null;
type CopyState = "idle" | "copied" | "failed";

type VerifierState =
  | { kind: "idle" }
  | { kind: "working"; stage: CapsuleWorkerStage }
  | { kind: "receipt"; receipt: ProofVerificationReceipt; receiptBytes: Uint8Array; archiveSha256: string }
  | { kind: "environment-error"; code: string };

const assuranceRows = [
  ["transportProfile", "Transport profile", "Deterministic ZIP structure and limits"],
  ["packageIntegrity", "Package integrity", "Signed manifest and exact member bytes"],
  ["authorSignature", "Author signature", "Control of the included self-asserted key"],
  ["authorIdentity", "Author identity", "Identity is not independently established"],
  ["independentTime", "Independent time", "No trusted timestamp is inferred"],
  ["brokerIssuance", "Broker issuance", "No broker attestation is inferred"],
  ["brokerExecution", "Broker execution", "No execution is inferred"],
  ["recordCompleteness", "Record completeness", "Omitted activity is not ruled out"],
  ["investmentSkill", "Investment skill", "Performance or skill is not evaluated"],
  ["suitabilityOrCompliance", "Suitability / compliance", "Not legal or investing advice"],
] as const;

const environmentMessages: Record<string, string> = {
  "crypto.unavailable": "This browser cannot run the required Ed25519 verification. Use the offline CLI instead; the capsule has not been judged invalid.",
  "crypto.operation-failed": "The browser cryptography operation failed. No capsule verdict was produced.",
  "input.empty": "Choose a non-empty .runbook file.",
  "input.size-limit": "The selected file exceeds the 64 MiB browser verification limit.",
  "input.read-failed": "The browser could not read the complete local file.",
  "worker.failure": "The isolated verifier stopped before it could produce a receipt.",
  "worker.timeout": "Verification exceeded the local time limit and the isolated verifier was stopped.",
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function humanStatus(value: string) {
  return value.replaceAll("-", " ");
}

export function CapsuleVerifier() {
  const client = useRef<CapsuleVerifierClient | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const resultHeading = useRef<HTMLHeadingElement | null>(null);
  const [capability, setCapability] = useState<Capability>("checking");
  const [state, setState] = useState<VerifierState>({ kind: "idle" });
  const [guide, setGuide] = useState<Guide>(null);
  const [dragActive, setDragActive] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => {
    const verifier = new CapsuleVerifierClient();
    client.current = verifier;
    let active = true;
    void verifier.initialize()
      .then((error) => {
        if (!active) return;
        if (error) {
          setCapability("unavailable");
          setState({ kind: "environment-error", code: error.code });
        } else {
          setCapability("ready");
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof CapsuleVerifierClientError && error.code === "worker.cancelled") return;
        setCapability("unavailable");
        setState({
          kind: "environment-error",
          code: error instanceof CapsuleVerifierClientError ? error.code : "worker.failure",
        });
      });
    return () => {
      active = false;
      verifier.dispose();
      client.current = null;
    };
  }, []);

  useEffect(() => {
    if (state.kind === "receipt" || state.kind === "environment-error") resultHeading.current?.focus();
  }, [state.kind]);

  async function verifyCapsule(capsule: Blob) {
    const selectionError = validateCapsuleSelection(capsule.size);
    if (selectionError) {
      setState({ kind: "environment-error", code: selectionError });
      setCopyState("idle");
      return;
    }
    const verifier = client.current;
    if (!verifier) {
      setState({ kind: "environment-error", code: "worker.failure" });
      return;
    }
    setCopyState("idle");
    setState({ kind: "working", stage: "reading" });
    try {
      // Blob deliberately strips the local filename before it crosses the Worker boundary.
      const outcome = await verifier.verify(
        capsule.slice(0, capsule.size, "application/octet-stream"),
        (stage) => setState({ kind: "working", stage }),
      );
      if (outcome.kind === "environment-error") {
        setState({ kind: "environment-error", code: outcome.code });
        if (outcome.code.startsWith("crypto.")) setCapability("unavailable");
        return;
      }
      setCapability("ready");
      setState({
        kind: "receipt",
        receipt: outcome.receipt,
        receiptBytes: new Uint8Array(outcome.receiptBytes),
        archiveSha256: outcome.archiveSha256,
      });
    } catch (error) {
      if (error instanceof CapsuleVerifierClientError && error.code === "worker.cancelled") return;
      setState({
        kind: "environment-error",
        code: error instanceof CapsuleVerifierClientError ? error.code : "worker.failure",
      });
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function runGuide(nextGuide: Exclude<Guide, null>) {
    setGuide(nextGuide);
    setState({ kind: "idle" });
    setCopyState("idle");
    const bytes = decodeBrowserFixture(nextGuide);
    void verifyCapsule(new Blob([bytes], { type: "application/vnd.runbook.proof+zip" }));
  }

  async function copyReceipt() {
    if (state.kind !== "receipt") return;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(state.receiptBytes);
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  function downloadReceipt() {
    if (state.kind !== "receipt") return;
    const receiptArrayBuffer = state.receiptBytes.slice().buffer as ArrayBuffer;
    const blob = new Blob([receiptArrayBuffer], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stem = state.receipt.capsuleId?.slice(0, 12) ?? "unresolved";
    anchor.href = url;
    anchor.download = `runbook-${stem}-receipt.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const receipt = state.kind === "receipt" ? state.receipt : null;
  const guideMatches = guide === null || state.kind !== "receipt"
    ? null
    : state.archiveSha256 === BROWSER_FIXTURES[guide].sha256
      && (guide === "golden" ? state.receipt.valid : !state.receipt.valid);

  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="Capsule verifier navigation">
        <Link className={styles.brand} href="/proof-capsule" aria-label="Back to Runbook Proof Capsule">
          <BrandMark />
          <span>Runbook</span>
          <em>evidence relay</em>
        </Link>
        <div className={styles.navLinks}>
          <Link className={styles.backLink} href="/lineage"><Network size={14} aria-hidden="true" /> Lineage Atlas</Link>
          <Link className={styles.backLink} href="/proof-capsule"><ArrowLeft size={14} aria-hidden="true" /> Proof Capsule</Link>
        </div>
      </nav>

      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <span className={styles.kicker}><RadioTower size={14} /> Browser-local capsule verification</span>
          <h1>Move evidence.<br /><em>Not trust.</em></h1>
          <p>Select one <code>.runbook</code> capsule. Its bytes cross only into an isolated browser Worker, then return as a deterministic verification receipt.</p>
        </div>
        <div className={styles.boundaryCard}>
          <span>Verification boundary</span>
          <strong>Local browser memory</strong>
          <ul>
            <li><LockKeyhole size={13} /> No server upload path</li>
            <li><Network size={13} /> No online evidence checks</li>
            <li><Ban size={13} /> No payload rendering or storage</li>
          </ul>
          <p>The served verifier origin and browser remain trusted computing components.</p>
        </div>
      </header>

      <section className={styles.relay} aria-labelledby="relay-title">
        <div className={styles.relayHeading}>
          <div><span>Evidence relay / one-way inspection</span><h2 id="relay-title">Capsule in. Receipt out.</h2></div>
          <CapabilityBadge capability={capability} />
        </div>

        <div className={styles.relayTrack} data-working={state.kind === "working" ? "true" : "false"}>
          <div className={styles.relayNode}><FileArchive size={20} /><span>01</span><strong>Local capsule</strong><small>Opaque bytes</small></div>
          <div className={styles.trackLine}><i /><span>NO UPLOAD</span></div>
          <div className={styles.relayNode}><ShieldCheck size={20} /><span>02</span><strong>Isolated verifier</strong><small>{state.kind === "working" ? humanStatus(state.stage) : "Bounded Worker"}</small></div>
          <div className={styles.trackLine}><i /><span>JCS BYTES</span></div>
          <div className={styles.relayNode}><Fingerprint size={20} /><span>03</span><strong>Exact receipt</strong><small>No added newline</small></div>
        </div>

        <div
          className={`${styles.dropZone} ${dragActive ? styles.dropActive : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDragActive(false); }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            const file = event.dataTransfer.files[0];
            if (file) void verifyCapsule(file);
          }}
        >
          <input
            ref={fileInput}
            id="capsule-file"
            className={styles.fileInput}
            type="file"
            accept=".runbook,application/vnd.runbook.proof+zip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void verifyCapsule(file);
            }}
          />
          <UploadCloud size={25} aria-hidden="true" />
          <div><strong>Drop one capsule here</strong><span>or choose a local file · 1 byte–64 MiB</span></div>
          <label className={styles.chooseButton} htmlFor="capsule-file">Choose .runbook</label>
        </div>
      </section>

      <section className={styles.guides} aria-labelledby="guided-title">
        <div className={styles.sectionLabel}><span>Synthetic guided checks</span><h2 id="guided-title">Prove both sides of the gate.</h2></div>
        <GuideCard
          active={guide === "golden"}
          icon={<FileCheck2 size={20} />}
          label="Golden fixture"
          expectation="Expected: valid"
          detail="Run minimal-synthetic-root.runbook from the frozen embedded corpus."
          onChoose={() => runGuide("golden")}
          onDownload={() => downloadBrowserFixture("golden")}
        />
        <GuideCard
          active={guide === "tampered"}
          icon={<FileWarning size={20} />}
          label="Tampered twin"
          expectation="Expected: invalid"
          detail="Choose the one-byte payload mutation. Its author signature remains valid while package integrity fails."
          onChoose={() => runGuide("tampered")}
          onDownload={() => downloadBrowserFixture("tampered")}
        />
      </section>

      <section className={styles.output} aria-labelledby="output-title" aria-live="polite">
        <div className={styles.outputHeading}>
          <div><span>Normative output</span><h2 ref={resultHeading} tabIndex={-1} id="output-title">Verification receipt</h2></div>
          {state.kind === "working" ? <div className={styles.working}><LoaderCircle size={15} /> {humanStatus(state.stage)}</div> : null}
        </div>

        {state.kind === "idle" ? <EmptyReceipt /> : null}
        {state.kind === "working" ? <WorkingReceipt stage={state.stage} /> : null}
        {state.kind === "environment-error" ? <EnvironmentFailure code={state.code} /> : null}
        {receipt ? (
          <div className={styles.receiptBody}>
            <div className={`${styles.verdict} ${receipt.valid ? styles.verdictValid : styles.verdictInvalid}`}>
              {receipt.valid ? <BadgeCheck size={25} /> : <ShieldAlert size={25} />}
              <div>
                <span>{receipt.valid ? "CAPSULE VALID" : "CAPSULE INVALID"}</span>
                <strong>{receipt.valid ? "The signed package passed this draft profile." : "At least one required verification stage failed."}</strong>
              </div>
              <em>{receipt.errors.length} errors · {receipt.warnings.length} warnings</em>
            </div>

            {guideMatches !== null ? (
              <div className={`${styles.guideResult} ${guideMatches ? styles.guidePass : styles.guideMismatch}`}>
                {guideMatches ? <Check size={14} /> : <X size={14} />}
                {guideMatches ? "Result matches the selected synthetic guide." : "Result does not match the selected guide. Confirm that you chose the intended frozen fixture."}
              </div>
            ) : null}

            <div className={styles.identityStrip}>
              <div><span>Archive SHA-256 · non-normative transport context</span><code>{state.kind === "receipt" ? state.archiveSha256 : "not evaluated"}</code></div>
              <div><span>Capsule ID</span><code>{receipt.capsuleId ?? "not evaluated"}</code></div>
              <div><span>Author key</span><code>{receipt.authorKeyId ?? "not evaluated"}</code></div>
              <div><span>Lineage</span><strong>{receipt.lineage.status}</strong></div>
            </div>

            <div className={styles.receiptGrid}>
              <section className={styles.assurancePanel} aria-labelledby="assurance-receipt-title">
                <div className={styles.panelHeading}><span>Assurance matrix</span><h3 id="assurance-receipt-title">What was actually evaluated</h3></div>
                <div className={styles.assuranceList}>
                  {assuranceRows.map(([key, label, detail]) => {
                    const value = receipt.assurance[key];
                    const positive = value === "valid" || value === "self-asserted-key";
                    return <div key={key}><i data-positive={positive ? "true" : "false"} /><div><strong>{label}</strong><small>{detail}</small></div><code>{humanStatus(value)}</code></div>;
                  })}
                </div>
              </section>

              <section className={styles.issuePanel} aria-labelledby="issues-title">
                <div className={styles.panelHeading}><span>Diagnostic channel</span><h3 id="issues-title">Errors and warnings</h3></div>
                {receipt.errors.length === 0 && receipt.warnings.length === 0 ? (
                  <p className={styles.noIssues}><Check size={14} /> No normative errors or warnings.</p>
                ) : (
                  <div className={styles.issueList}>
                    {receipt.errors.map((issue) => <div className={styles.errorIssue} key={`e-${issue.code}-${issue.path ?? ""}`}><ShieldAlert size={14} /><code>{issue.code}</code><span>{issue.path ?? "capsule"}</span></div>)}
                    {receipt.warnings.map((issue) => <div className={styles.warningIssue} key={`w-${issue.code}-${issue.path ?? ""}`}><ShieldAlert size={14} /><code>{issue.code}</code><span>{issue.path ?? "capsule"}</span></div>)}
                  </div>
                )}
                <div className={styles.limitations}>
                  <strong>Fixed limitations</strong>
                  <ul>{receipt.limitations.map((limit) => <li key={limit}>{humanStatus(limit)}</li>)}</ul>
                </div>
              </section>
            </div>

            <section className={styles.memberPanel} aria-labelledby="members-title">
              <div className={styles.panelHeading}><span>Bound member graph</span><h3 id="members-title">{receipt.members.length} archive members evaluated</h3></div>
              <div className={styles.memberTable} role="table" aria-label="Capsule member verification status">
                <div className={styles.memberHeader} role="row"><span role="columnheader">Path</span><span role="columnheader">Bytes</span><span role="columnheader">SHA-256</span><span role="columnheader">Status</span></div>
                {receipt.members.map((member) => <div className={styles.memberRow} role="row" key={member.path}><code role="cell">{member.path}</code><span role="cell">{formatBytes(member.bytes)}</span><code role="cell">{member.sha256}</code><strong role="cell" data-status={member.status}>{humanStatus(member.status)}</strong></div>)}
              </div>
            </section>

            <div className={styles.receiptActions}>
              <button type="button" onClick={() => void copyReceipt()}><Clipboard size={15} /> {copyState === "copied" ? "Exact receipt copied" : "Copy exact JCS"}</button>
              <button type="button" onClick={downloadReceipt}><Download size={15} /> Download receipt</button>
              <span>{state.kind === "receipt" ? formatBytes(state.receiptBytes.byteLength) : ""} · no trailing newline</span>
            </div>
            {copyState === "failed" ? <p className={styles.copyFailure}>Clipboard access failed. The receipt was not stored elsewhere.</p> : null}
          </div>
        ) : null}
      </section>

      <footer className={styles.footer}>
        <strong>A valid signature is a narrow fact.</strong>
        <p>It does not prove identity, independent time, broker issuance, execution, record completeness, investment skill, suitability, or compliance.</p>
      </footer>
    </main>
  );
}

function CapabilityBadge({ capability }: { capability: Capability }) {
  return <div className={styles.capability} data-state={capability}>{capability === "checking" ? <LoaderCircle size={14} /> : capability === "ready" ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}<span>{capability === "checking" ? "Checking browser" : capability === "ready" ? "Verifier ready" : "Verifier unavailable"}</span></div>;
}

function GuideCard({ active, icon, label, expectation, detail, onChoose, onDownload }: { active: boolean; icon: React.ReactNode; label: string; expectation: string; detail: string; onChoose: () => void; onDownload: () => void }) {
  return <article className={styles.guideCard} data-active={active ? "true" : "false"}><div className={styles.guideIcon}>{icon}</div><div><span>{expectation}</span><h3>{label}</h3><p>{detail}</p></div><div className={styles.guideActions}><button type="button" onClick={onChoose}>Run embedded fixture</button><button type="button" onClick={onDownload}><Download size={13} /> Download exact fixture</button></div></article>;
}

function EmptyReceipt() {
  return <div className={styles.empty}><Fingerprint size={27} /><strong>No capsule evaluated</strong><span>Select a local file or run one of the synthetic guided checks.</span></div>;
}

function WorkingReceipt({ stage }: { stage: CapsuleWorkerStage }) {
  return <div className={styles.empty}><LoaderCircle className={styles.spin} size={27} /><strong>{humanStatus(stage)} capsule</strong><span>The isolated Worker is processing bounded local bytes.</span></div>;
}

function EnvironmentFailure({ code }: { code: string }) {
  return <div className={styles.environmentFailure}><ShieldAlert size={24} /><div><span>ENVIRONMENT — NO VERDICT</span><strong>{environmentMessages[code] ?? environmentMessages["worker.failure"]}</strong><code>{code}</code></div></div>;
}
