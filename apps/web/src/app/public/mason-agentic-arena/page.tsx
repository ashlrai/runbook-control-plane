import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Fingerprint,
  FlaskConical,
  ShieldCheck,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export const metadata: Metadata = {
  title: "Synthetic Small Account Arena Demo · Runbook",
  description:
    "A synthetic Runbook product demonstration. All balances, trades, dates, fingerprints, and performance values are illustrative—not live account data.",
};

export default function PublicArenaPage() {
  return (
    <main className="public-page public-demo-page">
      <nav className="public-nav">
        <Link className="brand" href="/"><BrandMark /><span>Runbook</span></Link>
        <div><span className="public-status is-demo"><i /> Synthetic product demo</span><Link href="/"><ArrowLeft size={14} /> Control room</Link></div>
      </nav>

      <aside className="public-demo-banner" role="status" aria-label="Synthetic demo disclosure">
        <strong>Demo / synthetic data</strong>
        <span>No live experiment is represented here. Every balance, return, trade, date, fingerprint, and ledger event is an illustrative interface fixture.</span>
      </aside>

      <header className="public-hero">
        <div className="public-hero-copy">
          <div className="public-kicker"><FlaskConical size={16} /> RUN-DEMO-001 · MASONWYATT23 · SYNTHETIC</div>
          <h1>Can better rules make a <span>small account</span> more honest?</h1>
          <p>This product demo shows how a future approval-gated experiment could document a bounded $500 scenario. The values below do not describe a live account, trade, or reviewed import.</p>
          <div className="public-actions"><a className="button public-primary" href="#ledger">Inspect synthetic events</a><Link className="button ghost" href="/trust">Verify a proof artifact</Link></div>
        </div>
        <div className="public-scorecard" aria-label="Synthetic illustrative scorecard">
          <span>DEMO SCORECARD · ILLUSTRATIVE ONLY</span>
          <div className="score-ring"><strong>100</strong><em>/ 100</em></div>
          <p>A synthetic fixture demonstrates how reviewed process metrics could appear after real data is imported.</p>
          <dl><div><dt>Demo return</dt><dd>+0.8%</dd></div><div><dt>Demo vs. VTI</dt><dd>+0.1%</dd></div><div><dt>Demo drawdown</dt><dd>−0.6%</dd></div><div><dt>Demo rule breaks</dt><dd>0</dd></div></dl>
          <small>Synthetic values · illustrative Jul 15–21 window · not account performance</small>
        </div>
      </header>

      <section className="public-principles" aria-label="Principles illustrated by the synthetic demo">
        <div><strong>01</strong><span>No trade exists to feed content.</span></div>
        <div><strong>02</strong><span>No rule changes after seeing the outcome.</span></div>
        <div><strong>03</strong><span>Losses and interventions stay in the record.</span></div>
        <div><strong>04</strong><span>No signals, copying, or coordinated trading.</span></div>
      </section>

      <section className="public-charter" id="charter">
        <div className="public-section-intro"><span className="eyebrow">Synthetic charter fixture</span><h2>First, constrain the machine.</h2><p>This illustrative policy is not active on any brokerage account.</p></div>
        <div className="charter-board">
          <div className="charter-budget"><span>DEMO CAPITAL · NOT FUNDED</span><strong>$500</strong><em>illustrative experiment budget</em><div className="budget-bar"><span /></div><small>Demo reserve: $125 unavailable to the synthetic agent</small></div>
          <div className="charter-rules">
            {["Demo: long equities only", "Demo: 25% maximum per position", "Demo: human approval for every order", "Demo: two trades per day maximum", "Demo: 8% drawdown stop", "Demo: no options, leverage, or microcaps"].map((rule) => <div key={rule}><Check size={15} /><span>{rule}</span></div>)}
          </div>
          <div className="charter-question"><span>DEMO FALSIFIABLE QUESTION</span><p>Could an approval-gated research agent improve decision quality relative to a simple VTI control over an illustrative 30 days?</p><small>Synthetic prompt only · success is not defined as positive return.</small></div>
        </div>
      </section>

      <section className="public-ledger" id="ledger">
        <div className="public-section-intro"><span className="eyebrow">Synthetic timeline fixtures</span><h2>Receipts before results.</h2><p>No item below came from a brokerage account or reviewed import. These records exist only to demonstrate the interface.</p></div>
        <div className="public-events">
          <article><time>DEMO · JUL 15</time><div className="event-seal"><ShieldCheck size={18} /></div><div><span>SYNTHETIC CHARTER · ILLUSTRATIVE f3b0c9d1…</span><h3>Example mandate recorded</h3><p>Fixture only: $500 budget, long equities, 25% position ceiling, and an 8% drawdown stop.</p></div></article>
          <article><time>DEMO · JUL 18</time><div className="event-seal"><Check size={18} /></div><div><span>SYNTHETIC DECISION · TEN FIXTURE CHECKS PASSED</span><h3>Example broad-market control approved</h3><p>Fixture only: a synthetic agent proposes an illustrative $100 of VTI for a human-review walkthrough.</p></div></article>
          <article><time>DEMO · JUL 18</time><div className="event-seal"><Fingerprint size={18} /></div><div><span>SYNTHETIC IMPORT · ILLUSTRATIVE a71e92f0…</span><h3>Example execution record</h3><p>No fill occurred and no broker data was imported. This event demonstrates where an owned-data receipt would appear.</p></div></article>
          <article><time>DEMO · JUL 21</time><div className="event-seal"><FlaskConical size={18} /></div><div><span>SYNTHETIC WEEKLY REVIEW</span><h3>Example review avoids a victory lap</h3><p>The illustrative 0.1-point benchmark difference is intentionally framed as noise, not skill or live performance.</p></div></article>
        </div>
      </section>

      <section className="public-disclosure">
        <div><span className="eyebrow">Demo boundary</span><h2>Context the green number cannot show.</h2></div>
        <div><p>The green numbers on this page are synthetic interface fixtures. They are not returns, holdings, balances, trades, or account activity belonging to Mason or anyone else.</p><p>A future live page will remain clearly labeled until owned records are imported, reconciled, and manually reviewed. Missing evidence will display as missing—not be replaced with demo values.</p><p>This is an educational product demonstration, not individualized investment advice, a recommendation, proof of performance, or an invitation to coordinate trades.</p></div>
      </section>

      <footer className="public-footer"><div className="brand"><BrandMark /><span>Runbook</span></div><p>Demo only · built to make financial agents reviewable, not persuasive.</p><a href="https://robinhood.com/us/en/agentic-trading" target="_blank" rel="noreferrer">About Robinhood Agentic Trading <ExternalLink size={13} /></a><small>SYNTHETIC PRODUCT DEMO · Runbook is an independent prototype and is not affiliated with or endorsed by Robinhood.</small></footer>
    </main>
  );
}
