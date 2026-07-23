import Link from "next/link";
import {
  ArrowRight,
  Ban,
  Fingerprint,
  FlaskConical,
  Gauge,
  GitBranch,
  Layers3,
  Link2,
  LockKeyhole,
  RadioTower,
  Repeat2,
  ScanSearch,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import styles from "./product-map.module.css";

const doors = [
  {
    index: "01",
    title: "Control Plane Session",
    body: "Bind charter digests, public-docs inventory pins, shadow metrics, and dossier status into one local session spine. Fail-closed on unknown tools.",
    href: "/session",
    cta: "Open Session dashboard",
    meta: ["Shared spine · MCP + web + shadow + dossier", "localStorage process evidence", "Not hard gateway · not certification"],
  },
  {
    index: "02",
    title: "Break the agent safely",
    body: "Reproduce the frozen Financial Agent Safety Bench control self-test. Four hostile fixtures, exact receipts, zero capital path.",
    href: "/safety-card",
    cta: "Open Safety Bench",
    meta: ["Pre-Capital / Safety Bench precursor", "Synthetic only · no agent connection", "4 of 30 scenarios implemented"],
  },
  {
    index: "03",
    title: "Verify portable evidence",
    body: "Load a bounded .runbook capsule in the browser Worker, or map multi-capsule lineage. Integrity without upload.",
    href: "/verify",
    cta: "Open capsule verifier",
    meta: ["Local Worker verification", "Also: /lineage for graph inspection", "Self-asserted author key only"],
  },
  {
    index: "04",
    title: "Record a human-owned experiment",
    body: "Define a capital mandate, then keep the ledger beside your agent via the local Runbook MCP companion. No broker credentials.",
    href: "/experiments/new",
    cta: "Start experiment charter",
    meta: ["MCP companion story", "Advisory preflight only", "Human-owned local ledger"],
  },
] as const;

const productSurfaces = [
  { href: "/session", label: "Control Plane Session", detail: "Charter · inventory pin · shadow · dossier evidence spine" },
  { href: "/registry", label: "Capability Registry", detail: "50-tool public-derived inventory + interactive drift theater" },
  { href: "/control-room", label: "Control Room", detail: "Local charter + real engine preflight tickets" },
  { href: "/shadow-lab", label: "Shadow Process Lab", detail: "Recursive refine · multi-charter tournament · meta-curriculum" },
  { href: "/dossier", label: "Dossier status", detail: "31-case architecture board · not buyer-ready" },
  { href: "/mcp", label: "MCP cockpit", detail: "Install, 30 tools, golden journey, fixture demos" },
  { href: "/lineage", label: "Lineage atlas", detail: "Multi-capsule graph, offline only" },
  { href: "/trust", label: "Trust center", detail: "Metadata snapshot inspection + limits" },
  { href: "/proof-capsule", label: "Proof capsule", detail: "Portable evidence packaging story" },
  { href: "/safety-card", label: "Safety Bench", detail: "Reference control self-test" },
] as const;

const researchHistory = [
  { href: "/growth", label: "Growth cockpit", note: "Manual creator measurement" },
  { href: "/content", label: "Publish desk", note: "Human-reviewed lab notes" },
  { href: "/lab/apply", label: "$499 lab fit check", note: "Historical commercial hypothesis" },
  { href: "/public/mason-agentic-arena", label: "Public lab page", note: "Synthetic demo surface" },
] as const;

export function ProductMap() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Runbook home">
          <BrandMark />
          <span>Runbook</span>
          <em>Product map</em>
        </Link>
        <nav className={styles.headerNav} aria-label="Product surfaces">
          <Link href="/session">Session</Link>
          <Link href="/registry">Registry</Link>
          <Link href="/control-room">Control Room</Link>
          <Link href="/shadow-lab">Shadow Lab</Link>
          <Link href="/dossier">Dossier</Link>
          <Link href="/mcp">MCP</Link>
          <Link href="/safety-card">Safety Bench</Link>
          <Link href="/verify">Verify</Link>
        </nav>
      </header>

      <div className={styles.truthRail} role="note" aria-label="Product boundary">
        <span>NO LIVE CAPITAL</span>
        <span>NO BROKER CREDENTIALS</span>
        <span>NO COMPOSITE SAFETY SCORE</span>
        <span>LOCAL-FIRST BUILDER SURFACE</span>
      </div>

      <section className={styles.hero} aria-labelledby="product-map-title">
        <div>
          <p className={styles.eyebrow}>Runbook · financial agent safety with evidence</p>
          <h1 id="product-map-title">Four doors. Zero credentials. Exact receipts.</h1>
          <p className={styles.lede}>
            Builders use Runbook to bind control-plane evidence, stress-test agent control paths,
            verify portable proof packages, and record human-owned experiments beside a brokerage
            agent—never inside one.
          </p>
        </div>

        <aside className={styles.boundaryCard} aria-label="Hard product boundary">
          <div className={styles.boundaryHead}>
            <span>BOUNDARY CARD</span>
            <strong>ALWAYS TRUE</strong>
          </div>
          <ul>
            <li>
              <LockKeyhole size={14} aria-hidden="true" />
              No brokerage credentials, OAuth tokens, or card numbers enter this surface.
            </li>
            <li>
              <Ban size={14} aria-hidden="true" />
              No order placement, cancellation, or live broker gateway.
            </li>
            <li>
              <ShieldCheck size={14} aria-hidden="true" />
              Assurance axes stay separate. No single “agent is safe” grade.
            </li>
            <li>
              <RadioTower size={14} aria-hidden="true" />
              No Robinhood Social automation. Manual, permission-gated distribution only.
            </li>
          </ul>
        </aside>
      </section>

      <section className={styles.doors} aria-label="Primary product doors">
        {doors.map((door) => (
          <Link key={door.href} className={styles.door} href={door.href}>
            <div className={styles.doorRail} aria-hidden="true" />
            <div className={styles.doorBody}>
              <span className={styles.doorIndex}>DOOR {door.index}</span>
              <h2>{door.title}</h2>
              <p>{door.body}</p>
              <div className={styles.doorMeta}>
                {door.meta.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
              <span className={styles.doorCta}>
                {door.cta}
                <ArrowRight size={15} aria-hidden="true" />
              </span>
            </div>
          </Link>
        ))}
      </section>

      <section className={styles.builderStrip} aria-label="Builder surfaces">
        <Link className={styles.builderCard} href="/session">
          <Link2 size={18} aria-hidden="true" />
          <div>
            <strong>Control Plane Session</strong>
            <span>Charter · inventory pin · fail-closed · dossier attach</span>
          </div>
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
        <Link className={styles.builderCard} href="/registry">
          <Layers3 size={18} aria-hidden="true" />
          <div>
            <strong>Registry explorer</strong>
            <span>50 tools · live filter counts · 45→50 drift theater</span>
          </div>
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
        <Link className={styles.builderCard} href="/control-room">
          <Gauge size={18} aria-hidden="true" />
          <div>
            <strong>Control Room</strong>
            <span>Real engine preflight · advisory tickets only</span>
          </div>
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
        <Link className={styles.builderCard} href="/shadow-lab">
          <Repeat2 size={18} aria-hidden="true" />
          <div>
            <strong>Shadow Process Lab</strong>
            <span>Refine · tournament Pareto · meta-curriculum</span>
          </div>
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
        <Link className={styles.builderCard} href="/dossier">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>Dossier status</strong>
            <span>31-case architecture board · not certified</span>
          </div>
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </section>

      <section className={styles.secondary} aria-label="More surfaces and research history">
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <p className={styles.eyebrow}>First-class product surfaces</p>
            <h2>Registry, control, dossier, MCP, evidence</h2>
          </div>
          <div className={styles.surfaceGrid}>
            {productSurfaces.map((surface) => (
              <Link key={surface.href} href={surface.href}>
                <strong>{surface.label}</strong>
                <span>{surface.detail}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <p className={styles.eyebrow}>Research history</p>
            <h2>Creator / growth lanes (not the offer)</h2>
          </div>
          <ul className={styles.historyList}>
            {researchHistory.map((item) => (
              <li key={item.href}>
                <span className={styles.historyTag}>History</span>
                <Link href={item.href}>{item.label}</Link>
                <em>{item.note}</em>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Runbook alpha · observer mode · no affiliation with Robinhood</span>
        <div>
          <Link href="/session"><Link2 size={12} aria-hidden="true" /> Session</Link>
          <Link href="/registry"><Layers3 size={12} aria-hidden="true" /> Registry</Link>
          <Link href="/control-room"><Gauge size={12} aria-hidden="true" /> Control Room</Link>
          <Link href="/shadow-lab"><Repeat2 size={12} aria-hidden="true" /> Shadow Lab</Link>
          <Link href="/dossier"><ShieldCheck size={12} aria-hidden="true" /> Dossier</Link>
          <Link href="/mcp"><Terminal size={12} aria-hidden="true" /> MCP</Link>
          <Link href="/verify"><ScanSearch size={12} aria-hidden="true" /> Verify</Link>
          <Link href="/lineage"><GitBranch size={12} aria-hidden="true" /> Lineage</Link>
          <Link href="/proof-capsule"><Fingerprint size={12} aria-hidden="true" /> Capsule</Link>
          <Link href="/experiments/new"><FlaskConical size={12} aria-hidden="true" /> Experiment</Link>
        </div>
      </footer>
    </main>
  );
}
