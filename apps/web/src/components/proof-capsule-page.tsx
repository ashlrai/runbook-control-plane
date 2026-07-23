import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  FileJson2,
  Fingerprint,
  FlaskConical,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import styles from "./proof-capsule-page.module.css";

const assuranceDimensions = [
  {
    rank: "01",
    label: "Package integrity",
    state: "valid / tampered / unsupported",
    meaning: "Do every declared byte and schema entry match the signed manifest?",
    limit: "Integrity does not make the claims true.",
  },
  {
    rank: "02",
    label: "Author signature",
    state: "valid / invalid / absent",
    meaning: "Was this artifact signed by the holder of the displayed key?",
    limit: "A self-asserted key is not legal identity or broker ownership.",
  },
  {
    rank: "03",
    label: "Time evidence",
    state: "anchored / self-declared / absent",
    meaning: "Is there independent evidence that a digest existed by a stated time?",
    limit: "A timestamp does not prove an event happened then.",
  },
  {
    rank: "04",
    label: "Source coverage",
    state: "claim-specific",
    meaning: "Which claim cites included bytes, a commitment, or a trusted attestation?",
    limit: "A user-supplied export is not automatically broker-issued.",
  },
  {
    rank: "05",
    label: "Completeness",
    state: "complete / gaps / partial / unknown",
    meaning: "What named accounts, sources, asset classes, and dates were reconciled?",
    limit: "Nothing outside the declared scope is evaluated.",
  },
  {
    rank: "06",
    label: "Data + policy",
    state: "synthetic / live-author-declared",
    meaning: "What execution class is declared, and did recorded actions match the included policy?",
    limit: "Conformance does not prove safety, skill, or suitability.",
  },
] as const;

const processSteps = [
  {
    number: "01",
    title: "Commit before the outcome",
    copy: "Write the question, benchmark, window, capital boundary, approval rule, and stop conditions before the first in-scope action.",
  },
  {
    number: "02",
    title: "Preserve the whole process",
    copy: "Keep proposals, rejections, approvals, corrections, cash flows, source coverage, outcomes, and known gaps in one append-only record.",
  },
  {
    number: "03",
    title: "Target: proof anyone can check",
    copy: "The intended workflow is to export one author-signed portable artifact, verify it locally, publish a readable report, and let another person clone the charter without copying a trade.",
  },
] as const;

const challengeGates = [
  { value: "10", label: "independent people verify the golden fixture" },
  { value: "5", label: "valid local child capsules created" },
  { value: "3", label: "independent authors publish a child" },
  { value: "1+", label: "child preserves a failure, rejection, correction, or null" },
] as const;

const included = [
  "One 45-minute experiment-design session",
  "A written charter and evidence plan",
  "Local Runbook setup and first recorded event",
  "One portable proof capsule and public proof page",
  "Four weekly report drafts with losses and limitations preserved",
  "A final evidence review and export",
] as const;

export function ProofCapsulePage() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="Proof Capsule navigation">
        <Link className={styles.brand} href="/" aria-label="Runbook home">
          <BrandMark />
          <span>Runbook</span>
          <em>proof capsule</em>
        </Link>
        <div className={styles.navLinks}>
          <a href="#assurance">Assurance</a>
          <a href="#challenge">Challenge</a>
          <a href="#protocol">Open format</a>
          <Link href="/verify">Capsule verifier</Link>
          <Link href="/trust">Metadata demo</Link>
          <Link href="/lineage">Lineage atlas</Link>
        </div>
      </nav>

      <div className={styles.announcement}>
        <FlaskConical size={15} aria-hidden="true" />
        <strong>Challenge design preview</strong>
        <span>The local browser verifier, CLI, and frozen test pair exist. Signed child export, submissions, and enrollment are not open.</span>
      </div>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}><Fingerprint size={16} aria-hidden="true" /> Portable proof for agentic investing</div>
          <h1>Don’t trust the screenshot. <span>Verify the process.</span></h1>
          <p>Runbook is being built to turn a bounded investing experiment into a portable proof capsule: the charter written before the result, agent and human decisions, rejected actions, policy versions, outcomes, disclosures, and an evidence map you can inspect locally.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href="/verify">Verify a capsule locally <ArrowRight size={15} aria-hidden="true" /></Link>
            <Link className={styles.secondaryButton} href="/lineage">Trace a local file set</Link>
            <a className={styles.secondaryButton} href="#challenge">Study Verify → Clone</a>
          </div>
          <small className={styles.heroHelper}><LockKeyhole size={13} aria-hidden="true" /> The browser-native verifier processes one <code>.runbook</code> locally and emits exact JCS receipt bytes. It does not upload or render capsule content.</small>
        </div>

        <div className={styles.receiptWrap} aria-label="Synthetic proof capsule product preview">
          <div className={styles.receiptTape}>SYNTHETIC · REFERENCE SPECIMEN</div>
          <article className={styles.receipt}>
            <div className={styles.receiptHead}>
              <div><span>RUNBOOK / PROOF CAPSULE</span><strong>minimal-synthetic-root</strong></div>
              <div className={styles.seal}><ShieldCheck size={22} aria-hidden="true" /><span>expected<br />intact</span></div>
            </div>
            <div className={styles.receiptRows}>
              <div><span>DATA CLASS</span><strong>SYNTHETIC</strong><em>declared</em></div>
              <div><span>MANIFEST</span><strong>runbook.proof-capsule.v1</strong><em>draft profile</em></div>
              <div><span>AUTHOR KEY</span><strong>self-asserted reference</strong><em>not identity</em></div>
              <div><span>SOURCE TRUTH</span><strong>not established</strong><em>no broker record</em></div>
              <div><span>LINEAGE</span><strong>root · no parents</strong><em>signed declaration</em></div>
            </div>
            <div className={styles.digest}>
              <span>SIGNED CHECKPOINT ID · SAME IN BOTH TRANSPORT FILES</span>
              <code>66b200560e20f723ece402931277043b<wbr />85316687aac30f73c4da6a4d5a323578</code>
            </div>
            <p><ShieldAlert size={14} aria-hidden="true" /> “Runbook artifact verified” is an integrity statement—not verified returns.</p>
          </article>
        </div>
      </header>

      <aside className={styles.truthStrip} aria-label="Current product status">
        <strong>Current-state boundary</strong>
        <p>No real account, trade, return, or broker record appears in this model. Separate Node and browser-native <code>.runbook</code> verifiers now agree on the frozen synthetic golden/tampered receipts. This remains a same-project draft implementation—not independent interoperability evidence, identity proof, or broker truth.</p>
      </aside>

      <section className={styles.assuranceSection} id="assurance" aria-labelledby="assurance-heading">
        <div className={styles.sectionLead}>
          <span>Proof before pitch</span>
          <h2 id="assurance-heading">One green shield is not enough.</h2>
          <p>Runbook keeps separate assurance dimensions visible so package integrity can never silently become a claim about brokerage truth, completeness, or investing skill.</p>
        </div>
        <div className={styles.assuranceTable}>
          <div className={styles.tableHead}><span>Dimension</span><span>Question answered</span><span>Hard limit</span></div>
          {assuranceDimensions.map((dimension) => (
            <article key={dimension.rank}>
              <div><em>{dimension.rank}</em><strong>{dimension.label}</strong><small>{dimension.state}</small></div>
              <p>{dimension.meaning}</p>
              <p>{dimension.limit}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.twinSection} aria-labelledby="twin-heading">
        <div className={styles.sectionLead}>
          <span>Synthetic reference pair</span>
          <h2 id="twin-heading">We changed one byte on purpose.</h2>
          <p>The frozen conformance corpus pairs an intact minimal synthetic artifact with a transport-valid copy whose payload changed after signing. There is no experiment result in either fixture; verifier behavior is the product test.</p>
        </div>
        <div className={styles.twins}>
          <article className={styles.goldenTwin}>
            <div className={styles.twinTop}><span>SYNTHETIC GOLDEN · FROZEN FIXTURE</span><ShieldCheck size={19} aria-hidden="true" /></div>
            <code>{'{"dataClass":"synthetic"}'}</code>
            <strong>Expected: artifact intact</strong>
            <p>Declared bytes match the author-signed manifest. Source truth and identity remain separate questions.</p>
            <p>Outer archive SHA-256:<br />4a11da34f4f8ed3dcea6167f93e729db<wbr />bde7d69246e665d0b8616656eda74191</p>
          </article>
          <div className={styles.twinDivider}><span>one payload byte changed after signing</span><ArrowRight size={18} aria-hidden="true" /></div>
          <article className={styles.tamperedTwin}>
            <div className={styles.twinTop}><span>SYNTHETIC TAMPERED · FROZEN FIXTURE</span><ShieldAlert size={19} aria-hidden="true" /></div>
            <code>{'{"dataClass":"synthetix"}'}</code>
            <strong>Expected: verification fails</strong>
            <p>Byte 22 changes from ASCII “c” to “x”; transport remains valid, but the manifest digest does not match.</p>
            <p>Outer archive SHA-256:<br />eed412e23ce2a4c51c3e216a451585b8<wbr />a82d9ad761e7dbfbe885f515b3a465e4</p>
          </article>
        </div>
      </section>

      <section className={styles.processSection} aria-labelledby="process-heading">
        <div className={styles.sectionLead}>
          <span>How it works</span>
          <h2 id="process-heading">One experiment. Three moves.</h2>
        </div>
        <div className={styles.processGrid}>
          {processSteps.map((step) => (
            <article key={step.number}>
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.challengeSection} id="challenge" aria-labelledby="challenge-heading">
        <div className={styles.challengeCopy}>
          <span className={styles.lightEyebrow}>Proposed 30-day challenge</span>
          <h2 id="challenge-heading">Fork the rules, not the trade.</h2>
          <p>The proposed challenge would ask an author to change exactly one declared assumption and publish a signed synthetic child capsule that cites its verified parent. Today’s frozen charter is only the minimal conformance root, and the product cannot yet create signed child capsules. Paper and mixed evidence require a future schema decision.</p>
          <div className={styles.challengeActions}>
            <Link className={styles.lightButton} href="/experiments/new">Draft an unsigned starter</Link>
            <Link className={styles.darkOutlineButton} href="/verify">Run the capsule verifier</Link>
          </div>
          <p>An unsigned starter is not a proof capsule, does not create valid lineage, and is not a challenge submission.</p>
        </div>
        <div className={styles.challengeTargets} aria-label="Unobserved 30-day challenge targets">
          <strong>DAY-30 GATES · TARGETS, NOT RESULTS</strong>
          {challengeGates.map((gate, index) => (
            <div key={gate.label}><span>{String(index + 1).padStart(2, "0")}</span><b>{gate.value}</b><p>{gate.label}</p></div>
          ))}
          <small>Real-money trading to enter or improve a submission is prohibited.</small>
        </div>
      </section>

      <section className={styles.protocolSection} id="protocol" aria-labelledby="protocol-heading">
        <div className={styles.protocolManifest}>
          <span>OPEN THE TRUTH FORMAT</span>
          <div><FileJson2 size={20} aria-hidden="true" /><strong>Schema</strong><em>portable</em></div>
          <div><Fingerprint size={20} aria-hidden="true" /><strong>Verifier</strong><em>local</em></div>
          <div><FlaskConical size={20} aria-hidden="true" /><strong>Fixtures</strong><em>adversarial</em></div>
          <div><BookOpenCheck size={20} aria-hidden="true" /><strong>Tests</strong><em>draft-profile</em></div>
        </div>
        <div className={styles.protocolCopy}>
          <span>Open-format moat</span>
          <h2 id="protocol-heading">Verification stays free.</h2>
          <p>A recipient should never need a Runbook account, a working Runbook cloud, or a payment to validate an existing capsule. The schema, local verifier, synthetic fixtures, and conformance tests are designed to stay open.</p>
          <p>The paid moat is the hard operational work around the standard: experiment design, local evidence mapping, collaboration, continuity, review, publication, and a growing opt-in lineage of credible child artifacts.</p>
          <Link href="/verify">Inspect a normative receipt <ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
      </section>

      <section className={styles.labSection} id="lab" aria-labelledby="lab-heading">
        <div className={styles.labHeadline}>
          <div><span>Proposed Founding Creator Lab</span><h2 id="lab-heading">Publish the bounded record—including known gaps.</h2></div>
          <div className={styles.price}><strong>$499</strong><span>target price</span><em>Five target pilots · enrollment not open</em></div>
        </div>
        <div className={styles.labBody}>
          <div>
            <p>A proposed 30-day concierge implementation for finance creators, educators, and agent builders who already publish and want an inspectable recurring evidence workflow. The offer is a validation target, not a currently enrolled program.</p>
            <ul>{included.map((item) => <li key={item}><Check size={14} aria-hidden="true" />{item}</li>)}</ul>
          </div>
          <aside>
            <ShieldAlert size={22} aria-hidden="true" />
            <strong>The scope is deliberately narrow.</strong>
            <p>No investment advice, signals, account management, order routing, promised returns, or legal compliance certification. Runbook never needs a brokerage password or API credential. Public evidence requires participant and Runbook human review against a field allowlist; that review is not an anonymity certification.</p>
          </aside>
        </div>
        <div className={styles.labActions}>
          <Link className={styles.primaryButton} href="/lab/apply">Run the local-answer fit check <ArrowRight size={15} aria-hidden="true" /></Link>
          <Link className={styles.secondaryButton} href="/growth">Inspect the validation gates</Link>
          <small>The fit check asks for no identity or account data, stays in your browser, and takes no payment.</small>
        </div>
      </section>

      <section className={styles.finalSection} aria-labelledby="final-heading">
        <div><span>Portable process proof</span><h2 id="final-heading">Evidence should travel farther than the claim.</h2></div>
        <div>
          <Link className={styles.primaryButton} href="/verify">Open the local capsule verifier</Link>
          <Link className={styles.secondaryButton} href="/lab/apply">Run the local-answer fit check</Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}><BrandMark /><span>Runbook</span></div>
        <p>Independent experiment infrastructure—not a broker-dealer, investment adviser, signal service, or Robinhood affiliate. Investing involves risk, including loss. Nothing on this page is a recommendation or promise of performance.</p>
      </footer>
    </main>
  );
}
