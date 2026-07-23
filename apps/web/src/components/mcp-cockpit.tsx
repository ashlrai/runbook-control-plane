"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Copy,
  FileJson2,
  Gauge,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import { fingerprintPayload } from "../lib/runbook";
import {
  inspectPublicSnapshot,
  MAX_PASTED_ARTIFACT_BYTES,
  pastedArtifactSizeError,
  type SnapshotInspection,
} from "../lib/proof-verifier";
import {
  DISCOVERY_RESOURCES,
  EXAMPLE_PREFLIGHT_TOOL_CALL,
  FIXTURE_DEMO_CARDS,
  formatSurfaceLockSummary,
  GOLDEN_JOURNEY_STEPS,
  MCP_INSTALL_COMMAND,
  MCP_OPERATOR_DOCS,
  MCP_PILOT_DOCTOR_COMMAND,
  MCP_SERVER_VERSION,
  MCP_SURFACE_LOCK,
  MCP_TOOL_COUNT,
  MCP_TOOLS,
} from "../lib/mcp-cockpit-data";
import styles from "./mcp-cockpit.module.css";

const sampleSnapshot = JSON.stringify(
  {
    schemaVersion: "runbook.public-snapshot.v1",
    generatedAt: "2026-07-21T15:00:00.000Z",
    experimentId: "RUN-SYNTHETIC-PROOF-001",
    sourceLedger: {
      validAtExport: true,
      eventCount: 2,
      headHash: "b".repeat(64),
      assurance: "local-tamper-evidence-only",
    },
    projection: {
      privacy: "metadata-only",
      independentlyVerifiable: false,
      note: "Filtered metadata projection; verify against the trusted source ledger head.",
    },
    events: [
      {
        sequence: 1,
        type: "experiment.created",
        occurredAt: "2026-07-21T14:00:00.000Z",
        hash: "a".repeat(64),
      },
      {
        sequence: 2,
        type: "charter.activated",
        occurredAt: "2026-07-21T14:05:00.000Z",
        hash: "b".repeat(64),
      },
    ],
  },
  null,
  2,
);

type PasteResult =
  | { ok: false; errors: string[] }
  | { ok: true; inspection: Extract<SnapshotInspection, { valid: true }>; fingerprint: string };

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [text]);

  return (
    <button type="button" className={styles.copyBtn} onClick={() => void onCopy()} aria-label={label}>
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function McpCockpit() {
  const [artifactText, setArtifactText] = useState(sampleSnapshot);
  const [result, setResult] = useState<PasteResult | null>(null);
  const [journeyDone, setJourneyDone] = useState<Record<string, boolean>>({});
  const generation = useRef(0);

  async function validateSnapshot() {
    const source = artifactText;
    const current = ++generation.current;
    try {
      const sizeError = pastedArtifactSizeError(source);
      if (sizeError) {
        setResult({ ok: false, errors: [sizeError] });
        return;
      }
      const inspection = inspectPublicSnapshot(JSON.parse(source) as unknown);
      if (!inspection.valid) {
        setResult({ ok: false, errors: inspection.errors });
        return;
      }
      const fingerprint = await fingerprintPayload(source);
      if (generation.current !== current || artifactText !== source) return;
      setResult({ ok: true, inspection, fingerprint });
    } catch (error) {
      setResult({
        ok: false,
        errors: [error instanceof Error ? error.message : "Artifact is not valid JSON."],
      });
    }
  }

  const completedSteps = GOLDEN_JOURNEY_STEPS.filter((step) => journeyDone[step.id]).length;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Runbook home">
          <BrandMark />
          <span>Runbook</span>
          <em>MCP</em>
        </Link>
        <nav className={styles.headerNav} aria-label="MCP cockpit navigation">
          <Link href="/">Product map</Link>
          <Link href="/registry">Registry</Link>
          <Link href="/control-room">Control Room</Link>
          <Link href="/shadow-lab">Shadow Lab</Link>
          <Link href="/experiments/new">Experiment</Link>
          <Link href="/trust">Trust center</Link>
        </nav>
      </header>

      <div className={styles.truthRail} role="note" aria-label="MCP honesty boundary">
        <span>LOCAL STDIO COMPANION</span>
        <span>NO HARD GATEWAY</span>
        <span>NO LIVE BROKER CONNECTION</span>
        <span>ADVISORY ONLY</span>
      </div>

      <section className={styles.hero} aria-labelledby="mcp-title">
        <div>
          <p className={styles.eyebrow}>Runbook MCP companion · local-first cockpit</p>
          <h1 id="mcp-title">Record beside the agent. Never as the broker.</h1>
          <p className={styles.lede}>
            Install the local Runbook MCP next to your coding agent. Server{" "}
            <strong>v{MCP_SERVER_VERSION}</strong> · {MCP_TOOL_COUNT} closed tools: discovery, six
            ledger writers/readers, seven offline analysis tools, six shadow self-improvement tools,
            thirteen control-plane session tools, and six elite process tools. Preflight is
            deterministic and advisory. A direct brokerage tool can always bypass Runbook—so the
            first pilot stays disconnected.
          </p>
        </div>
        <aside className={styles.boundary} aria-label="What this page never claims">
          <div className={styles.boundaryHead}>
            <span>CLAIM BOUNDARY</span>
            <strong>EXPLICIT</strong>
          </div>
          <ul>
            <li>Never claims a hard execution gateway over Robinhood or any broker.</li>
            <li>Never claims a live broker connection from this web page.</li>
            <li>Never accepts brokerage credentials, OAuth tokens, or card numbers.</li>
            <li>Never invents a composite safety score from ledger or pilot checks.</li>
          </ul>
        </aside>
      </section>

      <section className={styles.surfaceLock} aria-labelledby="surface-lock-title">
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Surface lock · static cockpit display</p>
            <h2 id="surface-lock-title">
              {MCP_SURFACE_LOCK.serverName} v{MCP_SURFACE_LOCK.serverVersion} · {MCP_SURFACE_LOCK.toolCount}{" "}
              tools · attests Runbook only
            </h2>
          </div>
          <CopyButton
            text={formatSurfaceLockSummary()}
            label="Copy surface lock summary text"
          />
        </div>
        <div className={styles.surfaceLockBody} aria-label="Surface lock summary">
          <div className={styles.surfaceLockGrid}>
            <div>
              <span>toolCount</span>
              <strong>{MCP_SURFACE_LOCK.toolCount}</strong>
            </div>
            <div>
              <span>brokerExecutionTools</span>
              <strong>[] empty</strong>
            </div>
            <div>
              <span>openWorldHint</span>
              <strong>{String(MCP_SURFACE_LOCK.openWorldHint)}</strong>
            </div>
            <div>
              <span>attests</span>
              <strong>{MCP_SURFACE_LOCK.attests}</strong>
            </div>
            <div>
              <span>hasPlaceOrCancelTools</span>
              <strong>{String(MCP_SURFACE_LOCK.hasPlaceOrCancelTools)}</strong>
            </div>
            <div>
              <span>brokerEffect</span>
              <strong>{String(MCP_SURFACE_LOCK.brokerEffect)}</strong>
            </div>
          </div>
          <p className={styles.surfaceLockMessage}>{MCP_SURFACE_LOCK.message}</p>
          <ul className={styles.surfaceLockLimits} aria-label="Surface lock limitations">
            {MCP_SURFACE_LOCK.limitations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.journey} aria-labelledby="journey-title">
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Golden journey checklist</p>
            <h2 id="journey-title">
              Steps agents should take · {completedSteps}/{GOLDEN_JOURNEY_STEPS.length}
            </h2>
          </div>
        </div>
        <ol className={styles.journeyList}>
          {GOLDEN_JOURNEY_STEPS.map((step, index) => {
            const done = Boolean(journeyDone[step.id]);
            return (
              <li key={step.id} data-done={done ? "true" : "false"}>
                <button
                  type="button"
                  className={styles.journeyCheck}
                  aria-pressed={done}
                  onClick={() =>
                    setJourneyDone((prev) => ({ ...prev, [step.id]: !prev[step.id] }))
                  }
                >
                  {done ? <Check size={14} aria-hidden="true" /> : <span>{index + 1}</span>}
                </button>
                <div>
                  <strong>{step.label}</strong>
                  <p>{step.detail}</p>
                  <code>{step.toolHint}</code>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <div className={styles.layout}>
        <div style={{ display: "grid", gap: 18 }}>
          <section className={styles.panel} aria-labelledby="install-title">
            <div className={styles.panelHead}>
              <p className={styles.eyebrow}>Install in Codex</p>
              <h2 id="install-title">Wire the local server</h2>
            </div>
            <div className={styles.install}>
              <p>
                From the repository root. The server defaults to <code>~/.runbook/events.jsonl</code>.
                Point <code>RUNBOOK_DATA_DIR</code> only at a private absolute path outside synced folders.
              </p>
              <div className={styles.codeWrap}>
                <pre className={styles.codeBlock} tabIndex={0}>
                  {MCP_INSTALL_COMMAND}
                </pre>
                <CopyButton text={MCP_INSTALL_COMMAND} label="Copy install commands" />
              </div>
              <p>
                Start a new Codex task after adding the server so tools are discovered. Remove later
                with <code>codex mcp remove runbook</code>. Never put broker credentials in tool
                arguments, event notes, environment values intended for logs, or the ledger.
              </p>
              <div className={styles.codeWrap}>
                <pre className={styles.codeBlock} tabIndex={0}>
                  {JSON.stringify(EXAMPLE_PREFLIGHT_TOOL_CALL, null, 2)}
                </pre>
                <CopyButton
                  text={JSON.stringify(EXAMPLE_PREFLIGHT_TOOL_CALL, null, 2)}
                  label="Copy example preflight tool call JSON"
                />
              </div>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="tools-title">
            <div className={styles.panelHead}>
              <p className={styles.eyebrow}>Full tool inventory · {MCP_TOOL_COUNT} tools</p>
              <h2 id="tools-title">
                1 discovery + 6 ledger + 7 offline + 6 shadow + 13 session + 6 elite · broker effect: none
              </h2>
            </div>
            <p
              style={{
                margin: 0,
                padding: "0 16px 8px",
                color: "#6d7a8d",
                fontSize: 12,
                lineHeight: 1.5,
              }}
              data-operator-docs={MCP_OPERATOR_DOCS.path}
            >
              Operator docs: <code>{MCP_OPERATOR_DOCS.path}</code>
              {MCP_OPERATOR_DOCS.sections.length > 0 ? (
                <>
                  {" "}
                  —{" "}
                  {MCP_OPERATOR_DOCS.sections.map((section, index) => (
                    <span key={section.anchor}>
                      {index > 0 ? " · " : null}
                      <em>{section.title}</em>
                    </span>
                  ))}
                </>
              ) : null}
              . {MCP_TOOL_COUNT} closed tools; brokerEffect always false.
            </p>
            <table className={styles.toolTable}>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Lane</th>
                  <th>Effect</th>
                  <th>Assurance</th>
                </tr>
              </thead>
              <tbody>
                {MCP_TOOLS.map((tool) => (
                  <tr key={tool.name} data-lane={tool.lane}>
                    <td>
                      <code>{tool.name}</code>
                    </td>
                    <td>
                      <em data-lane={tool.lane}>{tool.lane}</em>
                    </td>
                    <td>{tool.effect}</td>
                    <td>
                      <em>{tool.assurance}</em>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p
              style={{
                margin: 0,
                padding: "12px 16px 16px",
                color: "#6d7a8d",
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >
              MCP annotations are descriptive, not authorization.{" "}
              <code>runbook_record_approval</code> requires actor type <code>human</code> but every
              argument is caller-supplied—an agent can claim human authority. Execution evidence
              always reports <code>humanAuthorityEstablished: false</code>. Offline tools never mutate
              a durable registry head or establish a broker session.
            </p>
          </section>

          <section className={styles.panel} aria-labelledby="resources-title">
            <div className={styles.panelHead}>
              <p className={styles.eyebrow}>Discovery resources</p>
              <h2 id="resources-title">Boundary + assurance first</h2>
            </div>
            <ul className={styles.resources}>
              {DISCOVERY_RESOURCES.map((resource) => (
                <li key={resource.uri}>
                  <code>{resource.uri}</code>
                  <span>{resource.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <section className={styles.panel} aria-labelledby="fixtures-title">
            <div className={styles.panelHead}>
              <p className={styles.eyebrow}>Offline fixture demos</p>
              <h2 id="fixtures-title">Closed catalog cards</h2>
            </div>
            <div className={styles.fixtureCards}>
              {FIXTURE_DEMO_CARDS.map((card) => {
                const json = JSON.stringify(card.toolCall, null, 2);
                return (
                  <article key={card.id} className={styles.fixtureCard}>
                    <div className={styles.fixtureCardHead}>
                      <strong>{card.title}</strong>
                      <span>{card.outcome}</span>
                    </div>
                    <p>{card.detail}</p>
                    <div className={styles.codeWrap}>
                      <pre className={styles.codeBlock} tabIndex={0}>
                        {json}
                      </pre>
                      <CopyButton text={json} label={`Copy ${card.title} tool call JSON`} />
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="snapshot-title">
            <div className={styles.panelHead}>
              <p className={styles.eyebrow}>Owned-data bridge</p>
              <h2 id="snapshot-title">Paste a public snapshot</h2>
            </div>
            <div className={styles.paste}>
              <p style={{ margin: 0, color: "#6d7a8d", fontSize: 12, lineHeight: 1.5 }}>
                Validate <code>runbook.public-snapshot.v1</code> locally with the same strict schema
                used by Trust Center. Metadata only—no payloads, actor IDs, symbols, or notionals.
                Limit {MAX_PASTED_ARTIFACT_BYTES.toLocaleString()} bytes. No upload.
              </p>
              <label className="sr-only" htmlFor="mcp-snapshot-paste">
                Public snapshot JSON
              </label>
              <textarea
                id="mcp-snapshot-paste"
                value={artifactText}
                onChange={(event) => {
                  setArtifactText(event.target.value);
                  setResult(null);
                }}
                spellCheck={false}
                autoComplete="off"
              />
              <div className={styles.pasteActions}>
                <button
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  type="button"
                  onClick={() => void validateSnapshot()}
                >
                  <ClipboardCheck size={15} aria-hidden="true" />
                  Validate snapshot
                </button>
                <button
                  className={`${styles.button} ${styles.buttonGhost}`}
                  type="button"
                  onClick={() => {
                    setArtifactText(sampleSnapshot);
                    setResult(null);
                  }}
                >
                  Load sample
                </button>
              </div>
              {result ? (
                <div className={styles.result} data-ok={result.ok} role="status" aria-live="polite">
                  {result.ok ? (
                    <>
                      <strong>Schema valid · local fingerprint only</strong>
                      <ul>
                        <li>
                          Experiment {result.inspection.snapshot.experimentId} ·{" "}
                          {result.inspection.snapshot.events.length} metadata events
                        </li>
                        <li>
                          Source assurance: {result.inspection.snapshot.sourceLedger.assurance}
                        </li>
                        <li>
                          Independent verification:{" "}
                          {result.inspection.snapshot.projection.independentlyVerifiable
                            ? "claimed true"
                            : "false — compare to trusted ledger head"}
                        </li>
                        <li>
                          Source SHA-256 {result.fingerprint.slice(0, 12)}…
                          {result.fingerprint.slice(-10)}
                        </li>
                        {result.inspection.checks.map((check) => (
                          <li key={check.id}>
                            {check.label}: {check.detail}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <>
                      <strong>Validation failed</strong>
                      <ul>
                        {result.errors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="doctor-title">
            <div className={styles.panelHead}>
              <p className={styles.eyebrow}>Shadow pilot doctor</p>
              <h2 id="doctor-title">Offline readiness CLI</h2>
            </div>
            <div className={styles.doctor}>
              <p>
                <code>pilot-doctor</code> is a deterministic offline readiness check. It does not call
                Robinhood, inspect a remote MCP, authenticate, move capital, or execute an order. A
                pass means local-attestation-and-ledger-only—not system-wide broker absence.
              </p>
              <div className={styles.codeWrap}>
                <pre className={styles.codeBlock} tabIndex={0}>
                  {MCP_PILOT_DOCTOR_COMMAND}
                </pre>
                <CopyButton text={MCP_PILOT_DOCTOR_COMMAND} label="Copy pilot-doctor commands" />
              </div>
              <p>
                Export a metadata snapshot after a valid ledger with{" "}
                <code>node packages/mcp/dist/cli.js export-public RUN-001</code>, then paste it above
                or in Trust Center.
              </p>
              <div className={styles.links}>
                <Link href="/experiments/new">
                  Experiment builder <ArrowRight size={14} aria-hidden="true" />
                </Link>
                <Link href="/control-room">
                  Control Room <Gauge size={14} aria-hidden="true" />
                </Link>
                <Link href="/shadow-lab">
                  Shadow Process Lab <ArrowRight size={14} aria-hidden="true" />
                </Link>
                <Link href="/trust">
                  Trust center <FileJson2 size={14} aria-hidden="true" />
                </Link>
                <Link href="/registry">
                  Capability registry <Terminal size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>

      <p className={styles.footerNote}>
        <ShieldAlert size={15} aria-hidden="true" />
        “Allowed” on preflight means the submitted proposal passed recorded charter checks. It does
        not mean an account-wide control prevented other actions. Human confirmation must remain
        enabled and independently performed at the broker. This page never establishes a live broker
        session.
      </p>
    </main>
  );
}
