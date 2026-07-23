"use client";

import { useState } from "react";
import Link from "next/link";
import {
  runFrozenSyntheticV0Bench,
  serializeBenchRunReceipt,
  sha256Utf8,
  type BenchRunReceipt,
} from "@runbook/financial-bench";
import { ArrowDownToLine, ArrowRight, Braces, CircleAlert, FileCheck2, LockKeyhole, ScanLine } from "lucide-react";
import { BrandMark } from "./brand-mark";
import styles from "./safety-card-experience.module.css";

const OUTCOMES_SHA256 = "a0588492aefea0213dcc322ef164cced829422b3692da29d7de62879e1647b96";
const CORPUS_SHA256 = "50237521416134b941f924c4222d43bf4ed9b6ff2b81f810ef2a03f88bc15c12";
const CORPUS_MANIFEST_SHA256 = "7c36694e0ef17059bffe3f82f2b6da5089934b76eb5da53acd5085dd1ae95087";
const ARCHIVE_SHA256 = "4518e9957ffaefbb6f51ce8dddfe0129c9bf347a8227153508234c29b53af980";

const scenarioLabels: Record<string, { channel: string; label: string }> = {
  "scenario-01-wrong-account": { channel: "CH 01", label: "Wrong account" },
  "scenario-04-undocumented-tool": { channel: "CH 04", label: "Undocumented mutation tool" },
  "scenario-05-mutation-capability-drift": { channel: "CH 05", label: "Mutation-class drift" },
  "scenario-06-incompatible-schema-drift": { channel: "CH 06", label: "Input-schema drift" },
};

function shortHash(value: string) {
  return `${value.slice(0, 12)}…${value.slice(-10)}`;
}

function runReferenceSelfTest(): BenchRunReceipt {
  const receipt = runFrozenSyntheticV0Bench();
  if (sha256Utf8(serializeBenchRunReceipt(receipt)) !== OUTCOMES_SHA256) {
    throw new Error("reference-receipt-mismatch");
  }
  return receipt;
}

export function SafetyCardExperience() {
  const [receipt, setReceipt] = useState<BenchRunReceipt | null>(null);
  const [error, setError] = useState(false);

  function reproduce() {
    try {
      setReceipt(runReferenceSelfTest());
      setError(false);
    } catch {
      setReceipt(null);
      setError(true);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Runbook home">
          <BrandMark />
          <span>Runbook</span>
          <em>Safety Bench</em>
        </Link>
        <nav aria-label="Safety Bench navigation">
          <a href="#fault-deck">Fault deck</a>
          <a href="#coverage">Coverage</a>
          <a href="#evidence">Evidence</a>
          <a href="#engagement">Readiness sprint</a>
        </nav>
        <Link className={styles.verifyLink} href="/verify">
          Open verifier <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </header>

      <div className={styles.truthRail} role="note" aria-label="Current evidence boundary">
        <span>REFERENCE CONTROL SELF-TEST</span>
        <span>SYNTHETIC ONLY</span>
        <span>4 OF 30 SCENARIOS IMPLEMENTED</span>
        <span>NO AGENT OR BROKER CONNECTION</span>
      </div>

      <section className={styles.hero} aria-labelledby="safety-card-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Financial Agent Safety Bench · reference profile v0</p>
          <h1 id="safety-card-title">Find the failure before it reaches capital.</h1>
          <p className={styles.lede}>
            Reproduce Runbook&apos;s own control behavior against four frozen financial fault fixtures.
            This reference card proves the corpus, evaluator path, and evidence packaging—not an external agent.
          </p>
          <div className={styles.heroActions}>
            <button className={styles.runButton} type="button" onClick={reproduce}>
              <ScanLine size={17} aria-hidden="true" />
              Reproduce reference behavior
            </button>
            <a className={styles.secondaryButton} href="#coverage">Inspect the 26-scenario gap</a>
          </div>
          <p className={styles.localNote}>
            <LockKeyhole size={14} aria-hidden="true" /> Runs synchronously in this browser. No network request, storage, credential, account, order, or side effect.
          </p>
        </div>

        <aside className={styles.inputTicket} aria-label="Frozen input manifest">
          <div className={styles.ticketHead}>
            <span>INPUT MANIFEST</span>
            <strong>FROZEN / SYNTHETIC</strong>
          </div>
          <dl>
            <div><dt>Profile</dt><dd>synthetic-control-self-test-card.v0</dd></div>
            <div><dt>Corpus</dt><dd title={CORPUS_SHA256}>{shortHash(CORPUS_SHA256)}</dd></div>
            <div><dt>Manifest</dt><dd title={CORPUS_MANIFEST_SHA256}>{shortHash(CORPUS_MANIFEST_SHA256)}</dd></div>
            <div><dt>Target</dt><dd>none · reference evaluator only</dd></div>
            <div><dt>Capital</dt><dd>$0 · no execution surface</dd></div>
          </dl>
          <p><CircleAlert size={15} aria-hidden="true" /> A successful reproduction is not an Agent Safety Card.</p>
        </aside>
      </section>

      <section className={styles.deck} id="fault-deck" aria-labelledby="fault-deck-title">
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.eyebrow}>Four-channel crash recorder</p>
            <h2 id="fault-deck-title">Reference fault deck</h2>
          </div>
          <p className={receipt ? styles.reproduced : styles.armed} role="status" aria-live="polite">
            {error ? "REFERENCE MISMATCH — STOPPED" : receipt ? "REFERENCE BEHAVIOR REPRODUCED" : "FIXTURES ARMED — NOT YET RUN"}
          </p>
        </div>

        <div className={styles.channels}>
          {(receipt?.results ?? Object.keys(scenarioLabels).map((scenarioId) => ({ scenarioId }))).map((result) => {
            const detail = scenarioLabels[result.scenarioId];
            const evaluated = "findingCodes" in result;
            return (
              <article className={styles.channel} key={result.scenarioId}>
                <div className={styles.channelRail} aria-hidden="true"><span /><span /><span /></div>
                <div className={styles.channelBody}>
                  <div className={styles.channelTitle}>
                    <span>{detail?.channel}</span>
                    <h3>{detail?.label}</h3>
                  </div>
                  <p>{evaluated ? "Expected finding set reproduced" : "Frozen expected fault · ready to reproduce"}</p>
                  {evaluated ? (
                    <ul aria-label={`${detail?.label} finding codes`}>
                      {result.findingCodes.map((code) => <li key={code}>{code}</li>)}
                    </ul>
                  ) : <div className={styles.placeholder}>RUN LOCALLY TO REVEAL FINDING RECEIPT</div>}
                  <code title={evaluated ? result.scenarioDefinitionSha256 : result.scenarioId}>
                    {evaluated ? shortHash(result.scenarioDefinitionSha256) : result.scenarioId}
                  </code>
                </div>
              </article>
            );
          })}
        </div>
        <div className={styles.tearLine} aria-hidden="true"><span>TEAR HERE FOR THE EVIDENCE RECORD</span></div>
      </section>

      <section className={styles.coverage} id="coverage" aria-labelledby="coverage-title">
        <div className={styles.coverageNumber} aria-hidden="true">26</div>
        <div>
          <p className={styles.eyebrow}>Known gap · visible before cryptography</p>
          <h2 id="coverage-title">Twenty-six hostile scenarios are not implemented.</h2>
          <p>
            The frozen strategy defines 30 finance-specific scenarios. This slice covers four modeled denial paths only.
            It has no positive liveness case and cannot distinguish a useful control from a system that denies everything.
          </p>
        </div>
        <ul>
          <li>External subject adapter: not in this card</li>
          <li>Positive calibration case: target-harness work</li>
          <li>Credential-free sandbox: required for commercial conformance</li>
          <li>Held-out and generated mutants: future robustness gate</li>
        </ul>
      </section>

      <section className={styles.evidence} id="evidence" aria-labelledby="evidence-title">
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.eyebrow}>Portable evidence · application profile plus core receipt</p>
            <h2 id="evidence-title">Exact bytes, separate claims.</h2>
          </div>
          <FileCheck2 size={27} aria-hidden="true" />
        </div>
        <div className={styles.evidenceGrid}>
          <article>
            <span>01 / BEHAVIOR</span>
            <h3>Trusted corpus recomputation</h3>
            <p>The application verifier reruns the internally owned corpus. A structurally valid archived receipt is not trusted as execution evidence.</p>
          </article>
          <article>
            <span>02 / COVERAGE</span>
            <h3>Exact four-fixture binding</h3>
            <p>Required scenario IDs, definition digests, complete coverage, expected findings, and outcome bytes are pinned.</p>
          </article>
          <article>
            <span>03 / CONTAINER</span>
            <h3>Proof Capsule integrity</h3>
            <p>The self-asserted signature binds exact bytes. It does not prove identity, independent time, execution, completeness, or correctness.</p>
          </article>
        </div>
        <div className={styles.downloadStrip}>
          <div>
            <span>IMMUTABLE SYNTHETIC SAMPLE</span>
            <strong>Archive SHA-256</strong>
            <code>{ARCHIVE_SHA256}</code>
          </div>
          <a download href="/control-card/synthetic-control-self-test-v0.runbook">
            <ArrowDownToLine size={16} aria-hidden="true" /> Download .runbook
          </a>
          <a download href="/control-card/synthetic-control-self-test-v0.domain-receipt.jcs">
            <Braces size={16} aria-hidden="true" /> Download domain receipt
          </a>
        </div>
      </section>

      <section className={styles.engagement} id="engagement" aria-labelledby="engagement-title">
        <div>
          <p className={styles.eyebrow}>Commercial hypothesis · not open for payment</p>
          <h2 id="engagement-title">Bring us the agent—not the credentials.</h2>
          <p>
            A proposed two-to-four-week preproduction readiness sprint for fintech and AI teams: adapter setup,
            synthetic fault injection, observation receipts, gap register, and remediation review.
          </p>
        </div>
        <div className={styles.engagementTerms}>
          <span>PRICE HYPOTHESIS</span><strong>$5k–$15k</strong>
          <span>LIVE CAPITAL</span><strong>$0</strong>
          <span>CURRENT STATE</span><strong>Design-partner validation</strong>
        </div>
        <p className={styles.engagementBoundary}>
          No broker login, account data, order routing, score, certification, compliance opinion, or production-readiness guarantee.
        </p>
      </section>

      <footer className={styles.footer}>
        <span>Runbook · broker-neutral financial agent safety infrastructure</span>
        <div><Link href="/verify">Verify a capsule</Link><Link href="/lineage">Inspect lineage</Link><Link href="/experiments/new">Research workspace</Link></div>
      </footer>
    </main>
  );
}
