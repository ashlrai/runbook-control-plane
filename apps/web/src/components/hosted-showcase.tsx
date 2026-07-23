"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  ExternalLink,
  FlaskConical,
  LockKeyhole,
  Play,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import {
  browserSessionStore,
  buildPublicDocsInventoryPin,
  checkObservedToolsAgainstPin,
  demoCharterDualEval,
  refineCharterIntoSession,
  SAMPLE_OBSERVED_TOOLS_WITH_UNKNOWN,
  type ControlPlaneSession,
} from "../lib/control-plane-session";
import {
  GITHUB_PUBLIC,
  HOSTED_TRUTH_RAIL,
  SITE_ORIGIN,
  SITE_TAGLINE,
} from "../lib/site";
import styles from "./hosted-showcase.module.css";

type StepStatus = "idle" | "run" | "ok" | "fail";

type StoryStep = {
  id: string;
  title: string;
  detail: string;
  status: StepStatus;
};

const INITIAL_STEPS: StoryStep[] = [
  {
    id: "session",
    title: "Create control-plane session (weak seed)",
    detail: "Browser localStorage · capitalAtRisk 0 · brokerEffect false",
    status: "idle",
  },
  {
    id: "inventory",
    title: "Pin public-docs inventory + fail-closed unknown tool",
    detail: "place_crypto_order_unknown must fail under inventoryEnforcement",
    status: "idle",
  },
  {
    id: "shadow",
    title: "Shadow refine → hardFalseAllows = 0",
    detail: "Process metrics only · not trading performance",
    status: "idle",
  },
  {
    id: "dual-eval",
    title: "Fail-closed dual-eval denies option probe",
    detail: "ledgerAllowed may stay true · processAllowed false · still not a broker gateway",
    status: "idle",
  },
  {
    id: "pack",
    title: "Evidence pack shape ready for export",
    detail: "Session holds charter digest, pin, shadow generations, honesty rails",
    status: "idle",
  },
];

export function HostedShowcase() {
  const [steps, setSteps] = useState<StoryStep[]>(INITIAL_STEPS);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string>("// Run the live story to emit a browser receipt.");
  const [sessionId, setSessionId] = useState<string | null>(null);

  const patchStep = useCallback((id: string, status: StepStatus, detail?: string) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.id === id
          ? { ...step, status, ...(detail !== undefined ? { detail } : {}) }
          : step,
      ),
    );
  }, []);

  const runStory = useCallback(async () => {
    setBusy(true);
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "idle" as const })));
    const errors: string[] = [];
    let session: ControlPlaneSession | null = null;

    try {
      patchStep("session", "run");
      session = await browserSessionStore.create({
        label: "Hosted showcase control plane",
        charterSeed: "weak",
        inventoryEnforcement: "fail-closed",
        charterBindingEnforcement: "fail-closed",
      });
      setSessionId(session.sessionId);
      patchStep(
        "session",
        "ok",
        `${session.sessionId} · charterBinding=fail-closed · inventory=fail-closed`,
      );

      patchStep("inventory", "run");
      const pin = await buildPublicDocsInventoryPin({
        label: "Hosted showcase public-docs pin",
      });
      session = await browserSessionStore.setInventoryPin(session.sessionId, pin);
      const check = await checkObservedToolsAgainstPin(
        pin,
        [...SAMPLE_OBSERVED_TOOLS_WITH_UNKNOWN],
        "fail-closed",
      );
      if (check.ok || !(check.unknownTools ?? []).includes("place_crypto_order_unknown")) {
        errors.push("inventory-expected-unknown-fail");
        patchStep("inventory", "fail", check.message);
      } else {
        patchStep(
          "inventory",
          "ok",
          `FAIL-CLOSED · unknown=${check.unknownTools.join(",")} · tools pinned=${pin.tools.length}`,
        );
      }

      patchStep("shadow", "run");
      const refine = await refineCharterIntoSession({
        sessionId: session.sessionId,
        maxGenerations: 4,
      });
      session = browserSessionStore.read(session.sessionId);
      if (refine.finalHardFalseAllows !== 0) {
        errors.push(`shadow-hfa-not-zero:${refine.finalHardFalseAllows}`);
        patchStep("shadow", "fail", `HFA ${refine.finalHardFalseAllows}`);
      } else {
        patchStep(
          "shadow",
          "ok",
          `HFA ${refine.finalHardFalseAllows} · HFD ${refine.finalHardFalseDenies} · gens=${refine.generationsRecorded}`,
        );
      }

      patchStep("dual-eval", "run");
      session = browserSessionStore.read(session.sessionId);
      // Ensure fail-closed after refine (create already set it).
      session = await browserSessionStore.setCharterBindingEnforcement(
        session.sessionId,
        "fail-closed",
      );
      const dual = demoCharterDualEval(session);
      if (
        dual.sessionCharterBinding !== "mismatch-session-denies" ||
        dual.allowed !== false ||
        dual.processDeniedBySession !== true
      ) {
        errors.push(`dual-eval-unexpected:${dual.sessionCharterBinding}`);
        patchStep(
          "dual-eval",
          "fail",
          `binding=${dual.sessionCharterBinding} allowed=${String(dual.allowed)}`,
        );
      } else {
        patchStep(
          "dual-eval",
          "ok",
          `process deny · ledgerAllowed=${String(dual.ledgerAllowed)} · binding=${dual.sessionCharterBinding}`,
        );
      }

      patchStep("pack", "run");
      session = browserSessionStore.read(session.sessionId);
      const packOk =
        session.charterDigest !== undefined &&
        session.inventoryPin !== undefined &&
        (session.shadowGenerations?.length ?? 0) > 0 &&
        session.capitalAtRisk === 0 &&
        session.brokerEffect === false &&
        session.compositeScore === false;
      if (!packOk) {
        errors.push("pack-shape-incomplete");
        patchStep("pack", "fail", "Missing digest, pin, or shadow generations");
      } else {
        patchStep(
          "pack",
          "ok",
          `digest=${session.charterDigest?.slice(0, 12)}… · shadowGens=${session.shadowGenerations.length}`,
        );
      }

      const receiptBody = {
        schemaVersion: "runbook.hosted-showcase.v1",
        origin: SITE_ORIGIN,
        sessionId: session.sessionId,
        success: errors.length === 0,
        errors,
        inventoryUnknown: check.unknownTools,
        hardFalseAllows: refine.finalHardFalseAllows,
        hardFalseDenies: refine.finalHardFalseDenies,
        dualEval: {
          binding: dual.sessionCharterBinding,
          ledgerAllowed: dual.ledgerAllowed,
          processAllowed: dual.allowed,
          processDeniedBySession: dual.processDeniedBySession,
          charterBindingEnforcement: dual.charterBindingEnforcement,
        },
        capitalAtRisk: 0,
        brokerEffect: false,
        compositeScore: false,
        notTradingPerformance: true,
        note: "Browser localStorage process evidence only. Not a hard broker gateway.",
      };
      setReceipt(JSON.stringify(receiptBody, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : "showcase-failed";
      errors.push(message);
      setReceipt(
        JSON.stringify(
          {
            schemaVersion: "runbook.hosted-showcase.v1",
            success: false,
            errors,
            brokerEffect: false,
            compositeScore: false,
          },
          null,
          2,
        ),
      );
    } finally {
      setBusy(false);
    }
  }, [patchStep]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Runbook home">
          <BrandMark />
          <span>Runbook</span>
          <em>Hosted showcase</em>
        </Link>
        <nav className={styles.headerNav} aria-label="Showcase navigation">
          <Link href="/session">Session</Link>
          <Link href="/shadow-lab">Shadow Lab</Link>
          <Link href="/mcp">MCP</Link>
          <Link href="/control-room">Control Room</Link>
          <a href={GITHUB_PUBLIC} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </header>

      <div className={styles.truthRail} role="note" aria-label="Hosted honesty boundary">
        {HOSTED_TRUTH_RAIL.map((chip) => (
          <span key={chip}>{chip}</span>
        ))}
      </div>

      <section className={styles.hero} aria-labelledby="showcase-title">
        <div>
          <p className={styles.eyebrow}>runbook.ashlr.ai · live process lab</p>
          <h1 id="showcase-title">One click. Full control-plane story. Zero capital.</h1>
          <p className={styles.lede}>
            {SITE_TAGLINE} This hosted lab runs inventory fail-closed, shadow refine to HFA=0, and
            session charter dual-eval entirely in your browser — the same spine as{" "}
            <code>pnpm demo:control-plane</code>, without brokerage credentials.
          </p>
          <div className={styles.ctaRow}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void runStory()}
              disabled={busy}
              aria-busy={busy}
            >
              <Play size={15} aria-hidden="true" />
              {busy ? "Running story…" : "Run live control-plane story"}
            </button>
            <Link className={styles.ghostBtn} href="/session">
              <FlaskConical size={15} aria-hidden="true" />
              Open Session dashboard
            </Link>
            <a className={styles.ghostBtn} href={GITHUB_PUBLIC} target="_blank" rel="noreferrer">
              <ExternalLink size={15} aria-hidden="true" />
              Public source
            </a>
          </div>
        </div>

        <aside className={styles.boundary} aria-label="Hard product boundary">
          <div className={styles.boundaryHead}>
            <span>BOUNDARY</span>
            <strong>ALWAYS TRUE</strong>
          </div>
          <ul>
            <li>
              <LockKeyhole size={13} aria-hidden="true" />
              Browser localStorage only — not the MCP disk ledger at ~/.runbook
            </li>
            <li>
              <ShieldAlert size={13} aria-hidden="true" />
              Fail-closed process deny ≠ hard broker gateway
            </li>
            <li>
              <ShieldCheck size={13} aria-hidden="true" />
              Shadow metrics are process axes (HFA/HFD), not returns
            </li>
            <li>
              <Terminal size={13} aria-hidden="true" />
              Full MCP surface: clone the public repo or run local companion tools
            </li>
          </ul>
        </aside>
      </section>

      <section className={styles.story} aria-label="Control plane story steps">
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>Story</p>
              <h2>Session → inventory → shadow → dual-eval → pack</h2>
            </div>
            <code style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              {sessionId ?? "no session yet"}
            </code>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.steps} role="list">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className={styles.step}
                  role="listitem"
                  data-status={step.status}
                  data-step={step.id}
                >
                  <span className={styles.stepIndex}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className={styles.stepBody}>
                    <strong>{step.title}</strong>
                    <span>{step.detail}</span>
                  </div>
                  <span className={styles.stepStatus}>{step.status.toUpperCase()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>Receipt</p>
              <h2>runbook.hosted-showcase.v1</h2>
            </div>
          </div>
          <div className={styles.sectionBody}>
            <pre className={styles.receipt} aria-label="Showcase receipt JSON">
              {receipt}
            </pre>
            <div className={styles.links} aria-label="Continue after showcase">
              {sessionId ? (
                <Link
                  className={styles.chipLink}
                  href={`/session?sessionId=${encodeURIComponent(sessionId)}`}
                >
                  Session · {sessionId.slice(0, 12)}…
                </Link>
              ) : (
                <Link className={styles.chipLink} href="/session">
                  Session spine
                </Link>
              )}
              <Link className={styles.chipLink} href="/verify">
                Capsule verifier
              </Link>
              <Link className={styles.chipLink} href="/theater">
                Process Theater
              </Link>
              {sessionId ? (
                <Link
                  className={styles.chipLink}
                  href={`/control-room?sessionId=${encodeURIComponent(sessionId)}`}
                >
                  Control Room dual-eval
                </Link>
              ) : (
                <Link className={styles.chipLink} href="/control-room">
                  Control Room preflight
                </Link>
              )}
              <Link className={styles.chipLink} href="/shadow-lab">
                Shadow Lab
              </Link>
              <Link className={styles.chipLink} href="/mcp">
                MCP cockpit (39 tools)
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        Hosted at {SITE_ORIGIN}. Public core:{" "}
        <a href={GITHUB_PUBLIC} target="_blank" rel="noreferrer">
          ashlrai/runbook-control-plane
        </a>
        . Not affiliated with Robinhood. Not investment advice. Live-capital allocation remains $0.
      </footer>
    </main>
  );
}
