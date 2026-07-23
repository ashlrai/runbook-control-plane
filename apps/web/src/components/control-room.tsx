"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleAlert,
  Fingerprint,
  Gauge,
  LockKeyhole,
  Play,
  ShieldAlert,
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

  const preflight = useMemo(() => {
    try {
      const proposal: TradeProposal = {
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
      return { ok: true as const, result: evaluateProposal(charter, proposal) };
    } catch (err) {
      return {
        ok: false as const,
        message: err instanceof Error ? err.message : "Invalid policy or proposal inputs.",
      };
    }
  }, [charter, form]);

  const runPreflight = useCallback(() => {
    if (!preflight.ok) {
      setError(preflight.message);
      setRan(true);
      return;
    }
    setError(null);
    setRan(true);
  }, [preflight]);

  function updateForm<K extends keyof ProposalForm>(key: K, value: ProposalForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setRan(false);
    setError(null);
  }

  function updateCharterField(patch: Partial<RiskPolicy>) {
    setCharter((prev) => ({ ...prev, ...patch }));
    setCharterSource("edited");
    setRan(false);
    setError(null);
  }

  const hardPassed =
    preflight.ok ? preflight.result.checks.filter((c) => c.severity === "hard" && c.passed).length : 0;
  const hardTotal =
    preflight.ok ? preflight.result.checks.filter((c) => c.severity === "hard").length : 0;

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
          <Link href="/shadow-lab">Shadow Lab</Link>
          <Link href="/experiments/new">Charter builder</Link>
          <Link href="/mcp">MCP cockpit</Link>
          <Link href="/registry">Registry</Link>
          <Link href="/dossier">Dossier</Link>
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
            equity-only charter. Every check is a ticket with pass/fail drama. Allowed means the
            submitted proposal passed recorded charter checks — not that any broker was blocked.
          </p>
        </div>
        <aside className={styles.boundary} aria-label="Advisory enforcement boundary">
          <div className={styles.boundaryHead}>
            <span>ENFORCEMENT</span>
            <strong>ADVISORY</strong>
          </div>
          <ul>
            <li>Policy evaluation uses @runbook/engine — deterministic, local, browser-safe.</li>
            <li>Position, drawdown, trade-count, and evidence fields are caller-supplied — not broker truth.</li>
            <li>A direct brokerage tool can always bypass Runbook. This is not a hard gate.</li>
            <li>No composite process score. No credentials. No order execution path.</li>
          </ul>
        </aside>
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
                setForm(proposalFromDemo());
                setRan(false);
                setError(null);
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
            Edit the charter or proposal, then run preflight. Results stay local — no network, no broker.
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

        <p className={styles.footerNote}>
          <LockKeyhole size={14} aria-hidden="true" />
          Advisory only. Caller-supplied state. Not a hard gate over any broker. “Allowed” does not
          mean an account-wide control prevented other actions. Human confirmation must remain
          enabled and independently performed at the broker. For recursive charter refine theater,
          open the <Link href="/shadow-lab">Shadow Process Lab</Link>.
        </p>
      </section>
    </main>
  );
}
