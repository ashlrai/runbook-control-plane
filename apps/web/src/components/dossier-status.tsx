import Link from "next/link";
import { ArrowRight, Layers3, ShieldCheck, Terminal } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { DossierSessionAttach } from "./dossier-session-attach";
import {
  DOSSIER_CASES,
  DOSSIER_COUNTS,
  DOSSIER_DISCLAIMER,
  DOSSIER_LINKS,
  STATUS_META,
  type DossierCaseStatus,
} from "../lib/dossier-status-data";
import styles from "./dossier-status.module.css";

const STATUS_ORDER: DossierCaseStatus[] = ["process-bridged", "host-only", "unrun"];

export function DossierStatus() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Runbook home">
          <BrandMark />
          <span>Runbook</span>
          <em>Dossier</em>
        </Link>
        <nav className={styles.headerNav} aria-label="Dossier navigation">
          <Link href="/">Product map</Link>
          <Link href="/session">Session</Link>
          <Link href="/safety-card">Safety Bench</Link>
          <Link href="/registry">Registry</Link>
          <Link href="/mcp">MCP</Link>
          <Link href="/control-room">Control Room</Link>
        </nav>
      </header>

      <div className={styles.truthRail} role="note" aria-label="Dossier honesty boundary">
        <span>ARCHITECTURE EVIDENCE</span>
        <span>NOT BUYER-READY</span>
        <span>NOT A SAFETY SCORE</span>
        <span>NO LIVE CAPITAL</span>
        <span>030 NOT FULL PROCESS-BRIDGE</span>
      </div>

      <section className={styles.hero} aria-labelledby="dossier-title">
        <div>
          <p className={styles.eyebrow}>Pre-Capital Control Dossier V2 · status board</p>
          <h1 id="dossier-title">Thirty-one cases. Six evaluated. Five process-bridged.</h1>
          <p className={styles.lede}>
            Honest product status for the dossier namespace. Process-bridged means a completed
            child-process lifecycle was committed for that scenario — not sandbox isolation, not
            independent assurance, and not certification that an agent is safe. finance-030 stays
            host-only: primary crash trials have no process bridge; three recovery trials have
            host-seeded recover process evidence only. Kill grammar is designed, not shipped.
          </p>
        </div>
        <aside className={styles.disclaimer} aria-label={DOSSIER_DISCLAIMER.title}>
          <strong>{DOSSIER_DISCLAIMER.title}</strong>
          <ul>
            {DOSSIER_DISCLAIMER.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </aside>
      </section>

      <div className={styles.counts} aria-label="Dossier coverage counts">
        <div className={styles.count}>
          <span>Namespace</span>
          <strong>{DOSSIER_COUNTS.total}</strong>
          <em>finance-000 … 030</em>
        </div>
        <div className={styles.count} data-tone="bridge">
          <span>Process-bridged</span>
          <strong>{DOSSIER_COUNTS.processBridged}</strong>
          <em>000 · 003 · 010 · 027 · 028</em>
        </div>
        <div className={styles.count} data-tone="host">
          <span>Host-only evaluated</span>
          <strong>{DOSSIER_COUNTS.hostOnly}</strong>
          <em>030 · {DOSSIER_COUNTS.recoverProcessPartialTrials} recover trials process-partial</em>
        </div>
        <div className={styles.count} data-tone="unrun">
          <span>Explicit unrun</span>
          <strong>{DOSSIER_COUNTS.unrun}</strong>
          <em>catalog coverage</em>
        </div>
      </div>

      <div className={styles.legend} aria-label="Status legend">
        {STATUS_ORDER.map((status) => {
          const meta = STATUS_META[status];
          return (
            <div key={status} className={styles.legendItem} data-tone={meta.tone}>
              <strong>{meta.label}</strong>
              <span>{meta.short}</span>
            </div>
          );
        })}
      </div>

      <DossierSessionAttach />

      <section className={styles.gridSection} aria-labelledby="grid-title">
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>Case namespace</p>
          <h2 id="grid-title">finance-000 … finance-030</h2>
        </div>
        <div className={styles.grid} role="list">
          {DOSSIER_CASES.map((item) => {
            const meta = STATUS_META[item.status];
            return (
              <article
                key={item.id}
                className={styles.card}
                data-status={item.status}
                role="listitem"
              >
                <div className={styles.cardTop}>
                  <span className={styles.ordinal}>{item.shortId}</span>
                  <span className={styles.statusBadge} data-tone={meta.tone}>
                    {meta.label}
                  </span>
                </div>
                <h3>{item.title}</h3>
                <code>{item.slug}</code>
                {item.detail ? <p className={styles.cardDetail}>{item.detail}</p> : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.links} aria-labelledby="links-title">
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>Related product surfaces</p>
          <h2 id="links-title">Safety, registry, MCP, control</h2>
        </div>
        <div className={styles.linkGrid}>
          {DOSSIER_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={styles.linkCard}>
              <strong>{link.label}</strong>
              <span>{link.detail}</span>
              <em>
                Open <ArrowRight size={13} aria-hidden="true" />
              </em>
            </Link>
          ))}
        </div>
        <div className={styles.footIcons}>
          <Link href="/safety-card">
            <ShieldCheck size={13} aria-hidden="true" /> Safety Bench
          </Link>
          <Link href="/registry">
            <Layers3 size={13} aria-hidden="true" /> Registry
          </Link>
          <Link href="/mcp">
            <Terminal size={13} aria-hidden="true" /> MCP
          </Link>
        </div>
      </section>
    </main>
  );
}
