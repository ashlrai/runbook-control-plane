"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlaskConical,
  Layers3,
  LockKeyhole,
  Play,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { evaluateAgentProcess, type AgentEvalReport } from "@runbook/engine/agent-eval";
import { BrandMark } from "./brand-mark";
import {
  browserSessionStore,
  buildPublicDocsInventoryPin,
  demoCharterDualEval,
  type ControlPlaneSession,
  type CharterDualEvalResult,
} from "../lib/control-plane-session";
import { EXPERIMENT_ID, SAMPLE_LEDGER_EVENTS } from "../lib/sample-ledger-events";
import { HOSTED_TRUTH_RAIL, SITE_ORIGIN } from "../lib/site";
import styles from "./process-theater.module.css";

type TimelineEvent = {
  id: string;
  at: string;
  kind: "session" | "pin" | "shadow" | "dual-eval" | "surface" | "note";
  title: string;
  detail: string;
};

type DualSnap = CharterDualEvalResult & {
  proposalId: string;
  brokerEffect: false;
  compositeScore: false;
  notTradingPerformance: true;
};

const SURFACE_VERSION_NOTE =
  "runbook.web process-theater.v1 · browser localStorage only · not MCP disk · not broker gateway";

function sessionTimeline(session: ControlPlaneSession, dual: DualSnap | null): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      id: `${session.sessionId}-create`,
      at: session.createdAt,
      kind: "session",
      title: "Session created",
      detail: `${session.sessionId} · ${session.label} · capitalAtRisk=0 · brokerEffect=false`,
    },
  ];

  if (session.inventoryPin) {
    events.push({
      id: `${session.sessionId}-pin`,
      at: session.inventoryPin.createdAt,
      kind: "pin",
      title: "Inventory pin",
      detail: `${session.inventoryPin.tools.length} tools · pinId=${session.inventoryPin.pinId} · not runtime-confirmed`,
    });
  }

  for (const gen of session.shadowGenerations) {
    events.push({
      id: `${session.sessionId}-shadow-${gen.generation}-${gen.recordedAt}`,
      at: gen.recordedAt,
      kind: "shadow",
      title: `Shadow generation G${gen.generation}`,
      detail: `HFA ${gen.hardFalseAllows} · HFD ${gen.hardFalseDenies} · process metrics only`,
    });
  }

  if (dual) {
    events.push({
      id: `${session.sessionId}-dual`,
      at: session.updatedAt,
      kind: "dual-eval",
      title: "Dual-eval demo",
      detail: `binding=${dual.sessionCharterBinding} · ledgerAllowed=${String(dual.ledgerAllowed)} · processAllowed=${String(dual.allowed)} · enforcement=${dual.charterBindingEnforcement}`,
    });
  }

  events.push({
    id: `${session.sessionId}-surface`,
    at: session.updatedAt,
    kind: "surface",
    title: "Surface version",
    detail: SURFACE_VERSION_NOTE,
  });

  return events.sort((a, b) => a.at.localeCompare(b.at));
}

export function ProcessTheater() {
  const [sessions, setSessions] = useState<ControlPlaneSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dualBySession, setDualBySession] = useState<Record<string, DualSnap>>({});
  const [statusNote, setStatusNote] = useState(
    "Load browser sessions or seed the fixture theater (elite + pin + HFA 0 + dual-eval).",
  );
  const [busy, setBusy] = useState(false);
  const [agentEval, setAgentEval] = useState<AgentEvalReport | null>(null);
  const [agentEvalNote, setAgentEvalNote] = useState(
    "Load the embedded sample ledger and run process axes only — never a composite score.",
  );

  const refresh = useCallback(() => {
    const list = browserSessionStore.list();
    setSessions(list);
    setSelectedId((current) => {
      if (current && list.some((s) => s.sessionId === current)) return current;
      return list[0]?.sessionId ?? null;
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selected = useMemo(
    () => sessions.find((s) => s.sessionId === selectedId) ?? null,
    [sessions, selectedId],
  );

  const dual = selected ? dualBySession[selected.sessionId] ?? null : null;

  const timeline = useMemo(
    () => (selected ? sessionTimeline(selected, dual) : []),
    [selected, dual],
  );

  const runDualFor = useCallback((session: ControlPlaneSession) => {
    if (!session.charter) return null;
    try {
      return demoCharterDualEval(session);
    } catch {
      return null;
    }
  }, []);

  const loadFixtureTheater = useCallback(async () => {
    setBusy(true);
    try {
      // Elite seed + pin + demo shadow HFA=0 + dual-eval. Skip slow refine loop.
      let session = await browserSessionStore.create({
        label: "Process Theater fixture (elite)",
        charterSeed: "elite",
        inventoryEnforcement: "fail-closed",
        charterBindingEnforcement: "fail-closed",
      });
      const pin = await buildPublicDocsInventoryPin({
        label: "Theater public-docs pin",
      });
      session = await browserSessionStore.setInventoryPin(session.sessionId, pin);
      session = await browserSessionStore.recordShadowGeneration(session.sessionId, {
        generation: 1,
        hardFalseAllows: 0,
        hardFalseDenies: 0,
      });
      const dualResult = demoCharterDualEval(session);
      setDualBySession((prev) => ({ ...prev, [session.sessionId]: dualResult }));
      setSelectedId(session.sessionId);
      setStatusNote(
        `Fixture theater ready · ${session.sessionId} · pin=${pin.tools.length} · HFA 0 · dual=${dualResult.sessionCharterBinding} · refine skipped (use elite seed)`,
      );
      refresh();
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Fixture theater failed.");
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const inspectSelectedDual = useCallback(() => {
    if (!selected) return;
    const live = browserSessionStore.read(selected.sessionId);
    const dualResult = runDualFor(live);
    if (!dualResult) {
      setStatusNote("Selected session has no charter — dual-eval skipped.");
      return;
    }
    setDualBySession((prev) => ({ ...prev, [live.sessionId]: dualResult }));
    setStatusNote(
      `Dual-eval · binding=${dualResult.sessionCharterBinding} · processAllowed=${String(dualResult.allowed)} · still not a broker gateway`,
    );
    refresh();
  }, [selected, runDualFor, refresh]);

  const loadSampleLedgerAndEvaluate = useCallback(() => {
    try {
      const report = evaluateAgentProcess(EXPERIMENT_ID, [...SAMPLE_LEDGER_EVENTS]);
      setAgentEval(report);
      setAgentEvalNote(
        `Sample ledger evaluated · experiment=${report.experimentId} · events=${report.eventCount} · processCorrect=${String(report.processCorrect)} · compositeScore=false · not trading performance`,
      );
    } catch (error) {
      setAgentEval(null);
      setAgentEvalNote(error instanceof Error ? error.message : "Agent process eval failed.");
    }
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Runbook home">
          <BrandMark />
          <span>Runbook</span>
          <em>Process Theater</em>
        </Link>
        <nav className={styles.headerNav} aria-label="Theater navigation">
          <Link href="/showcase">Showcase</Link>
          <Link href="/session">Session</Link>
          <Link href="/gateway">Gateway</Link>
          <Link href="/verify">Verify</Link>
          <Link href="/control-room">Control Room</Link>
        </nav>
      </header>

      <div className={styles.truthRail} role="note" aria-label="Hosted honesty boundary">
        {HOSTED_TRUTH_RAIL.map((chip) => (
          <span key={chip}>{chip}</span>
        ))}
      </div>

      <section className={styles.hero} aria-labelledby="theater-title">
        <div>
          <p className={styles.eyebrow}>HOSTED LAB · process evidence timeline</p>
          <h1 id="theater-title">Watch the control-plane spine assemble — zero capital.</h1>
          <p className={styles.lede}>
            Process Theater loads browser sessions and walks inventory pin, shadow generations,
            dual-eval, and surface version notes. Fixture mode seeds an elite charter session with
            a public-docs pin and HFA=0 shadow point (no slow refine). Not returns. Not a hard
            gateway.
          </p>
          <div className={styles.ctaRow}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void loadFixtureTheater()}
              disabled={busy}
              aria-busy={busy}
            >
              <Play size={15} aria-hidden="true" />
              {busy ? "Seeding fixture…" : "Load fixture theater"}
            </button>
            <Link className={styles.ghostBtn} href="/showcase">
              <FlaskConical size={15} aria-hidden="true" />
              Hosted showcase
            </Link>
            <Link className={styles.ghostBtn} href="/session">
              <Layers3 size={15} aria-hidden="true" />
              Session dashboard
            </Link>
            <Link className={styles.ghostBtn} href="/verify">
              <ScanSearch size={15} aria-hidden="true" />
              Capsule verifier
            </Link>
          </div>
        </div>
        <aside className={styles.boundary} aria-label="Theater boundary">
          <div className={styles.boundaryHead}>
            <span>BOUNDARY</span>
            <strong>HOSTED LAB</strong>
          </div>
          <ul>
            <li>
              <LockKeyhole size={13} aria-hidden="true" />
              Browser localStorage sessions only — not ~/.runbook MCP disk
            </li>
            <li>
              <ShieldAlert size={13} aria-hidden="true" />
              Dual-eval process deny ≠ hard broker gateway
            </li>
            <li>
              <ShieldCheck size={13} aria-hidden="true" />
              Shadow HFA/HFD are process axes — not trading performance
            </li>
            <li>
              <Terminal size={13} aria-hidden="true" />
              No composite safety score · capitalAtRisk remains 0
            </li>
          </ul>
        </aside>
      </section>

      <div className={styles.layout}>
        <section className={styles.panel} aria-label="Browser sessions">
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>localStorage</p>
              <h2>Browser sessions</h2>
            </div>
            <code className={styles.mono}>{sessions.length}</code>
          </div>
          <p className={styles.statusNote}>{statusNote}</p>
          {sessions.length === 0 ? (
            <p className={styles.empty}>No sessions yet. Load fixture theater or create on /session.</p>
          ) : (
            <div className={styles.sessionList} role="listbox" aria-label="Theater sessions">
              {sessions.map((session) => (
                <button
                  key={session.sessionId}
                  type="button"
                  className={styles.sessionItem}
                  data-active={session.sessionId === selectedId}
                  role="option"
                  aria-selected={session.sessionId === selectedId}
                  onClick={() => setSelectedId(session.sessionId)}
                >
                  <strong>{session.label}</strong>
                  <code>{session.sessionId}</code>
                  <span>
                    pin={session.inventoryPin ? session.inventoryPin.tools.length : 0} · shadow=
                    {session.shadowGenerations.length} · binding=
                    {session.charterBindingEnforcement ?? "warn"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className={styles.panel} aria-label="Process timeline">
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>Timeline</p>
              <h2>
                {selected
                  ? `${selected.label}`
                  : "Select a session"}
              </h2>
            </div>
            {selected ? (
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={inspectSelectedDual}
                disabled={!selected.charter}
              >
                Run dual-eval demo
              </button>
            ) : null}
          </div>
          <div className={styles.sectionBody}>
            {!selected ? (
              <p className={styles.empty}>Pick a session to render pin · shadow · dual-eval events.</p>
            ) : (
              <>
                <div className={styles.metrics} aria-label="Session snapshot">
                  <div>
                    <span>Charter</span>
                    <strong>{selected.charter ? "bound" : "none"}</strong>
                  </div>
                  <div>
                    <span>Inventory</span>
                    <strong>
                      {selected.inventoryPin
                        ? `${selected.inventoryPin.tools.length} tools`
                        : "unpinned"}
                    </strong>
                  </div>
                  <div>
                    <span>Shadow last</span>
                    <strong>
                      HFA {selected.lastShadowHardFalseAllows ?? "—"} / HFD{" "}
                      {selected.lastShadowHardFalseDenies ?? "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Honesty</span>
                    <strong>compositeScore=false</strong>
                  </div>
                </div>

                <ol className={styles.timeline} aria-label="Process evidence timeline">
                  {timeline.map((event) => (
                    <li key={event.id} className={styles.event} data-kind={event.kind}>
                      <span className={styles.eventKind}>{event.kind}</span>
                      <div>
                        <strong>{event.title}</strong>
                        <p>{event.detail}</p>
                        <code>{event.at}</code>
                      </div>
                    </li>
                  ))}
                </ol>

                {dual ? (
                  <div className={styles.dualCard} aria-label="Theater dual-eval result">
                    <strong>{dual.sessionCharterBinding}</strong>
                    <span>
                      ledgerAllowed={String(dual.ledgerAllowed)} · processAllowed=
                      {String(dual.allowed)} · processDeniedBySession=
                      {String(dual.processDeniedBySession)}
                    </span>
                    <span>
                      enforcement={dual.charterBindingEnforcement} · brokerEffect=false · not
                      trading performance
                    </span>
                  </div>
                ) : null}

                <div className={styles.links}>
                  <Link
                    className={styles.chipLink}
                    href={`/session?sessionId=${encodeURIComponent(selected.sessionId)}`}
                  >
                    Open session
                  </Link>
                  <Link
                    className={styles.chipLink}
                    href={`/control-room?sessionId=${encodeURIComponent(selected.sessionId)}`}
                  >
                    Control Room dual-eval
                  </Link>
                  <Link className={styles.chipLink} href="/showcase">
                    Showcase
                  </Link>
                  <Link className={styles.chipLink} href="/verify">
                    Verify
                  </Link>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="agent-eval-title" style={{ margin: "0 clamp(20px, 4vw, 64px) 24px" }}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>runbook.agent-eval.v1 · process observation only</p>
            <h2 id="agent-eval-title">Agent process eval</h2>
          </div>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={loadSampleLedgerAndEvaluate}
          >
            <Play size={15} aria-hidden="true" />
            Load sample ledger & evaluate
          </button>
        </div>
        <p className={styles.statusNote}>{agentEvalNote}</p>
        <div className={styles.sectionBody}>
          {!agentEval ? (
            <p className={styles.empty}>
              Uses embedded sample ledger ({EXPERIMENT_ID}) — multi-axis process quality only. No
              composite score. Not PnL. Not broker enforcement.
            </p>
          ) : (
            <>
              <div className={styles.metrics} aria-label="Agent eval summary">
                <div>
                  <span>processCorrect</span>
                  <strong data-passed={agentEval.processCorrect ? "true" : "false"}>
                    {String(agentEval.processCorrect)}
                  </strong>
                </div>
                <div>
                  <span>compositeScore</span>
                  <strong>false · never</strong>
                </div>
                <div>
                  <span>Events</span>
                  <strong>{agentEval.eventCount}</strong>
                </div>
                <div>
                  <span>Assurance</span>
                  <strong>{agentEval.assurance}</strong>
                </div>
              </div>

              <div className={styles.axisGrid} aria-label="Process axes">
                {agentEval.axes.map((axis) => (
                  <article
                    key={axis.id}
                    className={styles.axisCard}
                    data-passed={axis.passed ? "true" : "false"}
                  >
                    <span className={styles.axisBadge} data-passed={axis.passed ? "true" : "false"}>
                      {axis.passed ? "passed" : "failed"}
                    </span>
                    <strong>{axis.label}</strong>
                    <code>{axis.id}</code>
                    <p>{axis.detail}</p>
                  </article>
                ))}
              </div>

              <div className={styles.limitations} aria-label="Agent eval limitations">
                <strong>Limitations (honesty rails)</strong>
                <ul>
                  {agentEval.limitations.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p>
                  notTradingPerformance={String(agentEval.notTradingPerformance)} · notPnL=
                  {String(agentEval.notPnL)} · brokerEffect={String(agentEval.brokerEffect)} ·
                  compositeScore={String(agentEval.compositeScore)}
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      <footer className={styles.footer}>
        Hosted at {SITE_ORIGIN}. Process Theater is browser-local process evidence only. Not
        affiliated with Robinhood. Not investment advice. Live-capital allocation remains $0.
      </footer>
    </main>
  );
}
