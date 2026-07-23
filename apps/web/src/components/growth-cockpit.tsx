"use client";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Beaker,
  BriefcaseBusiness,
  Check,
  CircleAlert,
  FlaskConical,
  MessageCircleQuestion,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  contentObservationSchema,
  scoreContentObservation,
  type ContentObservation,
} from "@runbook/engine/content";
import { FOUNDING_LAB_30_DAY_TARGETS } from "@runbook/engine/growth";
import {
  listContentObservations,
  saveContentObservation,
} from "@/lib/local-store";
import { AppShell } from "./app-shell";

const contentExperiments = [
  {
    rank: "01",
    name: "Rules before returns",
    hypothesis: "A public charter earns more substantive questions than an outcome-only post.",
    measure: "24h follower change + substantive questions",
    cadence: "4 matched posts",
  },
  {
    rank: "02",
    name: "Decision → postmortem",
    hypothesis: "A preregistered thesis paired with its later review creates repeat readers.",
    measure: "Questions and qualified conversations per pair",
    cadence: "Genuine events only",
  },
  {
    rank: "03",
    name: "Rejected by the system",
    hypothesis: "Transparent restraint is at least as useful as an ordinary trade update.",
    measure: "Median engagement versus comparable posts",
    cadence: "1–2 truthful records / week",
  },
  {
    rank: "04",
    name: "Standard scorecard",
    hypothesis: "Unchanged weekly definitions build more trust than cherry-picked wins.",
    measure: "Returning commenters + weekly follower context",
    cadence: "4 weekly reports",
  },
] as const;

const launchGates: ReadonlyArray<{ label: string; detail: string; state: "ready" | "waiting" | "gated"; href?: string }> = [
  { label: "Demo state labeled", detail: "All seeded product data is synthetic", state: "ready" },
  { label: "Manual publishing", detail: "No Social API, bot, scraper, or scheduler", state: "ready" },
  { label: "Real baseline", detail: "Enter current followers and existing-post engagement", state: "waiting", href: "/growth/baseline" },
  { label: "First charter post", detail: "Requires factual and human review", state: "waiting" },
  { label: "Commercial permission", detail: "Robinhood written consent not yet recorded", state: "gated" },
  { label: "Manufactured events", detail: "Target is permanently zero", state: "ready" },
] as const;

const foundingLabTargets = [
  { rank: "01", value: FOUNDING_LAB_30_DAY_TARGETS.completedInterviews, label: "qualified interviews" },
  { rank: "02", value: FOUNDING_LAB_30_DAY_TARGETS.fullyPaid499Pilots, label: "fully paid pilots" },
  { rank: "03", value: FOUNDING_LAB_30_DAY_TARGETS.activatedExperiments, label: "activated experiments" },
  { rank: "04", value: FOUNDING_LAB_30_DAY_TARGETS.renewalCommitments, label: "$59 renewal commitments" },
] as const;

export function GrowthCockpit() {
  const [observations, setObservations] = useState<ContentObservation[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    listContentObservations()
      .then((records) => {
        if (!active) return;
        const parsed = records.flatMap((record) => {
          const result = contentObservationSchema.safeParse(record);
          return result.success ? [result.data] : [];
        });
        setObservations(parsed);
        setLoadState(parsed.length === records.length ? "ready" : "error");
        if (parsed.length !== records.length) {
          setMessage("One or more malformed local observations were excluded.");
        }
      })
      .catch(() => {
        if (!active) return;
        setLoadState("error");
        setMessage("Local observations could not be loaded. No remote fallback was used.");
      });
    return () => { active = false; };
  }, []);

  const outcomes = useMemo(
    () => observations.map((observation) => ({
      observation,
      outcome: scoreContentObservation(observation),
    })),
    [observations],
  );

  const totals = useMemo(() => outcomes.reduce(
    (current, item) => ({
      eligible: current.eligible + (item.outcome.eligible ? 1 : 0),
      followerChange: current.followerChange + item.outcome.observedFollowerChange,
      questions: current.questions + item.observation.substantiveQuestionsAfter24h,
      conversations: current.conversations + item.observation.qualifiedConversationsAfter24h,
    }),
    { eligible: 0, followerChange: 0, questions: 0, conversations: 0 },
  ), [outcomes]);

  async function recordObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaveState("saving");
    setMessage("");
    try {
      const observation = contentObservationSchema.parse({
        observationId: crypto.randomUUID(),
        hypothesis: data.get("hypothesis"),
        format: data.get("format"),
        followersBefore: Number(data.get("followersBefore")),
        followersAfter24h: Number(data.get("followersAfter24h")),
        likesAfter24h: Number(data.get("likesAfter24h")),
        commentsAfter24h: Number(data.get("commentsAfter24h")),
        substantiveQuestionsAfter24h: Number(data.get("substantiveQuestionsAfter24h")),
        qualifiedConversationsAfter24h: Number(data.get("qualifiedConversationsAfter24h")),
        manualPublish: data.get("manualPublish") === "on",
        complianceReviewed: data.get("complianceReviewed") === "on",
        manufacturedEvent: data.get("manufacturedEvent") === "on",
      });
      await saveContentObservation(observation.observationId, observation);
      setObservations((current) => [...current, observation]);
      setSaveState("saved");
      setMessage("Manual 24-hour observation saved locally on this device.");
      form.reset();
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message.slice(0, 220) : "Observation could not be saved.");
    }
  }

  return (
    <AppShell>
      <header className="topbar builder-topbar">
        <div>
          <div className="breadcrumb">Manual evidence <span>/</span> Content experiments <span>/</span> Qualified attention</div>
          <h1>Growth cockpit</h1>
          <p>Run preregistered creator experiments without manufacturing a trade or scraping Social.</p>
        </div>
        <div className="growth-mode"><ShieldCheck size={15} /><span>Two-lane boundary</span><strong>Social trust ≠ sales funnel</strong></div>
      </header>

      <section className="growth-metrics" aria-label="Locally recorded creator observations">
        <GrowthMetric label="Eligible observations" value={`${totals.eligible}`} note={`${observations.length} total local records`} />
        <GrowthMetric label="Observed follower change" value={totals.followerChange > 0 ? `+${totals.followerChange}` : `${totals.followerChange}`} note="24h windows · not causal" />
        <GrowthMetric label="Substantive questions" value={`${totals.questions}`} note="Manually classified" />
        <GrowthMetric label="Qualified conversations" value={`${totals.conversations}`} note="Owned-channel follow-up only" />
      </section>

      <div className="growth-grid">
        <section className="launch-gates" aria-labelledby="launch-gates-title">
          <div className="module-heading"><div><span className="eyebrow">Truth before reach</span><h2 id="launch-gates-title">Launch gates</h2></div><BadgeCheck size={20} /></div>
          <div className="launch-gate-list">
            {launchGates.map((gate) => (
              <div key={gate.label}>
                <span className={`gate-state gate-${gate.state}`}>{gate.state === "ready" ? <Check size={12} /> : <CircleAlert size={12} />}</span>
                <div><strong>{gate.href ? <Link className="back-link" href={gate.href}>{gate.label}<ArrowRight size={12} aria-hidden="true" /></Link> : gate.label}</strong><span>{gate.detail}</span></div>
                <em>{gate.state}</em>
              </div>
            ))}
          </div>
        </section>

        <section className="two-lane-funnel" aria-labelledby="funnel-title">
          <div className="module-heading"><div><span className="eyebrow">Do not blend these</span><h2 id="funnel-title">Two-lane growth system</h2></div><TrendingUp size={20} /></div>
          <div className="lane lane-social">
            <div className="lane-icon"><Users size={18} /></div>
            <div><span>Robinhood reputation lane</span><strong>Earn trust manually</strong><p>Evidence-labeled outcomes, rules, failures, corrections, questions. No links, pricing, waitlist, referrals, or automated measurement.</p></div>
            <em>personal use</em>
          </div>
          <div className="lane-arrow"><ArrowRight size={17} /><span>credibility may transfer; data does not</span></div>
          <div className="lane lane-owned">
            <div className="lane-icon"><Target size={18} /></div>
            <div><span>Owned conversion lane</span><strong>Validate paid demand elsewhere</strong><p>Public lab, GitHub, founder outreach, interviews, second tests, and paid Founding Lab requests with explicit consent.</p></div>
            <em>commercial validation</em>
          </div>
        </section>

        <section className="content-experiment-board" aria-labelledby="experiment-board-title">
          <div className="module-heading"><div><span className="eyebrow">Preregister, then observe</span><h2 id="experiment-board-title">30-day experiment stack</h2></div><Beaker size={20} /></div>
          <div className="experiment-stack">
            {contentExperiments.map((experiment) => (
              <article key={experiment.rank}>
                <span>{experiment.rank}</span>
                <div><strong>{experiment.name}</strong><p>{experiment.hypothesis}</p><small>{experiment.measure}</small></div>
                <em>{experiment.cadence}</em>
              </article>
            ))}
          </div>
        </section>

        <section className="observation-recorder" aria-labelledby="observation-title">
          <div className="module-heading"><div><span className="eyebrow">First-party aggregate only</span><h2 id="observation-title">Record a 24-hour observation</h2></div><MessageCircleQuestion size={20} /></div>
          <form onSubmit={recordObservation}>
            <label>Preregistered hypothesis<input name="hypothesis" required maxLength={240} defaultValue="Rules-before-returns posts earn substantive questions." /></label>
            <div className="observation-fields">
              <label>Format<select name="format" defaultValue="charter"><option value="charter">Charter</option><option value="decision">Decision</option><option value="rejection">Rejection</option><option value="no-trade">No trade</option><option value="review">Review</option><option value="correction">Correction</option><option value="explainer">Explainer</option></select></label>
              <label>Followers before<input name="followersBefore" type="number" min="0" required /></label>
              <label>Followers after 24h<input name="followersAfter24h" type="number" min="0" required /></label>
              <label>Likes after 24h<input name="likesAfter24h" type="number" min="0" defaultValue="0" required /></label>
              <label>Comments after 24h<input name="commentsAfter24h" type="number" min="0" defaultValue="0" required /></label>
              <label>Substantive questions<input name="substantiveQuestionsAfter24h" type="number" min="0" defaultValue="0" required /></label>
              <label>Qualified conversations<input name="qualifiedConversationsAfter24h" type="number" min="0" defaultValue="0" required /></label>
            </div>
            <div className="observation-attestations">
              <label><input name="manualPublish" type="checkbox" defaultChecked /> Published manually</label>
              <label><input name="complianceReviewed" type="checkbox" defaultChecked /> Human-reviewed</label>
              <label className="danger-attestation"><input name="manufacturedEvent" type="checkbox" /> Trade/event was manufactured for content</label>
            </div>
            <button className="button primary" type="submit" disabled={saveState === "saving"}>{saveState === "saving" ? "Saving locally…" : "Record manual observation"}</button>
            <p className={`observation-message message-${saveState}`} aria-live="polite">{message || "No profile, comment, or audience identifiers are collected."}</p>
          </form>
        </section>

        <section className="observation-ledger" aria-labelledby="observation-ledger-title">
          <div className="module-heading"><div><span className="eyebrow">Local evidence</span><h2 id="observation-ledger-title">Observation ledger</h2></div><FlaskConical size={20} /></div>
          {loadState === "loading" ? <div className="observation-empty">Loading local observations…</div> : outcomes.length === 0 ? (
            <div className="observation-empty"><CircleAlert size={18} /><div><strong>No real observations yet</strong><span>Record the current MasonWyatt23 baseline before drawing a growth conclusion.</span></div></div>
          ) : (
            <div className="observation-table-wrap"><table><thead><tr><th>Hypothesis</th><th>Format</th><th>Follower Δ</th><th>Questions</th><th>Qualified</th><th>Decision</th></tr></thead><tbody>{outcomes.map(({ observation, outcome }) => <tr key={observation.observationId}><td>{observation.hypothesis}</td><td>{observation.format}</td><td>{outcome.observedFollowerChange > 0 ? "+" : ""}{outcome.observedFollowerChange}</td><td>{observation.substantiveQuestionsAfter24h}</td><td>{outcome.qualifiedConversations}</td><td><span className={`decision-${outcome.decision}`}>{outcome.decision}</span></td></tr>)}</tbody></table></div>
          )}
          <div className="causality-note"><CircleAlert size={14} />Follower changes are observational. Market conditions, native distribution, and outside activity can confound every small sample.</div>
        </section>

        <section className="revenue-validation" aria-labelledby="revenue-validation-title">
          <div className="module-heading"><div><span className="eyebrow">Owned channels only</span><h2 id="revenue-validation-title">Founding Creator Lab validation</h2></div><BriefcaseBusiness size={20} /></div>
          <div className="revenue-offer">
            <div><span>30-day concierge pilot</span><strong>$499</strong><p>One bounded agentic experiment becomes a charter, preflight trail, owned evidence record, four weekly reports, and a reusable public proof page.</p></div>
            <div className="offer-boundary"><ShieldCheck size={17} /><span>No signals, execution, credentials, promised returns, or automated Social activity.</span></div>
          </div>
          <div className="validation-funnel" aria-label="Founding Creator Lab validation targets">
            {foundingLabTargets.map((target, index) => (
              <Fragment key={target.label}>
                {index > 0 ? <ArrowRight size={16} /> : null}
                <div><span>{target.rank}</span><strong>{target.value}</strong><em>{target.label}</em></div>
              </Fragment>
            ))}
          </div>
          <p className="revenue-caveat">These are validation gates, not customers or revenue already earned. Social posts carry no commercial call to action; prospecting happens through the public site, GitHub, creator communities, and direct consented outreach.</p>
        </section>
      </div>
    </AppShell>
  );
}

function GrowthMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div><span>{label}</span><strong>{value}</strong><em>{note}</em></div>;
}
