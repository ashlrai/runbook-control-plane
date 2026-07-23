"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  Fingerprint,
  KeyRound,
  LockKeyhole,
  Play,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import {
  GATEWAY_THEATER_LABEL,
  GATEWAY_THEATER_LIMITATIONS,
  getGatewayTheaterScenario,
  runGatewayTheaterSigningDemo,
  type GatewayTheaterScenarioId,
  type GatewayTheaterSigningDemo,
} from "../lib/gateway-theater-demo";
import { HOSTED_TRUTH_RAIL } from "../lib/site";
import styles from "./gateway-theater.module.css";

const SCENARIO_ORDER: GatewayTheaterScenarioId[] = [
  "authorize-quorum",
  "deny-missing-role",
  "replay-prior-use",
];

export function GatewayTheater() {
  const [scenarioId, setScenarioId] = useState<GatewayTheaterScenarioId>("authorize-quorum");
  const [signing, setSigning] = useState<GatewayTheaterSigningDemo | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusNote, setStatusNote] = useState(
    "Select a fixture scenario or run the 2-role Web Crypto signing demo. Full evaluateActionAuthorization is MCP/CLI only.",
  );

  const scenario = useMemo(() => getGatewayTheaterScenario(scenarioId), [scenarioId]);

  const runSigningDemo = useCallback(async () => {
    setBusy(true);
    try {
      const demo = await runGatewayTheaterSigningDemo();
      setSigning(demo);
      setStatusNote(
        `Web Crypto Ed25519 demo · owner+risk signed · allValid=${String(demo.allSignaturesValid)} · ${GATEWAY_THEATER_LABEL}`,
      );
    } catch (error) {
      setSigning(null);
      setStatusNote(error instanceof Error ? error.message : "Signing demo failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Runbook home">
          <BrandMark />
          <span>Runbook</span>
          <em>Gateway</em>
        </Link>
        <nav className={styles.headerNav} aria-label="Gateway navigation">
          <Link href="/">Product map</Link>
          <Link href="/theater">Process Theater</Link>
          <Link href="/session">Session</Link>
          <Link href="/control-room">Control Room</Link>
          <Link href="/mcp">MCP</Link>
        </nav>
      </header>

      <div className={styles.truthRail} role="note" aria-label="Gateway honesty boundary">
        {HOSTED_TRUTH_RAIL.map((chip) => (
          <span key={chip}>{chip}</span>
        ))}
        <span>NOT HARD BROKER GATEWAY</span>
        <span>FIXTURE THEATER</span>
      </div>

      <section className={styles.hero} aria-labelledby="gateway-title">
        <div>
          <p className={styles.eyebrow}>Gateway quorum · hosted lab theater</p>
          <h1 id="gateway-title">Multi-role approval conditions — without live capital.</h1>
          <p className={styles.lede}>
            Walk authorize, deny, and replay check lists that mirror{" "}
            <code>@runbook/engine/gateway</code> semantics. Browser does not import node:crypto
            evaluation. Full signed quorum evaluation remains MCP/CLI.
          </p>
          <p className={styles.theaterLabel} aria-label="Theater mode label">
            {GATEWAY_THEATER_LABEL}
          </p>
        </div>

        <aside className={styles.boundaryCard} aria-label="Gateway boundary card">
          <div className={styles.boundaryHead}>
            <span>BOUNDARY</span>
            <strong>ALWAYS TRUE</strong>
          </div>
          <ul>
            <li>
              <LockKeyhole size={14} aria-hidden="true" />
              authorizationConditionsSatisfied is not mayExecute.
            </li>
            <li>
              <ShieldAlert size={14} aria-hidden="true" />
              No broker credentials, order placement, or live gateway.
            </li>
            <li>
              <Users size={14} aria-hidden="true" />
              Demo keys are synthetic self-asserted Ed25519 only.
            </li>
            <li>
              <Fingerprint size={14} aria-hidden="true" />
              Host may bypass Runbook entirely.
            </li>
          </ul>
        </aside>
      </section>

      <section className={styles.grid} aria-label="Gateway theater panels">
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>Fixture scenarios</p>
              <h2>Authorize · deny · replay</h2>
            </div>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.scenarioTabs} role="tablist" aria-label="Gateway scenarios">
              {SCENARIO_ORDER.map((id) => {
                const s = getGatewayTheaterScenario(id);
                const active = id === scenarioId;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={active ? styles.tabActive : styles.tab}
                    onClick={() => {
                      setScenarioId(id);
                      setStatusNote(`Fixture scenario · ${s.title} · ${GATEWAY_THEATER_LABEL}`);
                    }}
                  >
                    {s.decision.toUpperCase()}
                  </button>
                );
              })}
            </div>

            <div className={styles.scenarioMeta} aria-label="Selected scenario summary">
              <h3>{scenario.title}</h3>
              <p>{scenario.summary}</p>
              <div className={styles.metaChips}>
                <span>decision={scenario.decision}</span>
                <span>
                  authorizationConditionsSatisfied=
                  {String(scenario.authorizationConditionsSatisfied)}
                </span>
                <span>
                  {scenario.actionType} · {scenario.environment}
                </span>
                <span>
                  quorum {scenario.requiredApprovals} · roles{" "}
                  {scenario.requiredRoles.join("+")}
                </span>
              </div>
            </div>

            <ul className={styles.checkList} aria-label="Authorization checks">
              {scenario.checks.map((check) => (
                <li
                  key={check.code}
                  className={check.passed ? styles.checkPass : styles.checkFail}
                  data-passed={check.passed ? "true" : "false"}
                >
                  <span className={styles.checkCode}>{check.code}</span>
                  <span className={styles.checkResult}>{check.passed ? "PASS" : "FAIL"}</span>
                  {check.note ? <em>{check.note}</em> : null}
                </li>
              ))}
            </ul>

            <ul className={styles.honestyList} aria-label="Scenario honesty rails">
              {scenario.honesty.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>Web Crypto · 2 roles</p>
              <h2>Owner + risk signing demo</h2>
            </div>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void runSigningDemo()}
              disabled={busy}
              aria-busy={busy}
            >
              <Play size={14} aria-hidden="true" />
              {busy ? "Signing…" : "Run signing demo"}
            </button>
          </div>
          <div className={styles.sectionBody}>
            <p>
              Generates ephemeral Ed25519 key pairs for owner and risk, signs a demo approval
              payload, and verifies both signatures in-browser. This is not{" "}
              <code>approvalSigningPayload</code> / <code>evaluateActionAuthorization</code> —
              those require node:crypto and stay on MCP/CLI.
            </p>

            {signing ? (
              <div className={styles.signingResult} aria-label="Signing demo result">
                <div className={styles.metaChips}>
                  <span className={signing.allSignaturesValid ? styles.okChip : styles.failChip}>
                    {signing.allSignaturesValid ? (
                      <>
                        <ShieldCheck size={12} aria-hidden="true" /> all signatures valid
                      </>
                    ) : (
                      <>
                        <ShieldAlert size={12} aria-hidden="true" /> signature failure
                      </>
                    )}
                  </span>
                  <span>{signing.theaterLabel}</span>
                </div>
                <ul className={styles.roleList} aria-label="Demo role keys">
                  {signing.roles.map((role) => (
                    <li key={role.role}>
                      <KeyRound size={14} aria-hidden="true" />
                      <div>
                        <strong>{role.role}</strong>
                        <code>{role.approverId}</code>
                        <span>fp={role.keyFingerprintSha256.slice(0, 16)}…</span>
                        <span>sig={signing.signaturesBase64[role.role].slice(0, 20)}…</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className={styles.empty}>No signing demo run yet.</p>
            )}

            <ul className={styles.honestyList} aria-label="Gateway theater limitations">
              {GATEWAY_THEATER_LIMITATIONS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <p className={styles.statusNote} role="status" aria-live="polite">
        {statusNote}
      </p>

      <footer className={styles.footer}>
        <span>Process control evidence · not trading performance · not certification</span>
        <div>
          <Link href="/session">Session</Link>
          <Link href="/theater">Process Theater</Link>
          <Link href="/mcp">MCP</Link>
          <Link href="/control-room">Control Room</Link>
        </div>
      </footer>
    </main>
  );
}
