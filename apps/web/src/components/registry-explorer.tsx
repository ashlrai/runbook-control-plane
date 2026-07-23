"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Layers3,
  LockKeyhole,
  Search,
  ShieldAlert,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import {
  ASSURANCE_LADDER,
  BANKING_CAPABILITIES,
  BANKING_CREDENTIAL_RELEASE_CALLOUT,
  BANKING_SOURCE,
  countMutationClasses,
  DRIFT_ADDED_TOOLS,
  DRIFT_THEATER_STEPS,
  FIXTURE_SUMMARIES,
  MUTATION_CLASS_META,
  REGISTRY_DISCLAIMER,
  TRADING_SOURCE,
  TRADING_TOOL_COUNT,
  type FixtureSummary,
  type MutationClass,
  shortHash,
  toolsMatching,
} from "../lib/registry-explorer-data";
import styles from "./registry-explorer.module.css";

type EffectFilter = MutationClass | "all";

const tradingEffectFilters: Array<{ id: EffectFilter; label: string }> = [
  { id: "all", label: "All classes" },
  { id: "observation", label: "Observation" },
  { id: "research-state-mutation", label: "Research-state" },
  { id: "order-review", label: "Order review" },
  { id: "capital-order-mutation", label: "Capital-order" },
];

const TRADING_MUTATION_KEYS = [
  "observation",
  "research-state-mutation",
  "order-review",
  "capital-order-mutation",
] as const;

export function RegistryExplorer() {
  const [query, setQuery] = useState("");
  const [effect, setEffect] = useState<EffectFilter>("all");
  const [activeFixture, setActiveFixture] = useState<FixtureSummary>(FIXTURE_SUMMARIES[1]!);
  const [driftStep, setDriftStep] = useState(0);

  const groups = useMemo(() => toolsMatching(effect, query), [effect, query]);
  const visibleCount = groups.reduce((sum, group) => sum + group.tools.length, 0);
  const liveCounts = useMemo(() => countMutationClasses(groups), [groups]);
  const step = DRIFT_THEATER_STEPS[driftStep] ?? DRIFT_THEATER_STEPS[0]!;
  const stepFixture = FIXTURE_SUMMARIES.find((fixture) => fixture.id === step.fixtureId);

  function goDriftStep(next: number) {
    const clamped = Math.max(0, Math.min(DRIFT_THEATER_STEPS.length - 1, next));
    setDriftStep(clamped);
    const nextStep = DRIFT_THEATER_STEPS[clamped];
    if (!nextStep) return;
    const fixture = FIXTURE_SUMMARIES.find((item) => item.id === nextStep.fixtureId);
    if (fixture) setActiveFixture(fixture);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Runbook home">
          <BrandMark />
          <span>Runbook</span>
          <em>Registry</em>
        </Link>
        <nav className={styles.headerNav} aria-label="Registry navigation">
          <Link href="/">Product map</Link>
          <Link href="/mcp">MCP cockpit</Link>
          <Link href="/control-room">Control Room</Link>
          <Link href="/dossier">Dossier</Link>
          <Link href="/safety-card">Safety Bench</Link>
        </nav>
      </header>

      <div className={styles.truthRail} role="note" aria-label="Registry honesty boundary">
        <span>NOT LIVE INVENTORY</span>
        <span>NOT AUTHORIZATION</span>
        <span>NOT AFFILIATED WITH ROBINHOOD</span>
        <span>OFFLINE FIXTURE SUMMARY</span>
      </div>

      <section className={styles.assuranceLadder} aria-label="Assurance ladder">
        {ASSURANCE_LADDER.map((rung) => (
          <div key={rung.id} className={styles.ladderRung} data-rung={rung.id}>
            <span>{rung.rung}</span>
            <strong>{rung.title}</strong>
            <em>{rung.detail}</em>
          </div>
        ))}
      </section>

      <section className={styles.hero} aria-labelledby="registry-title">
        <div>
          <p className={styles.eyebrow}>Financial capability registry · public-derived explorer</p>
          <h1 id="registry-title">Fifty published tools. Four mutation classes. Fail-closed drift.</h1>
          <p className={styles.lede}>
            Browse the frozen Robinhood Trading and Banking documentation projections embedded for offline
            analysis. Evidence is public-explicit for names and public-derived for risk labels. Nothing here
            authenticates, trades, or releases credentials.
          </p>
        </div>
        <aside className={styles.disclaimer} aria-label={REGISTRY_DISCLAIMER.title}>
          <strong>{REGISTRY_DISCLAIMER.title}</strong>
          <ul>
            {REGISTRY_DISCLAIMER.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </aside>
      </section>

      <div className={styles.stats} aria-label="Inventory summary">
        <div className={styles.stat}>
          <span>Trading tools</span>
          <strong>{TRADING_TOOL_COUNT}</strong>
          <em>published names · {TRADING_SOURCE.observedAt}</em>
        </div>
        <div className={styles.stat}>
          <span>Observation</span>
          <strong>{MUTATION_CLASS_META.observation.countTrading50}</strong>
          <em>read-only surfaces</em>
        </div>
        <div className={styles.stat}>
          <span>Research-state</span>
          <strong>{MUTATION_CLASS_META["research-state-mutation"].countTrading50}</strong>
          <em>watchlist / scan writers</em>
        </div>
        <div className={styles.stat}>
          <span>Order + capital</span>
          <strong>
            {(MUTATION_CLASS_META["order-review"].countTrading50 ?? 0) +
              (MUTATION_CLASS_META["capital-order-mutation"].countTrading50 ?? 0)}
          </strong>
          <em>2 review · 4 capital-order</em>
        </div>
        <div className={styles.stat}>
          <span>Banking ops</span>
          <strong>{BANKING_CAPABILITIES.length}</strong>
          <em>providerToolName: null</em>
        </div>
      </div>

      <div className={styles.main}>
        <section className={styles.panel} aria-labelledby="inventory-title">
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>Trading inventory</p>
              <h2 id="inventory-title">Official categories · {visibleCount} shown</h2>
            </div>
            <Layers3 size={18} aria-hidden="true" />
          </div>

          <div className={styles.controls}>
            <label className="sr-only" htmlFor="registry-search">
              Filter tools
            </label>
            <input
              id="registry-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by tool name or category"
              autoComplete="off"
            />
            <label className="sr-only" htmlFor="registry-effect">
              Mutation class
            </label>
            <select
              id="registry-effect"
              value={effect}
              onChange={(event) => setEffect(event.target.value as EffectFilter)}
            >
              {tradingEffectFilters.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#6d7a8d", fontSize: 11 }}>
              <Search size={14} aria-hidden="true" />
              Local filter only
            </span>
          </div>

          <div className={styles.liveCounts} aria-live="polite" aria-label="Live mutation class counts">
            <span className={styles.liveCountsLabel}>Live filter counts</span>
            {TRADING_MUTATION_KEYS.map((key) => {
              const meta = MUTATION_CLASS_META[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={styles.liveCount}
                  data-tone={meta.tone}
                  data-active={effect === key}
                  onClick={() => setEffect(effect === key ? "all" : key)}
                >
                  <strong>{liveCounts[key]}</strong>
                  <em>{meta.label}</em>
                </button>
              );
            })}
            <span className={styles.liveTotal}>
              <strong>{visibleCount}</strong>
              <em>visible</em>
            </span>
          </div>

          <div className={styles.mutationStrip} role="group" aria-label="Mutation class quick filters">
            {TRADING_MUTATION_KEYS.map((key) => {
              const meta = MUTATION_CLASS_META[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={styles.mutationChip}
                  data-active={effect === key}
                  onClick={() => setEffect(effect === key ? "all" : key)}
                >
                  <span>
                    {liveCounts[key]} shown · {meta.countTrading50} full
                  </span>
                  <strong>{meta.label}</strong>
                  <em>{meta.short}</em>
                </button>
              );
            })}
          </div>

          <div className={styles.driftTheater} aria-labelledby="drift-theater-title">
            <div className={styles.driftHead}>
              <div>
                <p className={styles.eyebrow}>Offline drift theater</p>
                <h3 id="drift-theater-title">45 → 50 documentation delta</h3>
              </div>
              <div className={styles.driftControls}>
                <button
                  type="button"
                  className={styles.driftNavBtn}
                  onClick={() => goDriftStep(driftStep - 1)}
                  disabled={driftStep === 0}
                  aria-label="Previous drift step"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <span className={styles.driftStepIndex}>
                  Step {driftStep + 1} / {DRIFT_THEATER_STEPS.length}
                </span>
                <button
                  type="button"
                  className={styles.driftNavBtn}
                  onClick={() => goDriftStep(driftStep + 1)}
                  disabled={driftStep === DRIFT_THEATER_STEPS.length - 1}
                  aria-label="Next drift step"
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className={styles.driftSteps} role="tablist" aria-label="Drift narrative steps">
              {DRIFT_THEATER_STEPS.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={index === driftStep}
                  className={styles.driftStepTab}
                  data-active={index === driftStep}
                  data-highlight={item.highlight}
                  onClick={() => goDriftStep(index)}
                >
                  <span>{item.label}</span>
                  <strong>{item.toolCount}</strong>
                </button>
              ))}
            </div>

            <div
              className={styles.driftStage}
              data-highlight={step.highlight}
              aria-live="polite"
              key={step.id}
            >
              <div className={styles.driftStageMeta}>
                <span className={styles.driftCountBadge} data-highlight={step.highlight}>
                  {step.toolCount} tools
                </span>
                <span className={styles.outcome}>{stepFixture?.outcomeLanguage ?? step.label}</span>
              </div>
              <h4>{step.title}</h4>
              <p>{step.body}</p>
              {(step.highlight === "added" || step.highlight === "admitted") && (
                <ul className={styles.driftList} aria-label="Tools added in the 50-tool projection">
                  {DRIFT_ADDED_TOOLS.map((name, index) => (
                    <li
                      key={name}
                      className={styles.driftListItem}
                      style={{ animationDelay: `${index * 60}ms` }}
                      data-enter={step.highlight === "added" ? "true" : "false"}
                    >
                      + {name}
                    </li>
                  ))}
                </ul>
              )}
              {step.highlight === "reject" && stepFixture?.materialDelta ? (
                <ul className={styles.deltaList} aria-label="Risk correction material delta">
                  {stepFixture.materialDelta.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              {step.highlight === "baseline" ? (
                <p className={styles.driftHint}>
                  Five observation tools are absent by construction. Advance to see the +5 documentation delta.
                </p>
              ) : null}
            </div>
          </div>

          {groups.length === 0 ? (
            <div className={styles.empty}>No tools match this local filter.</div>
          ) : (
            groups.map((group) => (
              <div className={styles.group} key={group.category}>
                <div className={styles.groupHead}>
                  <span>{group.category}</span>
                  <span>{group.tools.length}</span>
                </div>
                {group.tools.map((tool) => {
                  const meta = MUTATION_CLASS_META[tool.effect];
                  const showDrift =
                    tool.addedIn50 &&
                    (step.highlight === "added" || step.highlight === "admitted" || step.highlight === "reject");
                  return (
                    <div
                      className={styles.toolRow}
                      key={tool.name}
                      data-drift={showDrift ? "true" : "false"}
                    >
                      <code>{tool.name}</code>
                      {showDrift ? (
                        <span className={styles.badge} data-tone="drift">
                          +50 drift
                        </span>
                      ) : (
                        <span />
                      )}
                      <span className={styles.badge} data-tone={meta.tone}>
                        {meta.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </section>

        <aside className={styles.panel} aria-labelledby="theater-title">
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>Demo theater</p>
              <h2 id="theater-title">Frozen fixture summaries</h2>
            </div>
            <LockKeyhole size={18} aria-hidden="true" />
          </div>
          <p
            style={{
              margin: 0,
              padding: "12px 18px",
              color: "#6d7a8d",
              fontSize: 11,
              lineHeight: 1.5,
              borderBottom: "1px solid #d7deea",
            }}
          >
            Buttons load embedded SHA-256 digests and admit/reject language only. No network, no file system,
            no live registry head mutation. Drift steps above also select the matching fixture.
          </p>
          <div className={styles.fixtureList}>
            {FIXTURE_SUMMARIES.map((fixture) => (
              <button
                key={fixture.id}
                type="button"
                className={styles.fixtureBtn}
                data-active={activeFixture.id === fixture.id}
                onClick={() => {
                  setActiveFixture(fixture);
                  const matchingStep = DRIFT_THEATER_STEPS.findIndex((s) => s.fixtureId === fixture.id);
                  if (matchingStep >= 0) setDriftStep(matchingStep);
                }}
              >
                <strong>{fixture.label}</strong>
                <span>
                  {fixture.file} · rev {fixture.revision ?? "—"} · {fixture.capabilityCount} caps
                </span>
              </button>
            ))}
          </div>
          <div className={styles.theater} aria-live="polite">
            <p className={styles.eyebrow}>{activeFixture.lane} · offline summary</p>
            <h3>{activeFixture.label}</h3>
            <span className={styles.outcome}>{activeFixture.outcomeLanguage}</span>
            <p>{activeFixture.detail}</p>
            <div className={styles.hashRow}>
              <strong>SHA-256</strong>
              <span title={activeFixture.sha256}>{shortHash(activeFixture.sha256)}</span>
              <span>{activeFixture.sha256}</span>
              <strong>Source ref</strong>
              <span>
                {activeFixture.lane === "trading"
                  ? `${TRADING_SOURCE.referenceNumber} · ${TRADING_SOURCE.observedAt}`
                  : `${BANKING_SOURCE.referenceNumber} · ${BANKING_SOURCE.observedAt}`}
              </span>
            </div>
            {activeFixture.materialDelta && activeFixture.materialDelta.length > 0 ? (
              <ul className={styles.deltaList} aria-label="Material delta notes">
                {activeFixture.materialDelta.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </aside>
      </div>

      <section className={styles.banking} aria-labelledby="banking-title">
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>Banking · credential-release distinction</p>
            <h2 id="banking-title">Three documented operations · no published MCP names</h2>
          </div>
        </div>

        <div className={styles.credentialCallout} role="note" aria-label="Credential-release honesty">
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <strong>{BANKING_CREDENTIAL_RELEASE_CALLOUT.title}</strong>
            <ul>
              {BANKING_CREDENTIAL_RELEASE_CALLOUT.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className={styles.bankingGrid}>
          {BANKING_CAPABILITIES.map((cap) => {
            const meta = MUTATION_CLASS_META[cap.effect];
            const isCredential = cap.effect === "credential-release";
            return (
              <article
                className={styles.bankCard}
                key={cap.documentedOperationId}
                data-credential={isCredential ? "true" : "false"}
              >
                <span className={styles.badge} data-tone={meta.tone}>
                  {meta.label}
                </span>
                <h3>{cap.behavior}</h3>
                <p>{cap.note}</p>
                <code>
                  id: {cap.documentedOperationId}
                  <br />
                  providerToolName: null
                </code>
                {isCredential ? (
                  <p className={styles.credentialNote}>
                    Honesty: credential-release is not modeled as direct spend authority. Not live inventory.
                    Not authorization.
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
