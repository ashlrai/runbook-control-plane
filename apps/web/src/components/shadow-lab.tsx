"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Download,
  FlaskConical,
  Gauge,
  Link2,
  LockKeyhole,
  Play,
  RefreshCcw,
  Repeat2,
  ShieldAlert,
  Swords,
  Terminal,
  Trophy,
  X,
  AlertTriangle,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import type { RiskPolicy } from "../lib/runbook";
import {
  browserSessionStore,
  parseSessionIdQuery,
  resolveSessionCharterSeed,
  writeShadowLoopToSession,
} from "../lib/control-plane-session";
import {
  CURRICULUM_SCENARIOS,
  ELITE_EQUITY_CHARTER,
  SEED_LAB_POLICY,
  buildExportReport,
  clonePolicy,
  diffPolicy,
  evaluateCurriculum,
  evaluatePolicyAgainstMetaCurriculum,
  extractAndMergeMetaCurriculum,
  parseLedgerEventsJson,
  policyJsonForMcp,
  refinePolicy,
  runRefinementLoop,
  runTournament,
  sampleMetaLedgerJson,
  type GenerationRecord,
  type MetaCurriculumEvalMetrics,
  type MetaCurriculumMergeView,
  type PolicyFieldDelta,
  type ScenarioEvaluation,
  type TournamentUiCandidate,
  type TournamentUiReport,
} from "../lib/shadow-lab-browser";
import styles from "./shadow-lab.module.css";

type LabTab = "refine" | "tournament" | "meta";

function verdictLabel(verdict: ScenarioEvaluation["verdict"]): string {
  if (verdict === "process-correct") return "PROCESS CORRECT";
  if (verdict === "false-allow") return "FALSE ALLOW";
  return "FALSE DENY";
}

function formatPolicyValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? "∅ (open)" : value.join(", ");
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return String(value);
}

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
    <button type="button" className={styles.ghostBtn} onClick={() => void onCopy()} aria-label={label}>
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {copied ? "Copied" : "Copy policy JSON"}
    </button>
  );
}

function seedHistory(policy: RiskPolicy): GenerationRecord[] {
  const { metrics } = evaluateCurriculum(policy);
  return [
    {
      generation: 0,
      policy: clonePolicy(policy),
      metrics,
      appliedRules: [],
      delta: [],
      stoppedReason:
        metrics.hardFalseAllows === 0 && metrics.hardFalseDenies === 0
          ? "curriculum-clean"
          : "seed",
    },
  ];
}

export function ShadowLab() {
  const [tab, setTab] = useState<LabTab>("refine");
  const [policy, setPolicy] = useState<RiskPolicy>(() => clonePolicy(SEED_LAB_POLICY));
  const [history, setHistory] = useState<GenerationRecord[]>(() => seedHistory(SEED_LAB_POLICY));
  const [lastDelta, setLastDelta] = useState<readonly PolicyFieldDelta[]>([]);
  const [maxGenerations, setMaxGenerations] = useState(4);
  const [animKey, setAnimKey] = useState(0);
  const [statusNote, setStatusNote] = useState("Seed policy loaded · curriculum armed");
  const [boundSessionId, setBoundSessionId] = useState<string | null>(null);
  const [boundSessionLabel, setBoundSessionLabel] = useState<string | null>(null);
  const [sessionBindNote, setSessionBindNote] = useState<string | null>(null);

  // Tournament state
  const [tournamentGens, setTournamentGens] = useState(4);
  const [tournamentMutants, setTournamentMutants] = useState(4);
  const [tournamentSeed, setTournamentSeed] = useState(7);
  const [tournamentReport, setTournamentReport] = useState<TournamentUiReport | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [tournamentNote, setTournamentNote] = useState(
    "Set generations / mutants / seed · run multi-charter Pareto search",
  );

  // Meta-curriculum state
  const [ledgerJson, setLedgerJson] = useState("");
  const [metaView, setMetaView] = useState<MetaCurriculumMergeView | null>(null);
  const [metaEval, setMetaEval] = useState<MetaCurriculumEvalMetrics | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaNote, setMetaNote] = useState(
    "Paste ledger-like JSON or load the sample proposal+preflight fixture",
  );

  // Bind to Control Plane Session via ?sessionId= deep link.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sessionId = parseSessionIdQuery(window.location.search);
    if (!sessionId) {
      setBoundSessionId(null);
      setBoundSessionLabel(null);
      setSessionBindNote(null);
      return;
    }
    try {
      const session = browserSessionStore.read(sessionId);
      const { seed, usedWeakFallback } = resolveSessionCharterSeed(session);
      setPolicy(clonePolicy(seed));
      setHistory(seedHistory(seed));
      setLastDelta([]);
      setBoundSessionId(session.sessionId);
      setBoundSessionLabel(session.label);
      setSessionBindNote(
        usedWeakFallback
          ? `Loaded session ${session.sessionId} · no charter yet — weak seed armed for refine`
          : `Loaded session ${session.sessionId} charter into working policy`,
      );
      setStatusNote(
        usedWeakFallback
          ? `Bound to ${session.sessionId} · weak seed (session had no charter)`
          : `Bound to ${session.sessionId} · session charter loaded`,
      );
      setAnimKey((k) => k + 1);
    } catch {
      setBoundSessionId(null);
      setBoundSessionLabel(null);
      setSessionBindNote(
        `sessionId=${sessionId} not found in browser localStorage · create it on /session first`,
      );
    }
  }, []);

  const evaluation = useMemo(() => evaluateCurriculum(policy), [policy]);
  const { metrics, results } = evaluation;

  const eliteDiff = useMemo(
    () => diffPolicy(ELITE_EQUITY_CHARTER, policy),
    [policy],
  );

  const changedFields = useMemo(() => {
    return new Set(lastDelta.map((d) => d.field));
  }, [lastDelta]);

  const rerunAnimation = useCallback(() => {
    setAnimKey((k) => k + 1);
  }, []);

  const loadSeed = useCallback(() => {
    const next = clonePolicy(SEED_LAB_POLICY);
    setPolicy(next);
    setHistory(seedHistory(next));
    setLastDelta([]);
    setStatusNote("Reset to loose seed policy");
    rerunAnimation();
  }, [rerunAnimation]);

  const loadElite = useCallback(() => {
    const next = clonePolicy(ELITE_EQUITY_CHARTER);
    setPolicy(next);
    setHistory(seedHistory(next));
    setLastDelta([]);
    setStatusNote("Loaded elite equity reference charter");
    rerunAnimation();
  }, [rerunAnimation]);

  const runOneGeneration = useCallback(() => {
    const refined = refinePolicy(policy);
    if (refined.fixedPoint || refined.appliedRules.length === 0) {
      setStatusNote("Fixed point — refine rules produced no further policy change");
      setLastDelta([]);
      rerunAnimation();
      return;
    }

    const nextPolicy = refined.policy;
    const nextEval = evaluateCurriculum(nextPolicy);
    const generation = (history[history.length - 1]?.generation ?? 0) + 1;
    const record: GenerationRecord = {
      generation,
      policy: clonePolicy(nextPolicy),
      metrics: nextEval.metrics,
      appliedRules: refined.appliedRules,
      delta: refined.delta,
      stoppedReason:
        nextEval.metrics.hardFalseAllows === 0 && nextEval.metrics.hardFalseDenies === 0
          ? "curriculum-clean"
          : undefined,
    };

    setPolicy(nextPolicy);
    setHistory((prev) => [...prev, record]);
    setLastDelta(refined.delta);
    setStatusNote(
      nextEval.metrics.hardFalseAllows === 0
        ? `Generation ${generation} · curriculum clean`
        : `Generation ${generation} · applied ${refined.appliedRules.length} rule(s)`,
    );
    rerunAnimation();
  }, [history, policy, rerunAnimation]);

  const runUntilFixedPoint = useCallback(() => {
    const loop = runRefinementLoop({
      seed: policy,
      maxGenerations,
      untilFixedPoint: true,
    });

    // Merge: keep prior history base, append loop steps after seed of loop
    const baseGen = history[history.length - 1]?.generation ?? 0;
    const appended = loop.slice(1).map((row) => ({
      ...row,
      generation: baseGen + row.generation,
    }));

    const finalPolicy = clonePolicy(loop[loop.length - 1]!.policy);
    const finalDelta =
      loop.length > 1
        ? diffPolicy(policy, finalPolicy)
        : [];

    setPolicy(finalPolicy);
    setHistory((prev) => {
      if (appended.length === 0) {
        const copy = [...prev];
        if (copy.length > 0) {
          copy[copy.length - 1] = {
            ...copy[copy.length - 1]!,
            stoppedReason: loop[0]?.stoppedReason ?? "fixed-point",
          };
        }
        return copy;
      }
      return [...prev, ...appended];
    });
    setLastDelta(finalDelta);
    const final = loop[loop.length - 1]!;
    const note =
      final.stoppedReason === "curriculum-clean"
        ? `Fixed-point loop · curriculum clean after ${loop.length - 1} generation(s)`
        : final.stoppedReason === "max-generations"
          ? `Stopped at maxGenerations=${maxGenerations}`
          : `Fixed-point loop complete · ${loop.length - 1} generation(s)`;

    // When bound to a Control Plane Session, write charter + shadow metrics back.
    if (boundSessionId) {
      void writeShadowLoopToSession({
        sessionId: boundSessionId,
        history: loop,
      })
        .then((written) => {
          setStatusNote(
            `${note} · wrote back to ${boundSessionId} · HFA ${written.finalHardFalseAllows} / HFD ${written.finalHardFalseDenies} · ${written.generationsRecorded} gen recorded`,
          );
          setSessionBindNote(
            `Wrote refined charter + ${written.generationsRecorded} shadow generation(s) to ${boundSessionId}`,
          );
        })
        .catch((error: unknown) => {
          setStatusNote(
            `${note} · session write-back failed: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        });
    } else {
      setStatusNote(note);
    }
    rerunAnimation();
  }, [boundSessionId, history, maxGenerations, policy, rerunAnimation]);

  const downloadReport = useCallback(() => {
    const report = buildExportReport(history);
    const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `shadow-lab-report-gen${history[history.length - 1]?.generation ?? 0}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [history]);

  const runTournamentPanel = useCallback(() => {
    const report = runTournament({
      maxGenerations: tournamentGens,
      mutantCount: tournamentMutants,
      seed: tournamentSeed,
    });
    setTournamentReport(report);
    const firstPareto = report.paretoFront[0] ?? null;
    setSelectedCandidateId(firstPareto?.id ?? report.candidates[0]?.id ?? null);
    setTournamentNote(
      `Tournament complete · ${report.candidateCount} candidates · ${report.paretoCount} on Pareto front · capital 0 · compositeScore false`,
    );
  }, [tournamentGens, tournamentMutants, tournamentSeed]);

  const adoptSelectedPareto = useCallback(() => {
    if (!tournamentReport || !selectedCandidateId) return;
    const candidate =
      tournamentReport.candidates.find((c) => c.id === selectedCandidateId) ?? null;
    if (!candidate) return;
    if (!candidate.onParetoFront) {
      setTournamentNote("Select a Pareto-front candidate before adopting into the lab policy.");
      return;
    }
    const next = clonePolicy(candidate.finalPolicy);
    setPolicy(next);
    setHistory(seedHistory(next));
    setLastDelta([]);
    setTab("refine");
    setStatusNote(
      `Adopted Pareto policy from ${candidate.seedKind} (${candidate.id}) · HFA ${candidate.hardFalseAllows} / HFD ${candidate.hardFalseDenies}`,
    );
    setTournamentNote(
      `Adopted ${candidate.id} into working lab policy · switched to Refine tab`,
    );
    rerunAnimation();
  }, [rerunAnimation, selectedCandidateId, tournamentReport]);

  const loadSampleMeta = useCallback(() => {
    setLedgerJson(sampleMetaLedgerJson());
    setMetaError(null);
    setMetaNote("Sample proposal+preflight fixture loaded · extract & merge to expand curriculum");
  }, []);

  const runMetaExtract = useCallback(() => {
    try {
      const events = parseLedgerEventsJson(ledgerJson);
      const view = extractAndMergeMetaCurriculum(events);
      setMetaView(view);
      setMetaEval(null);
      setMetaError(null);
      setMetaNote(
        `Extracted ${view.candidateCount} ledger-derived candidate(s) · merged ${view.mergedCount} scenarios · ledger not mutated`,
      );
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "Failed to extract meta-curriculum");
      setMetaView(null);
      setMetaEval(null);
    }
  }, [ledgerJson]);

  const reevaluateAgainstMeta = useCallback(() => {
    try {
      const events = parseLedgerEventsJson(ledgerJson);
      const evalMetrics = evaluatePolicyAgainstMetaCurriculum(policy, events);
      setMetaEval(evalMetrics);
      setMetaError(null);
      setMetaNote(
        `Re-evaluated working policy on merged curriculum · HFA ${evalMetrics.hardFalseAllows} / HFD ${evalMetrics.hardFalseDenies} / processCorrect ${evalMetrics.processCorrect}`,
      );
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "Failed to re-evaluate against meta curriculum");
      setMetaEval(null);
    }
  }, [ledgerJson, policy]);

  const policyFields: { key: keyof RiskPolicy; label: string }[] = [
    { key: "capitalBudget", label: "Capital budget" },
    { key: "cashReserve", label: "Cash reserve" },
    { key: "maxPositionPercent", label: "Max position %" },
    { key: "maxOrderNotional", label: "Max order notional" },
    { key: "maxDrawdownPercent", label: "Max drawdown %" },
    { key: "maxDailyTrades", label: "Max daily trades" },
    { key: "allowedInstruments", label: "Allowed instruments" },
    { key: "allowedSymbols", label: "Allowed symbols" },
    { key: "deniedSymbols", label: "Denied symbols" },
    { key: "approvalRequired", label: "Approval required" },
  ];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Runbook home">
          <BrandMark />
          <span>Runbook</span>
          <em>Shadow Lab</em>
        </Link>
        <nav className={styles.headerNav} aria-label="Shadow Lab navigation">
          <Link href="/">Product map</Link>
          <Link href="/session">Session</Link>
          <Link href="/control-room">Control Room</Link>
          <Link href="/mcp">MCP cockpit</Link>
          <Link href="/experiments/new">Charter builder</Link>
          <Link href="/registry">Registry</Link>
        </nav>
      </header>

      <div className={styles.truthRail} role="note" aria-label="Shadow Lab honesty boundary">
        <span>PROCESS CONTROL LAB</span>
        <span>SYNTHETIC CURRICULUM</span>
        <span>NO CAPITAL / NO BROKER</span>
        <span>ADVISORY ONLY</span>
        <span>NO COMPOSITE SCORE</span>
        <span>TOURNAMENT ≠ TRADING PERF</span>
        <span>CAPITAL 0</span>
      </div>

      {boundSessionId ? (
        <div
          className={styles.sessionBoundBanner}
          role="status"
          aria-live="polite"
          aria-label="Bound session banner"
        >
          <Link2 size={16} aria-hidden="true" />
          <div>
            <strong>Bound to session {boundSessionId}</strong>
            <p>
              {boundSessionLabel ? `${boundSessionLabel} · ` : ""}
              Working policy loaded from BrowserSessionStore. “Run until fixed point” writes
              refined charter + shadow generation metrics back to the session.
              {sessionBindNote ? ` ${sessionBindNote}.` : ""}
            </p>
          </div>
          <Link className={styles.sessionBoundLink} href="/session">
            Open Session
          </Link>
        </div>
      ) : sessionBindNote ? (
        <div
          className={styles.sessionBoundBanner}
          data-tone="warn"
          role="status"
          aria-live="polite"
          aria-label="Session bind notice"
        >
          <ShieldAlert size={16} aria-hidden="true" />
          <div>
            <strong>Session bind</strong>
            <p>{sessionBindNote}</p>
          </div>
          <Link className={styles.sessionBoundLink} href="/session">
            Open Session
          </Link>
        </div>
      ) : null}

      <div className={styles.banner} role="status" aria-live="polite">
        <ShieldAlert size={18} aria-hidden="true" />
        <div>
          <strong>Recursive charter self-improvement · process quality only</strong>
          <p>
            This lab improves <em>process control quality</em> under a synthetic curriculum — not
            investment skill. Advisory only. No capital. No broker. No credentials. Metrics are
            hardFalseAllows / hardFalseDenies / scenario counts — never a composite score or return %.
          </p>
        </div>
      </div>

      <section className={styles.hero} aria-labelledby="shadow-lab-title">
        <div>
          <p className={styles.eyebrow}>Shadow Process Lab · browser-local refine rules</p>
          <h1 id="shadow-lab-title">Make recursive charter self-improvement visible.</h1>
          <p className={styles.lede}>
            Load a reference elite equity charter, score a synthetic proposal curriculum with the real{" "}
            <code>evaluateProposal</code> engine, then apply deterministic refine rules until
            false-allows collapse. Run multi-charter <strong>tournaments</strong> (Pareto on HFA/HFD)
            or expand the curriculum via offline <strong>meta-curriculum</strong> extract/merge.
            Theater for builders — not a live trading UI.
          </p>
        </div>
        <aside className={styles.boundary} aria-label="Lab boundary">
          <div className={styles.boundaryHead}>
            <span>LAB BOUNDARY</span>
            <strong>EXPLICIT</strong>
          </div>
          <ul>
            <li>Curriculum shouldAllow is author-declared process truth — not market outcome truth.</li>
            <li>False-allow is critical: the policy cleared a proposal the curriculum rejects.</li>
            <li>Tournament Pareto is process quality only — notTradingPerformance, capital 0, compositeScore false.</li>
            <li>Meta-curriculum labels are synthetic process labels from ledger preflights — not market truth.</li>
            <li>Refine / tournament / meta authority: @runbook/shadow-lab (browser adapter maps UI shapes only).</li>
          </ul>
        </aside>
      </section>

      <nav className={styles.tabs} aria-label="Shadow Lab surfaces" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "refine"}
          className={styles.tab}
          data-active={tab === "refine" ? "true" : "false"}
          onClick={() => setTab("refine")}
        >
          <Repeat2 size={14} aria-hidden="true" />
          Refine loop
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "tournament"}
          className={styles.tab}
          data-active={tab === "tournament" ? "true" : "false"}
          onClick={() => setTab("tournament")}
        >
          <Trophy size={14} aria-hidden="true" />
          Tournament
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "meta"}
          className={styles.tab}
          data-active={tab === "meta" ? "true" : "false"}
          onClick={() => setTab("meta")}
        >
          <FlaskConical size={14} aria-hidden="true" />
          Meta-curriculum
        </button>
      </nav>

      {tab === "tournament" ? (
        <TournamentPanel
          maxGenerations={tournamentGens}
          mutantCount={tournamentMutants}
          seed={tournamentSeed}
          onMaxGenerations={setTournamentGens}
          onMutantCount={setTournamentMutants}
          onSeed={setTournamentSeed}
          onRun={runTournamentPanel}
          report={tournamentReport}
          selectedId={selectedCandidateId}
          onSelect={setSelectedCandidateId}
          onAdopt={adoptSelectedPareto}
          statusNote={tournamentNote}
        />
      ) : null}

      {tab === "meta" ? (
        <MetaCurriculumPanel
          ledgerJson={ledgerJson}
          onLedgerJson={setLedgerJson}
          onLoadSample={loadSampleMeta}
          onExtract={runMetaExtract}
          onReevaluate={reevaluateAgainstMeta}
          view={metaView}
          evalMetrics={metaEval}
          error={metaError}
          statusNote={metaNote}
        />
      ) : null}

      {tab !== "refine" ? (
        <p className={styles.footerNote}>
          <LockKeyhole size={14} aria-hidden="true" />
          <span>
            Shadow Process Lab is not a live trading surface. Open the{" "}
            <Link href="/control-room">
              <Gauge size={12} aria-hidden="true" /> Control Room
            </Link>{" "}
            for single-proposal preflight, or the{" "}
            <Link href="/mcp">
              <Terminal size={12} aria-hidden="true" /> MCP cockpit
            </Link>{" "}
            for the offline companion install path. No Robinhood network. No credentials.
          </span>
        </p>
      ) : null}

      {tab === "refine" ? (
        <>
      <section className={styles.metrics} aria-label="Curriculum metrics strip">
        <div className={styles.metric} data-tone="critical" aria-label="Hard false allows">
          <span>hardFalseAllows</span>
          <strong>{metrics.hardFalseAllows}</strong>
        </div>
        <div className={styles.metric} data-tone="warn" aria-label="Hard false denies">
          <span>hardFalseDenies</span>
          <strong>{metrics.hardFalseDenies}</strong>
        </div>
        <div className={styles.metric} data-tone="ok" aria-label="Process correct scenarios">
          <span>processCorrect</span>
          <strong>{metrics.processCorrect}</strong>
        </div>
        <div className={styles.metric} data-tone="neutral" aria-label="Scenario count">
          <span>scenarioCount</span>
          <strong>{metrics.scenarioCount}</strong>
        </div>
      </section>

      <section className={styles.controls} aria-label="Recursive loop controls">
        <div className={styles.controlGroup}>
          <label htmlFor="max-generations">
            maxGenerations (1–8)
            <div className={styles.sliderRow}>
              <input
                id="max-generations"
                type="range"
                min={1}
                max={8}
                step={1}
                value={maxGenerations}
                onChange={(e) => setMaxGenerations(Number(e.target.value))}
              />
              <em>{maxGenerations}</em>
            </div>
          </label>
          <p style={{ margin: 0, color: "#8b9bb3", fontSize: 12 }} role="status">
            {statusNote}
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} onClick={runOneGeneration}>
            <Play size={14} fill="currentColor" aria-hidden="true" />
            Run refinement generation
          </button>
          <button type="button" className={styles.secondaryBtn} onClick={runUntilFixedPoint}>
            <Repeat2 size={14} aria-hidden="true" />
            Run until fixed point
          </button>
          <button type="button" className={styles.ghostBtn} onClick={loadSeed}>
            <RefreshCcw size={14} aria-hidden="true" />
            Reset seed
          </button>
          <button type="button" className={styles.ghostBtn} onClick={loadElite}>
            Load elite reference
          </button>
        </div>
      </section>

      <div className={styles.layout}>
        <section className={styles.panel} aria-labelledby="policy-title">
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>Working policy</p>
              <h2 id="policy-title">Live charter under test</h2>
            </div>
            <span
              className={styles.chip}
              data-tone={metrics.hardFalseAllows > 0 ? "critical" : "ok"}
            >
              {metrics.hardFalseAllows > 0
                ? `${metrics.hardFalseAllows} false-allow`
                : "curriculum clean"}
            </span>
          </div>
          <div className={styles.policyGrid}>
            {policyFields.map(({ key, label }) => (
              <div
                key={key}
                className={styles.policyField}
                data-changed={changedFields.has(key) ? "true" : "false"}
              >
                <span>{label}</span>
                <strong>{formatPolicyValue(policy[key])}</strong>
              </div>
            ))}
          </div>
          {lastDelta.length > 0 ? (
            <>
              <div className={styles.panelHead} style={{ borderTop: "1px solid #243149" }}>
                <div>
                  <p className={styles.eyebrow}>Policy delta</p>
                  <h2>Before → after this generation</h2>
                </div>
              </div>
              <ul className={styles.deltaList} aria-label="Policy field deltas">
                {lastDelta.map((d) => (
                  <li key={d.field}>
                    <code>{d.field}</code>: {formatPolicyValue(d.before)} →{" "}
                    <em>{formatPolicyValue(d.after)}</em>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {eliteDiff.length > 0 ? (
            <p
              style={{
                margin: "0 16px 16px",
                color: "#7d8eaa",
                fontSize: 11,
                lineHeight: 1.45,
              }}
            >
              Working policy differs from elite reference on {eliteDiff.length} field
              {eliteDiff.length === 1 ? "" : "s"} (delta vs elite is informational — refine targets
              curriculum agreement, not elite byte-equality).
            </p>
          ) : (
            <p
              style={{
                margin: "0 16px 16px",
                color: "#6ee7b0",
                fontSize: 11,
              }}
            >
              Working policy matches elite reference field-for-field.
            </p>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="history-title">
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>Generation history</p>
              <h2 id="history-title">Metrics trend</h2>
            </div>
            <span className={styles.chip}>{history.length} record(s)</span>
          </div>
          <div className={styles.history} role="list">
            {history.map((row, index) => {
              const prev = index > 0 ? history[index - 1] : null;
              const improving =
                prev !== null &&
                row.metrics.hardFalseAllows < prev.metrics.hardFalseAllows;
              return (
                <article key={`${row.generation}-${index}`} className={styles.historyRow} role="listitem">
                  <strong>G{row.generation}</strong>
                  <p>
                    {row.appliedRules.length > 0
                      ? row.appliedRules.join(" · ")
                      : row.stoppedReason ?? "baseline"}
                  </p>
                  <div
                    className={styles.historyTrend}
                    data-improving={improving ? "true" : "false"}
                  >
                    FA {row.metrics.hardFalseAllows}
                    <br />
                    FD {row.metrics.hardFalseDenies}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <section className={styles.tickets} aria-labelledby="curriculum-title" aria-live="polite">
        <div className={styles.ticketsHead}>
          <div>
            <p className={styles.eyebrow}>Curriculum theater · {CURRICULUM_SCENARIOS.length} scenarios</p>
            <h2 id="curriculum-title">
              {metrics.hardFalseAllows > 0
                ? `${metrics.hardFalseAllows} critical false-allow${metrics.hardFalseAllows === 1 ? "" : "s"} under current policy`
                : metrics.hardFalseDenies > 0
                  ? `${metrics.hardFalseDenies} false-deny remaining`
                  : "All scenarios process-correct"}
            </h2>
          </div>
        </div>
        <div className={styles.ticketGrid} key={animKey}>
          {results.map((row, index) => (
            <ScenarioTicket key={row.scenario.id} row={row} delayMs={index * 28} />
          ))}
        </div>
      </section>

      <section className={styles.exportBar} aria-label="Export controls">
        <p>
          Download the full generation report, or copy refined policy JSON for MCP{" "}
          <code>runbook_create_experiment</code>. Local only.
        </p>
        <button type="button" className={styles.primaryBtn} onClick={downloadReport}>
          <Download size={14} aria-hidden="true" />
          Download JSON report
        </button>
        <CopyButton text={policyJsonForMcp(policy)} label="Copy refined policy JSON for MCP" />
      </section>

      <p className={styles.footerNote}>
        <LockKeyhole size={14} aria-hidden="true" />
        <span>
          Shadow Process Lab is not a live trading surface. Open the{" "}
          <Link href="/control-room">
            <Gauge size={12} aria-hidden="true" /> Control Room
          </Link>{" "}
          for single-proposal preflight, or the{" "}
          <Link href="/mcp">
            <Terminal size={12} aria-hidden="true" /> MCP cockpit
          </Link>{" "}
          for the offline companion install path. No Robinhood network. No credentials.
        </span>
      </p>
        </>
      ) : null}
    </main>
  );
}

function TournamentPanel({
  maxGenerations,
  mutantCount,
  seed,
  onMaxGenerations,
  onMutantCount,
  onSeed,
  onRun,
  report,
  selectedId,
  onSelect,
  onAdopt,
  statusNote,
}: {
  maxGenerations: number;
  mutantCount: number;
  seed: number;
  onMaxGenerations: (n: number) => void;
  onMutantCount: (n: number) => void;
  onSeed: (n: number) => void;
  onRun: () => void;
  report: TournamentUiReport | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdopt: () => void;
  statusNote: string;
}) {
  const selected: TournamentUiCandidate | null =
    report?.candidates.find((c) => c.id === selectedId) ?? null;

  return (
    <section className={styles.surfacePanel} aria-labelledby="tournament-title">
      <div className={styles.ticketsHead}>
        <div>
          <p className={styles.eyebrow}>Multi-charter tournament · Pareto process search</p>
          <h2 id="tournament-title">Rank charters on hardFalseAllows vs hardFalseDenies</h2>
        </div>
        <span className={styles.chip} data-tone="ok">
          not trading performance
        </span>
      </div>

      <div className={styles.truthRailInline} role="note" aria-label="Tournament truth rail">
        <span>NOT TRADING PERFORMANCE</span>
        <span>CAPITAL 0</span>
        <span>COMPOSITESCORE FALSE</span>
        <span>BROKER EFFECT FALSE</span>
        <span>ADVISORY ONLY</span>
      </div>

      <div className={styles.controls} style={{ margin: "0", border: 0, borderBottom: "1px solid var(--sl-line)" }}>
        <div className={styles.controlGroup}>
          <div className={styles.tournamentControls}>
            <label htmlFor="tournament-gens">
              generations (1–8)
              <div className={styles.sliderRow}>
                <input
                  id="tournament-gens"
                  type="range"
                  min={1}
                  max={8}
                  step={1}
                  value={maxGenerations}
                  onChange={(e) => onMaxGenerations(Number(e.target.value))}
                />
                <em>{maxGenerations}</em>
              </div>
            </label>
            <label htmlFor="tournament-mutants">
              mutants (0–12)
              <div className={styles.sliderRow}>
                <input
                  id="tournament-mutants"
                  type="range"
                  min={0}
                  max={12}
                  step={1}
                  value={mutantCount}
                  onChange={(e) => onMutantCount(Number(e.target.value))}
                />
                <em>{mutantCount}</em>
              </div>
            </label>
            <label htmlFor="tournament-seed">
              fixed seed
              <input
                id="tournament-seed"
                className={styles.numberInput}
                type="number"
                step={1}
                value={seed}
                onChange={(e) => onSeed(Number(e.target.value) || 0)}
              />
            </label>
          </div>
          <p style={{ margin: 0, color: "#8b9bb3", fontSize: 12 }} role="status">
            {statusNote}
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} onClick={onRun}>
            <Swords size={14} aria-hidden="true" />
            Run tournament
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onAdopt}
            disabled={!selected?.onParetoFront}
          >
            <Trophy size={14} aria-hidden="true" />
            Adopt Pareto policy
          </button>
        </div>
      </div>

      {report ? (
        <>
          <section className={styles.metrics} style={{ margin: "16px 18px 0" }} aria-label="Tournament summary metrics">
            <div className={styles.metric} data-tone="neutral" aria-label="Candidate count">
              <span>candidates</span>
              <strong>{report.candidateCount}</strong>
            </div>
            <div className={styles.metric} data-tone="ok" aria-label="Pareto count">
              <span>paretoFront</span>
              <strong>{report.paretoCount}</strong>
            </div>
            <div className={styles.metric} data-tone="neutral" aria-label="Tournament seed">
              <span>seed</span>
              <strong>{report.seed}</strong>
            </div>
            <div className={styles.metric} data-tone="ok" aria-label="Capital always zero">
              <span>capital</span>
              <strong>{report.capital}</strong>
            </div>
          </section>

          <div className={styles.tableWrap} role="region" aria-label="Tournament candidates table">
            <table className={styles.candidateTable}>
              <thead>
                <tr>
                  <th scope="col">Select</th>
                  <th scope="col">seedKind</th>
                  <th scope="col">HFA</th>
                  <th scope="col">HFD</th>
                  <th scope="col">processCorrect</th>
                  <th scope="col">onParetoFront</th>
                  <th scope="col">gens</th>
                  <th scope="col">id</th>
                </tr>
              </thead>
              <tbody>
                {report.candidates.map((row) => (
                  <tr
                    key={row.id}
                    data-pareto={row.onParetoFront ? "true" : "false"}
                    data-selected={row.id === selectedId ? "true" : "false"}
                  >
                    <td>
                      <input
                        type="radio"
                        name="tournament-candidate"
                        checked={row.id === selectedId}
                        onChange={() => onSelect(row.id)}
                        aria-label={`Select candidate ${row.id}`}
                      />
                    </td>
                    <td>
                      <code>{row.seedKind}</code>
                    </td>
                    <td>{row.hardFalseAllows}</td>
                    <td>{row.hardFalseDenies}</td>
                    <td>{row.processCorrect ? "true" : "false"}</td>
                    <td>
                      {row.onParetoFront ? (
                        <span className={styles.paretoBadge}>PARETO</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{row.generationCount}</td>
                    <td>
                      <code className={styles.monoMuted}>{row.id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className={styles.panelFootnote}>
            {report.note} compositeScore={String(report.compositeScore)} · capital={report.capital} ·
            notTradingPerformance={String(report.notTradingPerformance)}.
          </p>
        </>
      ) : (
        <p className={styles.panelFootnote}>
          Run a tournament to populate candidates. Seeds always include weak-starter + reference-elite
          plus N deterministic mutants. Pareto front minimizes hardFalseAllows then hardFalseDenies.
        </p>
      )}
    </section>
  );
}

function MetaCurriculumPanel({
  ledgerJson,
  onLedgerJson,
  onLoadSample,
  onExtract,
  onReevaluate,
  view,
  evalMetrics,
  error,
  statusNote,
}: {
  ledgerJson: string;
  onLedgerJson: (value: string) => void;
  onLoadSample: () => void;
  onExtract: () => void;
  onReevaluate: () => void;
  view: MetaCurriculumMergeView | null;
  evalMetrics: MetaCurriculumEvalMetrics | null;
  error: string | null;
  statusNote: string;
}) {
  return (
    <section className={styles.surfacePanel} aria-labelledby="meta-title">
      <div className={styles.ticketsHead}>
        <div>
          <p className={styles.eyebrow}>Offline meta-learning · ledger → synthetic curriculum</p>
          <h2 id="meta-title">Expand process curriculum from preflight failures</h2>
        </div>
        <span className={styles.chip}>ledger not mutated</span>
      </div>

      <div className={styles.truthRailInline} role="note" aria-label="Meta-curriculum truth rail">
        <span>SYNTHETIC PROCESS LABELS</span>
        <span>NOT MARKET TRUTH</span>
        <span>NO COMPOSITE SCORE</span>
        <span>OFFLINE ONLY</span>
      </div>

      <div className={styles.metaLayout}>
        <div className={styles.metaPaste}>
          <label htmlFor="meta-ledger-json">
            Ledger-like JSON events (proposal + preflight pairs)
          </label>
          <textarea
            id="meta-ledger-json"
            className={styles.metaTextarea}
            value={ledgerJson}
            onChange={(e) => onLedgerJson(e.target.value)}
            spellCheck={false}
            placeholder='[{ "type": "proposal.recorded", "payload": { ... } }, ...]'
            rows={14}
          />
          <div className={styles.actions} style={{ justifyContent: "flex-start" }}>
            <button type="button" className={styles.ghostBtn} onClick={onLoadSample}>
              <Download size={14} aria-hidden="true" />
              Load sample fixture
            </button>
            <button type="button" className={styles.primaryBtn} onClick={onExtract}>
              <FlaskConical size={14} aria-hidden="true" />
              Extract + merge
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={onReevaluate}>
              <Play size={14} aria-hidden="true" />
              Re-evaluate working policy
            </button>
          </div>
          <p style={{ margin: "10px 0 0", color: "#8b9bb3", fontSize: 12 }} role="status">
            {statusNote}
          </p>
          {error ? (
            <p className={styles.metaError} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className={styles.metaResults}>
          {view ? (
            <>
              <section className={styles.metrics} style={{ margin: 0 }} aria-label="Meta-curriculum counts">
                <div className={styles.metric} data-tone="ok" aria-label="Candidate count">
                  <span>candidates</span>
                  <strong>{view.candidateCount}</strong>
                </div>
                <div className={styles.metric} data-tone="neutral" aria-label="Merged count">
                  <span>merged</span>
                  <strong>{view.mergedCount}</strong>
                </div>
                <div className={styles.metric} data-tone="neutral" aria-label="Ledger-derived in merge">
                  <span>ledger-derived</span>
                  <strong>{view.ledgerDerivedInMerged}</strong>
                </div>
                <div className={styles.metric} data-tone="ok" aria-label="Ledger mutated flag">
                  <span>ledgerMutated</span>
                  <strong>{String(view.ledgerMutated)}</strong>
                </div>
              </section>

              <div className={styles.panelHead} style={{ padding: "12px 0", minHeight: 0, border: 0 }}>
                <div>
                  <p className={styles.eyebrow}>Tags observed</p>
                  <h2 style={{ fontSize: 16 }}>Process tags from failed checks</h2>
                </div>
              </div>
              <div className={styles.ticketTags} aria-label="Meta curriculum tags">
                {view.tags.length === 0 ? (
                  <span>no ledger-derived tags</span>
                ) : (
                  view.tags.map((tag) => <span key={tag}>{tag}</span>)
                )}
              </div>

              <div className={styles.panelHead} style={{ padding: "16px 0 8px", minHeight: 0, border: 0 }}>
                <div>
                  <p className={styles.eyebrow}>Sample scenarios</p>
                  <h2 style={{ fontSize: 16 }}>Merged curriculum preview</h2>
                </div>
                <span className={styles.chip}>{view.sampleScenarios.length} shown</span>
              </div>
              <ul className={styles.metaScenarioList} aria-label="Sample merged scenarios">
                {view.sampleScenarios.map((s) => (
                  <li key={s.id}>
                    <div className={styles.ticketMeta}>
                      <span>{s.source}</span>
                      <code>{s.id}</code>
                      <span>{s.shouldAllow ? "shouldAllow" : "shouldDeny"}</span>
                    </div>
                    <strong>{s.label}</strong>
                    <div className={styles.ticketTags}>
                      {s.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>

              {view.candidates.length > 0 ? (
                <>
                  <div className={styles.panelHead} style={{ padding: "16px 0 8px", minHeight: 0, border: 0 }}>
                    <div>
                      <p className={styles.eyebrow}>Ledger-derived candidates</p>
                      <h2 style={{ fontSize: 16 }}>Extracted deny scenarios</h2>
                    </div>
                  </div>
                  <ul className={styles.metaScenarioList} aria-label="Ledger-derived candidates">
                    {view.candidates.map((c) => (
                      <li key={c.id}>
                        <div className={styles.ticketMeta}>
                          <span>
                            {c.symbol} · {c.instrument}
                          </span>
                          <code>{c.id}</code>
                        </div>
                        <strong>{c.label}</strong>
                        <div className={styles.ticketTags}>
                          {c.tags.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {evalMetrics ? (
                <section
                  className={styles.metrics}
                  style={{ margin: "16px 0 0" }}
                  aria-label="Merged curriculum evaluation"
                >
                  <div className={styles.metric} data-tone="critical" aria-label="Meta hard false allows">
                    <span>hardFalseAllows</span>
                    <strong>{evalMetrics.hardFalseAllows}</strong>
                  </div>
                  <div className={styles.metric} data-tone="warn" aria-label="Meta hard false denies">
                    <span>hardFalseDenies</span>
                    <strong>{evalMetrics.hardFalseDenies}</strong>
                  </div>
                  <div className={styles.metric} data-tone="ok" aria-label="Meta process correct">
                    <span>processCorrect</span>
                    <strong>{evalMetrics.processCorrect}</strong>
                  </div>
                  <div className={styles.metric} data-tone="neutral" aria-label="Meta scenario count">
                    <span>scenarioCount</span>
                    <strong>{evalMetrics.scenarioCount}</strong>
                  </div>
                </section>
              ) : null}

              <p className={styles.panelFootnote}>
                Assurance: {view.assurance}. Limitations: {view.limitations.slice(0, 3).join(" · ")}.
                Labels are synthetic process labels for training — not market truth, not trading
                performance.
              </p>
            </>
          ) : (
            <p className={styles.panelFootnote}>
              Load the sample fixture or paste ledger-like events, then extract + merge. The closed
              synthetic curriculum stays preferred on fingerprint collisions. Max 20 ledger candidates
              / 40 merged scenarios.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ScenarioTicket({
  row,
  delayMs,
}: {
  row: ScenarioEvaluation;
  delayMs: number;
}) {
  const Icon =
    row.verdict === "process-correct"
      ? Check
      : row.verdict === "false-allow"
        ? AlertTriangle
        : X;

  return (
    <article
      className={styles.ticket}
      data-verdict={row.verdict}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className={styles.ticketIcon} aria-hidden="true">
        <Icon size={14} />
      </div>
      <div className={styles.ticketBody}>
        <div className={styles.ticketMeta}>
          <span>{row.scenario.shouldAllow ? "shouldAllow: true" : "shouldAllow: false"}</span>
          <code>{row.scenario.id}</code>
        </div>
        <strong>{row.scenario.label}</strong>
        <em>{row.scenario.rationale}</em>
        <div className={styles.ticketTags}>
          {row.scenario.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        <p className={styles.engineLine}>
          engine: {row.result.allowed ? "ALLOWED" : "DENIED"} · enforcement:{" "}
          {row.result.enforcement} · hard{" "}
          {row.result.checks.filter((c) => c.severity === "hard" && c.passed).length}/
          {row.result.checks.filter((c) => c.severity === "hard").length}
        </p>
      </div>
      <span className={styles.ticketStamp}>{verdictLabel(row.verdict)}</span>
    </article>
  );
}
