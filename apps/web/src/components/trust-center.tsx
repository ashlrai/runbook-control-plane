"use client";

import { useRef, useState } from "react";
import {
  BadgeCheck,
  Check,
  ClipboardCheck,
  FileJson2,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "./app-shell";
import { fingerprintPayload } from "@/lib/runbook";
import {
  buildVerificationReceipt,
  buildSyntheticCloneShell,
  inspectPublicSnapshot,
  MAX_PASTED_ARTIFACT_BYTES,
  pastedArtifactSizeError,
  type SnapshotInspection,
} from "@/lib/proof-verifier";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const sampleArtifact = JSON.stringify({
  schemaVersion: "runbook.public-snapshot.v1",
  generatedAt: "2026-07-21T15:00:00.000Z",
  experimentId: "RUN-SYNTHETIC-PROOF-001",
  sourceLedger: {
    validAtExport: true,
    eventCount: 2,
    headHash: hashB,
    assurance: "local-tamper-evidence-only",
  },
  projection: {
    privacy: "metadata-only",
    independentlyVerifiable: false,
    note: "Filtered metadata projection; verify against the trusted source ledger head.",
  },
  events: [
    { sequence: 1, type: "experiment.created", occurredAt: "2026-07-21T14:00:00.000Z", hash: hashA },
    { sequence: 2, type: "charter.activated", occurredAt: "2026-07-21T14:05:00.000Z", hash: hashB },
  ],
}, null, 2);

type VerifiedState =
  | { valid: false; inspection: Extract<SnapshotInspection, { valid: false }> }
  | { valid: true; inspection: Extract<SnapshotInspection, { valid: true }>; fingerprint: string };

export function TrustCenter() {
  const [artifactText, setArtifactText] = useState(sampleArtifact);
  const [result, setResult] = useState<VerifiedState | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "receipt-copied" | "clone-copied" | "error">("idle");
  const generation = useRef(0);

  async function verifyArtifact() {
    const source = artifactText;
    const currentGeneration = ++generation.current;
    setCopyState("idle");
    try {
      const sizeError = pastedArtifactSizeError(source);
      if (sizeError) {
        setResult({ valid: false, inspection: { valid: false, errors: [sizeError] } });
        return;
      }
      const inspection = inspectPublicSnapshot(JSON.parse(source) as unknown);
      if (!inspection.valid) {
        setResult({ valid: false, inspection });
        return;
      }
      const fingerprint = await fingerprintPayload(source);
      if (generation.current !== currentGeneration || artifactText !== source) return;
      setResult({ valid: true, inspection, fingerprint });
    } catch (error) {
      setResult({ valid: false, inspection: { valid: false, errors: [error instanceof Error ? error.message : "Artifact is not valid JSON."] } });
    }
  }

  async function copyReceipt() {
    if (!result?.valid) return;
    try {
      await navigator.clipboard.writeText(buildVerificationReceipt(result.inspection.snapshot, result.fingerprint));
      setCopyState("receipt-copied");
    } catch {
      setCopyState("error");
    }
  }

  async function copyCloneShell() {
    if (!result?.valid) return;
    try {
      await navigator.clipboard.writeText(buildSyntheticCloneShell(result.inspection.snapshot, result.fingerprint));
      setCopyState("clone-copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <AppShell>
      <header className="topbar builder-topbar">
        <div>
          <div className="breadcrumb">Portable proof <span>/</span> Local verification <span>/</span> Explicit assurance</div>
          <h1>Trust Center</h1>
          <p>Verify a public artifact locally—and see exactly what it still cannot prove.</p>
        </div>
        <div className="trust-mode"><KeyRound size={15} /><span>Zero credential verification</span><strong>No upload</strong></div>
      </header>

      <section className="assurance-ladder" aria-labelledby="assurance-title">
        <div className="module-heading"><div><span className="eyebrow">Never collapse these levels</span><h2 id="assurance-title">Assurance ladder</h2></div><ShieldCheck size={20} /></div>
        <div className="assurance-steps">
          <AssuranceStep rank="01" label="Schema valid" detail="Strict version and privacy projection" state="available" />
          <AssuranceStep rank="02" label="Pasted text fingerprinted" detail="SHA-256 over the browser-normalized text currently in the editor" state="available" />
          <AssuranceStep rank="03" label="Ledger valid at export" detail="Reported by the local source ledger" state="reported" />
          <AssuranceStep rank="04" label="Independent verification" detail="Requires a trusted external head or signature" state="unavailable" />
        </div>
      </section>

      <div className="trust-grid">
        <section className="artifact-input" aria-labelledby="artifact-input-title">
          <div className="module-heading"><div><span className="eyebrow">Runs in this browser</span><h2 id="artifact-input-title">Inspect a public artifact</h2></div><FileJson2 size={20} /></div>
          <div className="artifact-input-body">
            <label htmlFor="proof-artifact">Metadata-only Runbook JSON</label>
            <textarea id="proof-artifact" value={artifactText} maxLength={MAX_PASTED_ARTIFACT_BYTES} onChange={(event) => { generation.current += 1; setArtifactText(event.target.value); setResult(null); setCopyState("idle"); }} spellCheck={false} />
            <button className="button primary" type="button" onClick={verifyArtifact}><Fingerprint size={15} /> Inspect pasted text</button>
            <p><LockKeyhole size={13} /> No artifact upload or browser storage is implemented. Copying a receipt writes that receipt to your clipboard.</p>
          </div>
        </section>

        <section className="verification-result" aria-labelledby="verification-result-title" aria-live="polite">
          <div className="module-heading"><div><span className="eyebrow">Evidence, not vibes</span><h2 id="verification-result-title">Verification receipt</h2></div><ClipboardCheck size={20} /></div>
          {!result ? (
            <div className="verification-empty"><Fingerprint size={23} /><strong>No artifact inspected yet</strong><span>The included fixture is synthetic and safe to test.</span></div>
          ) : result.valid ? (
            <div className="verification-success">
              <div className="verification-status"><BadgeCheck size={22} /><div><strong>Structurally valid</strong><span>This is not a claim of independent truth.</span></div></div>
              <dl>
                <div><dt>Experiment</dt><dd>{result.inspection.snapshot.experimentId}</dd></div>
                <div><dt>Metadata events</dt><dd>{result.inspection.snapshot.events.length}</dd></div>
                <div><dt>Privacy</dt><dd>metadata only</dd></div>
                <div><dt>Independent</dt><dd>no</dd></div>
              </dl>
              <div className="fingerprint-receipt"><span>Pasted-text SHA-256</span><code>{result.fingerprint}</code></div>
              <div className="verification-checks">{result.inspection.checks.map((check) => <div key={check.id}><Check size={13} /><div><strong>{check.label}</strong><span>{check.detail}</span></div></div>)}</div>
              <div className="verification-actions">
                <button className="button ghost" type="button" onClick={copyReceipt}><ClipboardCheck size={15} />{copyState === "receipt-copied" ? "Receipt copied" : "Copy verification receipt"}</button>
                <button className="button ghost" type="button" onClick={copyCloneShell}><FileJson2 size={15} />{copyState === "clone-copied" ? "Clone shell copied" : "Copy synthetic clone shell"}</button>
              </div>
              {copyState === "error" ? <p className="verification-copy-error">Clipboard write failed. No fallback storage was used.</p> : null}
            </div>
          ) : (
            <div className="verification-failure"><ShieldAlert size={23} /><strong>Artifact rejected</strong><ul>{result.inspection.errors.slice(0, 5).map((error) => <li key={error}>{error}</li>)}</ul></div>
          )}
        </section>

        <section className="proof-boundaries" aria-labelledby="proof-boundaries-title">
          <div className="module-heading"><div><span className="eyebrow">The honest trust contract</span><h2 id="proof-boundaries-title">What this proves—and what it does not</h2></div><ShieldAlert size={20} /></div>
          <div className="proof-boundary-grid">
            <div><span>Proves locally</span><strong>Format and pasted-text receipt</strong><ul><li>Strict public schema</li><li>Metadata ordering and time consistency</li><li>Browser-normalized text fingerprint</li><li>Clone shell cites the artifact but copies no trade</li></ul></div>
            <div><span>Does not prove</span><strong>Brokerage truth or investing skill</strong><ul><li>That a trade or balance existed</li><li>That the issuer controls an account</li><li>That the source head is externally anchored</li><li>That performance is complete or causal</li></ul></div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function AssuranceStep({ rank, label, detail, state }: { rank: string; label: string; detail: string; state: "available" | "reported" | "unavailable" }) {
  return <article className={`assurance-${state}`}><span>{rank}</span><div><strong>{label}</strong><p>{detail}</p></div><em>{state}</em></article>;
}
