"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleAlert,
  Fingerprint,
  Gauge,
  Link2,
  LockKeyhole,
  Play,
  ShieldAlert,
  Swords,
  X,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import {
  demoProposal,
  evaluateProposal,
  masonPolicy,
  type RiskPolicy,
  type TradeProposal,
} from "../lib/runbook";
import {
  browserSessionStore,
  parseSessionIdQuery,
  type CharterDualEvalResult,
  type ControlPlaneSession,
} from "../lib/control-plane-session";
import { resolveCharterDualEval } from "@runbook/session/charter-binding";
import { getExperimentDraft } from "../lib/local-store";
import styles from "./control-room.module.css";

type ProposalForm = {
  proposalId: string;
  experimentId: string;
  symbol: string;
  instrument: "equity" | "option" | "crypto";
  side: "buy" | "sell";
  notional: number;
  projectedPositionNotional: number;
  dailyTradesAfter: number;
  currentDrawdownPercent: number;
  hasThesis: boolean;
  hasInvalidation: boolean;
  evidenceSourceCount: number;
};

type CharterSource = "defaults" | "indexeddb" | "edited";

type HostileTicketId =
  | "clean-vti"
  | "options-blocked"
  | "denied-gme"
  | "missing-thesis";

const DEFAULT_CHARTER: RiskPolicy = {
  ...masonPolicy,
  approvalRequired: true,
  allowedInstruments: ["equity"],
};

function proposalFromDemo(): ProposalForm {
  return {
    proposalId: demoProposal.proposalId,
    experimentId: demoProposal.experimentId,
    symbol: demoProposal.symbol,
    instrument: demoProposal.instrument,
    side: demoProposal.side,
    notional: demoProposal.notional,
    projectedPositionNotional: demoProposal.projectedPositionNotional,
    dailyTradesAfter: demoProposal.dailyTradesAfter,
    currentDrawdownPercent: demoProposal.currentDrawdownPercent,
    hasThesis: demoProposal.hasThesis,
    hasInvalidation: demoProposal.hasInvalidation,
    evidenceSourceCount: demoProposal.evidenceSourceCount,
  };
}

/** Synthetic hostile proposal presets — labels only; no live capital path. */
function hostileFormPreset(id: HostileTicketId): ProposalForm {
  const base = proposalFromDemo();
  switch (id) {
    case "clean-vti":
      return base;
    case "options-blocked":
      return {
        ...base,
        proposalId: "proposal-hostile-option-spy",
        symbol: "SPY",
        instrument: "option",
        notional: 50,
        projectedPositionNotional: 50,
      };
    case "denied-gme":
      return {
        ...base,
        proposalId: "proposal-hostile-gme",
        symbol: "GME",
        instrument: "equity",
        notional: 50,
        projectedPositionNotional: 50,
      };
    case "missing-thesis":
      return {
        ...base,
        proposalId: "proposal-hostile-no-thesis",
        hasThesis: false,
        hasInvalidation: false,
      };
  }
}

function formToProposal(form: ProposalForm): TradeProposal {
  return {
    proposalId: form.proposalId.trim() || "proposal-local",
    experimentId: form.experimentId.trim() || "RUN-LOCAL",
    symbol: form.symbol.trim() || "VTI",
    instrument: form.instrument,
    side: form.side,
    notional: form.notional,
    projectedPositionNotional: form.projectedPositionNotional,
    dailyTradesAfter: form.dailyTradesAfter,
    currentDrawdownPercent: form.currentDrawdownPercent,
    hasThesis: form.hasThesis,
    hasInvalidation: form.hasInvalidation,
    evidenceSourceCount: form.evidenceSourceCount,
  };
}

function parseDraftCharter(value: unknown): RiskPolicy | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Record<string, unknown>;
  const budget = typeof draft.budget === "number" ? draft.budget : null;
  const reserve = typeof draft.reserve === "number" ? draft.reserve : null;
  const positionCap = typeof draft.positionCap === "number" ? draft.positionCap : null;
  const drawdown = typeof draft.drawdown === "number" ? draft.drawdown : null;
  if (budget === null || reserve === null || positionCap === null || drawdown === null) return null;
  if (!(reserve < budget)) return null;
  const deployable = budget - reserve;
  const maxOrderNotional = Math.min(deployable, DEFAULT_CHARTER.maxOrderNotional);
  if (maxOrderNotional <= 0) return null;
  return {
    capitalBudget: budget,
    cashReserve: reserve,
    maxPositionPercent: positionCap,
    maxOrderNotional,
    maxDrawdownPercent: drawdown,
    maxDailyTrades: DEFAULT_CHARTER.maxDailyTrades,
    allowedInstruments: ["equity"],
    allowedSymbols: [],
    deniedSymbols: [],
    approvalRequired: draft.approvalRequired !== false,
  };
}

export function ControlRoom() {
  const [charter, setCharter] = useState<RiskPolicy>(DEFAULT_CHARTER);
  const [charterSource, setCharterSource] = useState<CharterSource>("defaults");
  const [form, setForm] = useState<ProposalForm>(proposalFromDemo);
  const [ran, setRan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ControlPlaneSession[]>([]);
  const [bindSessionId, setBindSessionId] = useState<string | null>(null);
  const [dualEval, setDualEval] = useState<CharterDualEvalResult | null>(null);
  const [activeTicket, setActiveTicket] = useState<HostileTicketId>("clean-vti");

  const refreshSessions = useCallback(() => {
    try {
      setSessions(browserSessionStore.list());
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const draft = await getExperimentDraft("primary");
        if (cancelled) return;
        const parsed = parseDraftCharter(draft);
        if (parsed) {
          setCharter(parsed);
          setCharterSource("indexeddb");
        }
      } catch {
        /* keep defaults — IndexedDB may be unavailable in some test envs */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Bind session from ?sessionId= or keep operator selection.
  useEffect(() => {
    refreshSessions();
    if (typeof window === "undefined") return;
    const fromUrl = parseSessionIdQuery(window.location.search);
    if (!fromUrl) return;
    try {
      browserSessionStore.read(fromUrl);
      setBindSessionId(fromUrl);
    } catch {
      /* unknown session id — leave unbound */
    }
  }, [refreshSessions]);

  const preflight = useMemo(() => {
    try {
      const proposal = formToProposal(form);
      return { ok: true as const, result: evaluateProposal(charter, proposal) };
    } catch (err) {
      return {
        ok: false as const,
        message: err instanceof Error ? err.message : "Invalid policy or proposal inputs.",
      };
    }
  }, [charter, form]);

  const computeDualEval = useCallback(
    (proposal: TradeProposal, ledgerAllowed: boolean): CharterDualEvalResult | null => {
      if (!bindSessionId) return null;
      let session: ControlPlaneSession;
      try {
        session = browserSessionStore.read(bindSessionId);
      } catch {
        return null;
      }
      const sessionHasCharter = session.charter !== undefined;
      const sessionAllowed = sessionHasCharter
        ? evaluateProposal(session.charter!, proposal).allowed
        : undefined;
      return resolveCharterDualEval({
        ledgerAllowed,
        sessionPresent: true,
        sessionHasCharter,
        ...(sessionAllowed !== undefined ? { sessionAllowed } : {}),
        enforcement: session.charterBindingEnforcement ?? "warn",
      });
    },
    [bindSessionId],
  );

  const runPreflight = useCallback(() => {
    if (!preflight.ok) {
      setError(preflight.message);
      setDualEval(null);
      setRan(true);
      return;
    }
    setError(null);
    setRan(true);
    const proposal = formToProposal(form);
    setDualEval(computeDualEval(proposal, preflight.result.allowed));
  }, [preflight, form, computeDualEval]);

  function updateForm<K extends keyof ProposalForm>(key: K, value: ProposalForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setRan(false);
    setError(null);
    setDualEval(null);
  }

  function updateCharterField(patch: Partial<RiskPolicy>) {
    setCharter((prev) => ({ ...prev, ...patch }));
    setCharterSource("edited");
    setRan(false);
    setError(null);
    setDualEval(null);
  }

  const loadHostileTicket = useCallback((id: HostileTicketId) => {
    setActiveTicket(id);
    setForm(hostileFormPreset(id));
    // Denied-GME ticket seeds a local denylist so the hard ticket fails without
    // requiring an elite session (session dual-eval still applies when bound).
    if (id === "denied-gme") {
      setCharter((prev) => {
        const denied = new Set(prev.deniedSymbols.map((s) => s.toUpperCase()));
        denied.add("GME");
        return { ...prev, deniedSymbols: [...denied] };
      });
      setCharterSource("edited");
    }
    setRan(false);
    setError(null);
    setDualEval(null);
  }, []);

  const hardPassed =
    preflight.ok ? preflight.result.checks.filter((c) => c.severity === "hard" && c.passed).length : 0;
  const hardTotal =
    preflight.ok ? preflight.result.checks.filter((c) => c.severity === "hard").length : 0;

  const boundSession = useMemo(() => {
    if (!bindSessionId) return null;
    return sessions.find((s) => s.sessionId === bindSessionId) ?? null;
  }, [sessions, bindSessionId]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Runbook home">
          <BrandMark />
          <span>Runbook</span>
          <em>Control Room</em>
        </Link>
        <nav className={styles.headerNav} aria-label="Control Room navigation">
          <Link href="/">Product map</Link>
          <Link href="/theater">Process Theater</Link>
          <Link href="/session">Session</Link>
          <Link href="/shadow-lab">Shadow Lab</Link>
          <Link href="/experiments/new">Charter builder</Link>
          <Link href="/mcp">MCP cockpit</Link>
        </nav>
      </header>

      <div className={styles.truthRail} role="note" aria-label="Control Room honesty boundary">
        <span>ADVISORY ONLY</span>
        <span>CALLER-SUPPLIED STATE</span>
        <span>NOT A HARD GATE</span>
        <span>NO LIVE BROKER / NO CREDENTIALS</span>
      </div>

      <section className={styles.hero} aria-labelledby="control-room-title">
        <div>
          <p className={styles.eyebrow}>Local preflight workbench · @runbook/engine</p>
          <h1 id="control-room-title">Charter in. Synthetic proposal out. Tickets only.</h1>
          <p className={styles.lede}>
            Run the real <code>evaluateProposal</code> policy engine in the browser against a local
            equity-only charter. Every check is a ticket with pass/fail drama. Bind a Control Plane
            Session to dual-eval ledger vs session charter. Allowed means the submitted proposal
            passed recorded charter checks — not that any broker was blocked.
          </p>
        </div>
        <aside className={styles.boundary} aria-label="Advisory enforcement boundary">
          <div className={styles.boundaryHead}>
            <span>ENFORCEMENT</span>
            <strong>ADVISORY</strong>
          </div>
          <ul>
            <li>Policy evaluation uses @runbook/engine — deterministic, local, browser-safe.</li>
            <li>Dual-eval is process-layer only. Fail-closed process deny ≠ hard broker gateway.</li>
            <li>Position, drawdown, trade-count, and evidence fields are caller-supplied — not broker truth.</li>
            <li>No composite process score. No credentials. No order execution path.</li>
          </ul>
        </aside>
      </section>

      <section className={styles.bindBar} aria-label="Session binding for dual-eval">
        <div className={styles.bindHead}>
          <Link2 size={14} aria-hidden="true" />
          <strong>Session bind</strong>
          <span>Dual-eval after preflight · still not a hard gate</span>
        </div>
        <label className={styles.bindSelect}>
          Bound Control Plane Session
          <select
            aria-label="Bound Control Plane Session"
            value={bindSessionId ?? ""}
            onChange={(e) => {
              const next = e.target.value || null;
              setBindSessionId(next);
              setDualEval(null);
              setRan(false);
              refreshSessions();
            }}
          >
            <option value="">No session · ledger-only tickets</option>
            {sessions.map((session) => (
              <option key={session.sessionId} value={session.sessionId}>
                {session.label} · {session.sessionId}
                {session.charter ? " · charter" : " · no charter"}
              </option>
            ))}
          </select>
        </label>
        {boundSession ? (
          <p className={styles.bindMeta}>
            binding enforcement: <code>{boundSession.charterBindingEnforcement ?? "warn"}</code>
            {" · "}
            charter: {boundSession.charter ? "bound" : "missing"}
            {" · "}
            <Link href={`/session?sessionId=${encodeURIComponent(boundSession.sessionId)}`}>
              Open session
            </Link>
          </p>
        ) : (
          <p className={styles.bindMeta}>
            Create a session on <Link href="/session">/session</Link> or run{" "}
            <Link href="/showcase">hosted showcase</Link> / <Link href="/theater">theater</Link>, then
            bind here for dual-eval.
          </p>
        )}
      </section>

      <div className={styles.layout}>
        <section className={styles.panel} aria-labelledby="charter-title">
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>Local charter draft</p>
              <h2 id="charter-title">Equity-only · approval required</h2>
            </div>
            <span className={styles.sourceChip} data-source={charterSource}>
              {charterSource === "indexeddb"
                ? "Loaded from IndexedDB"
                : charterSource === "edited"
                  ? "Edited locally"
                  : "Inline defaults"}
            </span>
          </div>
          <div className={styles.formGrid}>
            <label>
              Capital budget
              <input
                type="number"
                min={1}
                value={charter.capitalBudget}
                onChange={(e) => updateCharterField({ capitalBudget: Number(e.target.value) })}
              />
            </label>
            <label>
              Cash reserve
              <input
                type="number"
                min={0}
                value={charter.cashReserve}
                onChange={(e) => updateCharterField({ cashReserve: Number(e.target.value) })}
              />
            </label>
            <label>
              Max position %
              <input
                type="number"
                min={1}
                max={100}
                value={charter.maxPositionPercent}
                onChange={(e) => updateCharterField({ maxPositionPercent: Number(e.target.value) })}
              />
            </label>
            <label>
              Max order notional
              <input
                type="number"
                min={1}
                value={charter.maxOrderNotional}
                onChange={(e) => updateCharterField({ maxOrderNotional: Number(e.target.value) })}
              />
            </label>
            <label>
              Drawdown stop %
              <input
                type="number"
                min={0.01}
                max={100}
                step={0.1}
                value={charter.maxDrawdownPercent}
                onChange={(e) => updateCharterField({ maxDrawdownPercent: Number(e.target.value) })}
              />
            </label>
            <label>
              Max daily trades
              <input
                type="number"
                min={1}
                value={charter.maxDailyTrades}
                onChange={(e) => updateCharterField({ maxDailyTrades: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className={styles.charterMeta}>
            <span>
              <LockKeyhole size={13} aria-hidden="true" /> Instruments: equity only
            </span>
            <span>
              <Fingerprint size={13} aria-hidden="true" /> approvalRequired:{" "}
              {charter.approvalRequired ? "true" : "false"}
            </span>
            {charter.deniedSymbols.length > 0 ? (
              <span>denied: {charter.deniedSymbols.join(", ")}</span>
            ) : null}
            <Link href="/experiments/new">Edit full charter in builder →</Link>
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="proposal-title">
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>Synthetic proposal</p>
              <h2 id="proposal-title">Editable caller-supplied state</h2>
            </div>
            <Gauge size={18} aria-hidden="true" />
          </div>

          <div className={styles.hostileRow} aria-label="Hostile ticket presets">
            <span className={styles.hostileLabel}>
              <Swords size={13} aria-hidden="true" />
              Hostile tickets (synthetic)
            </span>
            <div className={styles.hostileBtns}>
              <button
                type="button"
                className={styles.ticketPreset}
                data-active={activeTicket === "clean-vti"}
                onClick={() => loadHostileTicket("clean-vti")}
              >
                Clean VTI equity
              </button>
              <button
                type="button"
                className={styles.ticketPreset}
                data-active={activeTicket === "options-blocked"}
                onClick={() => loadHostileTicket("options-blocked")}
              >
                Options blocked (SPY)
              </button>
              <button
                type="button"
                className={styles.ticketPreset}
                data-active={activeTicket === "denied-gme"}
                onClick={() => loadHostileTicket("denied-gme")}
              >
                Denied GME
              </button>
              <button
                type="button"
                className={styles.ticketPreset}
                data-active={activeTicket === "missing-thesis"}
                onClick={() => loadHostileTicket("missing-thesis")}
              >
                Missing thesis / invalidation
              </button>
            </div>
          </div>

          <div className={styles.formGrid}>
            <label>
              Symbol
              <input
                value={form.symbol}
                maxLength={20}
                onChange={(e) => updateForm("symbol", e.target.value)}
              />
            </label>
            <label>
              Side
              <select
                value={form.side}
                onChange={(e) => updateForm("side", e.target.value as "buy" | "sell")}
              >
                <option value="buy">buy</option>
                <option value="sell">sell</option>
              </select>
            </label>
            <label>
              Instrument
              <select
                value={form.instrument}
                onChange={(e) =>
                  updateForm("instrument", e.target.value as ProposalForm["instrument"])
                }
              >
                <option value="equity">equity</option>
                <option value="option">option</option>
                <option value="crypto">crypto</option>
              </select>
            </label>
            <label>
              Notional
              <input
                type="number"
                min={0.01}
                step={1}
                value={form.notional}
                onChange={(e) => updateForm("notional", Number(e.target.value))}
              />
            </label>
            <label>
              Projected position
              <input
                type="number"
                min={0}
                step={1}
                value={form.projectedPositionNotional}
                onChange={(e) => updateForm("projectedPositionNotional", Number(e.target.value))}
              />
            </label>
            <label>
              Daily trades after
              <input
                type="number"
                min={0}
                value={form.dailyTradesAfter}
                onChange={(e) => updateForm("dailyTradesAfter", Number(e.target.value))}
              />
            </label>
            <label>
              Current drawdown %
              <input
                type="number"
                min={0}
                step={0.1}
                value={form.currentDrawdownPercent}
                onChange={(e) => updateForm("currentDrawdownPercent", Number(e.target.value))}
              />
            </label>
            <label>
              Evidence sources
              <input
                type="number"
                min={0}
                value={form.evidenceSourceCount}
                onChange={(e) => updateForm("evidenceSourceCount", Number(e.target.value))}
              />
            </label>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={form.hasThesis}
                onChange={(e) => updateForm("hasThesis", e.target.checked)}
              />
              Thesis attached
            </label>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={form.hasInvalidation}
                onChange={(e) => updateForm("hasInvalidation", e.target.checked)}
              />
              Invalidation attached
            </label>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={runPreflight}>
              <Play size={14} fill="currentColor" aria-hidden="true" />
              Run engine preflight
            </button>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => {
                loadHostileTicket("clean-vti");
                setCharter(DEFAULT_CHARTER);
                setCharterSource("defaults");
              }}
            >
              Reset demo proposal
            </button>
          </div>
        </section>
      </div>

      <section className={styles.tickets} aria-labelledby="tickets-title" aria-live="polite">
        <div className={styles.ticketsHead}>
          <div>
            <p className={styles.eyebrow}>Policy check tickets</p>
            <h2 id="tickets-title">
              {ran
                ? preflight.ok
                  ? preflight.result.allowed
                    ? "Clears for human review"
                    : "Blocked by hard checks"
                  : "Invalid inputs"
                : "Awaiting preflight"}
            </h2>
          </div>
          {ran && preflight.ok ? (
            <div
              className={styles.verdict}
              data-allowed={preflight.result.allowed ? "true" : "false"}
            >
              <span>enforcement: {preflight.result.enforcement}</span>
              <strong>
                {preflight.result.allowed ? "ALLOWED" : "DENIED"} · {hardPassed}/{hardTotal} hard
              </strong>
            </div>
          ) : null}
        </div>

        {!ran ? (
          <div className={styles.emptyTickets}>
            <CircleAlert size={18} aria-hidden="true" />
            Edit the charter or proposal, load a hostile ticket, then run preflight. Results stay
            local — no network, no broker.
          </div>
        ) : error ? (
          <div className={styles.errorBox} role="alert">
            <ShieldAlert size={16} aria-hidden="true" />
            <div>
              <strong>Engine rejected inputs</strong>
              <p>{error}</p>
            </div>
          </div>
        ) : preflight.ok ? (
          <div className={styles.ticketGrid}>
            {preflight.result.checks.map((check) => (
              <article
                key={check.id}
                className={styles.ticket}
                data-passed={check.passed ? "true" : "false"}
                data-severity={check.severity}
              >
                <div className={styles.ticketIcon} aria-hidden="true">
                  {check.passed ? <Check size={14} /> : <X size={14} />}
                </div>
                <div className={styles.ticketBody}>
                  <div className={styles.ticketMeta}>
                    <span data-severity={check.severity}>{check.severity}</span>
                    <code>{check.id}</code>
                  </div>
                  <strong>{check.label}</strong>
                  <em>{check.detail}</em>
                </div>
                <span className={styles.ticketStamp}>{check.passed ? "PASS" : "FAIL"}</span>
              </article>
            ))}
          </div>
        ) : null}

        {ran && dualEval ? (
          <div className={styles.dualEval} aria-label="Charter dual-eval panel">
            <div className={styles.dualEvalHead}>
              <p className={styles.eyebrow}>Dual-eval · ledger vs session</p>
              <h3>Process layer only — still not a hard gateway</h3>
            </div>
            <div className={styles.dualCols}>
              <div
                className={styles.dualCol}
                data-allowed={dualEval.ledgerAllowed ? "true" : "false"}
              >
                <span>ledgerAllowed</span>
                <strong>{dualEval.ledgerAllowed ? "TRUE" : "FALSE"}</strong>
                <em>Local Control Room charter · evaluateProposal</em>
              </div>
              <div
                className={styles.dualCol}
                data-allowed={dualEval.allowed ? "true" : "false"}
              >
                <span>processAllowed</span>
                <strong>{dualEval.allowed ? "TRUE" : "FALSE"}</strong>
                <em>
                  After charterBindingEnforcement=
                  {dualEval.charterBindingEnforcement}
                </em>
              </div>
              <div className={styles.dualCol} data-allowed="info">
                <span>sessionCharterBinding</span>
                <strong className={styles.bindingCode}>{dualEval.sessionCharterBinding}</strong>
                <em>
                  sessionPolicyAllowed=
                  {String(dualEval.sessionPolicyAllowed ?? "n/a")} · processDeniedBySession=
                  {String(dualEval.processDeniedBySession)}
                </em>
              </div>
            </div>
            {dualEval.warningSuffix ? (
              <p className={styles.dualWarn}>{dualEval.warningSuffix.trim()}</p>
            ) : null}
            <p className={styles.dualFoot}>
              brokerEffect=false · compositeScore=false · not trading performance · host may still
              bypass Runbook
            </p>
          </div>
        ) : ran && bindSessionId && !dualEval ? (
          <div className={styles.emptyTickets}>
            Bound session could not be read for dual-eval. Refresh sessions or re-select.
          </div>
        ) : null}

        <p className={styles.footerNote}>
          <LockKeyhole size={14} aria-hidden="true" />
          Advisory only. Caller-supplied state. Not a hard gate over any broker. “Allowed” does not
          mean an account-wide control prevented other actions. Human confirmation must remain
          enabled and independently performed at the broker. For process theater, open{" "}
          <Link href="/theater">Process Theater</Link>; for recursive charter refine, open the{" "}
          <Link href="/shadow-lab">Shadow Process Lab</Link>.
        </p>
      </section>
    </main>
  );
}
