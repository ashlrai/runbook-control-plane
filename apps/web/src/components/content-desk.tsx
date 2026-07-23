"use client";

import { useMemo, useState } from "react";
import {
  Check,
  CircleAlert,
  Clipboard,
  Eye,
  MessageSquareText,
  ShieldCheck,
  X,
} from "lucide-react";
import { reviewPublicationDraft, type PublicationDraft } from "@runbook/engine/content";
import { AppShell } from "./app-shell";

type Format = "decision" | "review" | "weekly";

type DraftDefinition = {
  label: string;
  text: string;
  format: PublicationDraft["format"];
  namesSecurity: boolean;
  hasPerformanceClaim: boolean;
  evidenceSourceCount: number;
};

const drafts: Record<Format, DraftDefinition> = {
  decision: {
    label: "Decision note",
    format: "decision",
    namesSecurity: true,
    hasPerformanceClaim: false,
    evidenceSourceCount: 2,
    text: `SYNTHETIC TEMPLATE — NOT A LIVE TRADE

Added $100 of VTI to my separately funded agentic experiment account after human review. It is 20% of this experiment's $500 budget—not 20% of my full portfolio.

Why: this is the boring control. The question is whether an AI-assisted process can improve decision quality over 30 days without adding needless turnover.

What would change my mind: a mandate breach, an 8% experiment drawdown, or evidence that the research workflow creates action without useful information.

Main risk: a 30-day window cannot establish investing skill. I own VTI. This is my self-directed experiment, not individualized advice.

What evidence would you add to the review?`,
  },
  review: {
    label: "Outcome review",
    format: "review",
    namesSecurity: true,
    hasPerformanceClaim: true,
    evidenceSourceCount: 3,
    text: `SYNTHETIC TEMPLATE — NOT LIVE PERFORMANCE

Week-one audit for my small agentic investing experiment:

• Return after cash flows: +0.8%
• Same-window VTI benchmark: +0.7%
• Max drawdown: −0.6%
• Mandate violations: 0
• Human interventions: 1

The 0.1-point difference is noise, not alpha. The useful result is procedural: every decision had a thesis, falsifier, preflight, and follow-up.

I own VTI. Results are unrealized and cover only this separately funded $500 experiment—not my complete financial picture.`,
  },
  weekly: {
    label: "Weekly lab note",
    format: "explainer",
    namesSecurity: false,
    hasPerformanceClaim: false,
    evidenceSourceCount: 1,
    text: `SYNTHETIC TEMPLATE — REPLACE WITH VERIFIED OWNED DATA

SMALL ACCOUNT SYSTEMS · WEEK 01

The agent proposed one trade. The policy engine cleared it. I approved it. No rules changed after the outcome.

What worked: explicit position caps stopped the prompt from turning into an oversized order.

What did not: the research packet was longer, but not obviously better than the broad-market baseline.

Next test: require every factual claim to include a timestamp and source, while holding the capital rules constant.

Personal experiment only. No coordinated trading, paid promotion, or individualized advice.`,
  },
};

export function ContentDesk() {
  const [format, setFormat] = useState<Format>("decision");
  const [draftText, setDraftText] = useState(drafts.decision.text);
  const [copied, setCopied] = useState(false);
  const draft = useMemo(() => drafts[format], [format]);
  const review = useMemo(() => reviewPublicationDraft({
    surface: "robinhood-social",
    format: draft.format,
    body: draftText,
    manualPublish: true,
    synthetic: true,
    syntheticLabelPresent: /synthetic|hypothetical|paper|shadow/i.test(draftText.split("\n").slice(0, 2).join(" ")),
    namesSecurity: draft.namesSecurity,
    holdingsDisclosurePresent: /\bI (?:currently )?(?:own|do not own|hold|do not hold)\b/i.test(draftText),
    hasPerformanceClaim: draft.hasPerformanceClaim,
    measurementPeriodPresent: /\b(?:day|days|week|weeks|month|months|window|Jul\b)/i.test(draftText),
    benchmarkPresent: /\b(?:benchmark|versus|vs\.|VTI)\b/i.test(draftText),
    limitationsPresent: /\b(?:noise|limitation|cannot|not evidence|not obviously|too (?:small|short|young))\b/i.test(draftText),
    materialConnection: "none",
    evidenceSourceCount: draft.evidenceSourceCount,
  }), [draft, draftText]);

  function chooseFormat(nextFormat: Format) {
    setFormat(nextFormat);
    setDraftText(drafts[nextFormat].text);
    setCopied(false);
  }

  async function copyDraft() {
    await navigator.clipboard.writeText(draftText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <AppShell>
      <header className="topbar builder-topbar">
        <div><div className="breadcrumb">Owned data <span>/</span> Human review <span>/</span> Manual publish</div><h1>Publish desk</h1><p>Turn the ledger into useful context—without manufacturing a trade.</p></div>
      </header>
      <div className="content-grid">
        <section className="draft-controls">
          <span className="eyebrow">Format</span>
          <h2>Choose what the record needs to say</h2>
          <div className="format-tabs">
            {(Object.entries(drafts) as Array<[Format, DraftDefinition]>).map(([key, item]) => (
              <button key={key} className={format === key ? "is-active" : ""} onClick={() => chooseFormat(key)}><MessageSquareText size={16} />{item.label}</button>
            ))}
          </div>
          <div className="editor-wrap"><textarea value={draftText} onChange={(event) => { setDraftText(event.target.value); setCopied(false); }} aria-label={`${draft.label} draft`} /><span>{draftText.length} characters · editable local draft</span></div>
          <div className={`publication-review ${review.readyForHumanReview ? "is-ready" : "is-blocked"}`}>
            <div className="publication-review-head">
              {review.readyForHumanReview ? <ShieldCheck size={18} /> : <CircleAlert size={18} />}
              <div><strong>{review.readyForHumanReview ? "Ready for human review" : "Publication blockers detected"}</strong><span>{review.checks.filter((check) => check.passed).length} of {review.checks.length} automated checks passed</span></div>
            </div>
            <div className="publication-checks">
              {review.checks.map((check) => (
                <div key={check.id} className={check.passed ? "is-pass" : check.severity === "blocking" ? "is-fail" : "is-warn"} title={check.detail}>
                  {check.passed ? <Check size={12} /> : <X size={12} />}
                  <span>{check.label}</span>
                  <em>{check.severity}</em>
                </div>
              ))}
            </div>
            <p>{review.warning}</p>
          </div>
          <button className="button primary copy-button" onClick={copyDraft} disabled={!review.readyForHumanReview}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? "Copied for manual review" : review.readyForHumanReview ? "Copy reviewed draft" : "Resolve blockers before copying"}</button>
          <div className="manual-only"><ShieldCheck size={19} /><div><strong>Manual publishing only</strong><span>Runbook does not connect to, scrape, or post on Robinhood Social.</span></div></div>
        </section>
        <section className="post-preview" aria-label="Post preview">
          <div className="preview-top"><span><Eye size={15} /> Reader preview</span><em>Demo · not published</em></div>
          <div className="profile-row"><div className="avatar">MW</div><div><strong>MasonWyatt23</strong><span>Founder-engineer · small-account decision lab</span></div></div>
          <div className="preview-copy">{draftText.split("\n").map((line, index) => <p key={`${line.slice(0, 12)}-${index}`}>{line || <>&nbsp;</>}</p>)}</div>
          <div className="context-card"><span>RUN-001 · VERIFIED IN OWNED LEDGER</span><div><strong>10 / 10</strong><em>preflight controls</em></div><div><strong>0</strong><em>policy breaks</em></div><div><strong>1</strong><em>human approval</em></div></div>
          <div className="preview-foot"><span>Personal record · July 21, 2026</span><span>No promotion · no auto-post</span></div>
        </section>
      </div>
    </AppShell>
  );
}
