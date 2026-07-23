"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  FileJson,
  GitFork,
  Layers3,
  Link2,
  LockKeyhole,
  Pin,
  Plus,
  Radio,
  Repeat2,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Upload,
} from "lucide-react";
import {
  parseSessionEvidencePack,
  sessionFromEvidencePack,
  SessionPackImportError,
} from "@runbook/session/pack-import";
import { buildProcessCapsulePayloads } from "@runbook/session/process-capsule";
import {
  applyChallengeMutation,
  buildCloneChallengeReceipt,
  CHALLENGE_MUTATIONS,
  type ChallengeMutationId,
} from "@runbook/session/clone-challenge";
import { BrandMark } from "./brand-mark";
import {
  browserSessionStore,
  buildDossierStatusSnapshotAttachment,
  buildPublicDocsInventoryPin,
  checkObservedToolsAgainstPin,
  demoCharterDualEval,
  downloadEvidencePack,
  importToolsListAgainstPin,
  parseSessionIdQuery,
  refineCharterIntoSession,
  ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES,
  SAMPLE_OBSERVED_TOOLS_WITH_UNKNOWN,
  SAMPLE_TOOLS_LIST_JSON,
  shadowLabHrefForSession,
  shadowTrendFromSession,
  type CharterBindingEnforcement,
  type CharterDualEvalResult,
  type CharterSeedKind,
  type ControlPlaneSession,
  type InventoryCheckResult,
  type ToolsListImportResult,
} from "../lib/control-plane-session";
import styles from "./session-dashboard.module.css";

function shortDigest(value: string | undefined): string {
  if (!value) return "—";
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

export function SessionDashboard() {
  const [sessions, setSessions] = useState<ControlPlaneSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [label, setLabel] = useState("Local control plane");
  const [charterSeed, setCharterSeed] = useState<CharterSeedKind>("elite");
  const [statusNote, setStatusNote] = useState("Browser localStorage sessions · not MCP disk store");
  const [inventoryCheck, setInventoryCheck] = useState<InventoryCheckResult | null>(null);
  const [toolsListJson, setToolsListJson] = useState("");
  const [toolsListImport, setToolsListImport] = useState<ToolsListImportResult | null>(null);
  const [dualEval, setDualEval] = useState<
    (CharterDualEvalResult & {
      proposalId: string;
      brokerEffect: false;
      compositeScore: false;
      notTradingPerformance: true;
    }) | null
  >(null);
  const [packJson, setPackJson] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    const list = browserSessionStore.list();
    setSessions(list);
    setSelectedId((current) => {
      if (current && list.some((s) => s.sessionId === current)) return current;
      return list[0]?.sessionId ?? null;
    });
  }, []);

  useEffect(() => {
    refresh();
    if (typeof window === "undefined") return;
    const fromUrl = parseSessionIdQuery(window.location.search);
    if (!fromUrl) return;
    try {
      browserSessionStore.read(fromUrl);
      setSelectedId(fromUrl);
    } catch {
      /* unknown deep link */
    }
  }, [refresh]);

  const selected = useMemo(
    () => sessions.find((s) => s.sessionId === selectedId) ?? null,
    [sessions, selectedId],
  );

  const shadowTrend = useMemo(
    () => (selected ? shadowTrendFromSession(selected) : []),
    [selected],
  );

  const createSession = useCallback(async () => {
    setBusy(true);
    try {
      const session = await browserSessionStore.create({
        label: label.trim() || "Local control plane",
        charterSeed: charterSeed === "none" ? undefined : charterSeed,
      });
      setSelectedId(session.sessionId);
      setInventoryCheck(null);
      setToolsListImport(null);
      setDualEval(null);
      setStatusNote(`Created session ${session.sessionId}`);
      refresh();
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Could not create session.");
    } finally {
      setBusy(false);
    }
  }, [label, charterSeed, refresh]);

  const pinInventory = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const pin = await buildPublicDocsInventoryPin();
      await browserSessionStore.setInventoryPin(selected.sessionId, pin);
      setInventoryCheck(null);
      setToolsListImport(null);
      setStatusNote(
        `Pinned public-docs inventory (${pin.tools.length} tools) · not runtime-confirmed`,
      );
      refresh();
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Could not pin inventory.");
    } finally {
      setBusy(false);
    }
  }, [selected, refresh]);

  const runInventoryCheck = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      // Re-read from store so pin is current even if React selected state is stale.
      const live = browserSessionStore.read(selected.sessionId);
      const result = await checkObservedToolsAgainstPin(
        live.inventoryPin,
        SAMPLE_OBSERVED_TOOLS_WITH_UNKNOWN,
        live.inventoryEnforcement,
      );
      setInventoryCheck(result);
      setStatusNote(result.message);
      refresh();
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Inventory check failed.");
    } finally {
      setBusy(false);
    }
  }, [selected, refresh]);

  const loadSampleToolsList = useCallback(() => {
    setToolsListJson(SAMPLE_TOOLS_LIST_JSON);
    setToolsListImport(null);
    setStatusNote(
      "Loaded sample tools/list JSON (includes place_crypto_order_unknown) · local paste only",
    );
  }, []);

  const onToolsListFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      setToolsListJson(text);
      setToolsListImport(null);
      setStatusNote(`Loaded tools/list file “${file.name}” · local only · never network-fetched`);
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Could not read tools/list file.");
    } finally {
      setBusy(false);
    }
  }, []);

  const importToolsList = useCallback(async () => {
    if (!selected?.inventoryPin) return;
    setBusy(true);
    try {
      const result = await importToolsListAgainstPin({
        toolsJsonText: toolsListJson,
        pin: selected.inventoryPin,
        inventoryEnforcement: selected.inventoryEnforcement,
      });
      setToolsListImport(result);
      setInventoryCheck(result);
      setStatusNote(
        `tools/list import · ${result.toolCount} tools · format=${result.parseFormat} · ${result.message}`,
      );
      refresh();
    } catch (error) {
      setToolsListImport(null);
      setStatusNote(error instanceof Error ? error.message : "tools/list import failed.");
    } finally {
      setBusy(false);
    }
  }, [selected, toolsListJson, refresh]);

  const attachDossier = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await browserSessionStore.attachDossier(
        selected.sessionId,
        buildDossierStatusSnapshotAttachment(),
      );
      setStatusNote(
        "Attached dossier status snapshot · architecture evidence, not certification",
      );
      refresh();
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Could not attach dossier.");
    } finally {
      setBusy(false);
    }
  }, [selected, refresh]);

  const recordDemoShadow = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const gen = (selected.shadowGenerations?.length ?? 0) + 1;
      await browserSessionStore.recordShadowGeneration(selected.sessionId, {
        generation: gen,
        hardFalseAllows: 0,
        hardFalseDenies: 0,
      });
      setStatusNote(
        `Recorded shadow generation ${gen} (demo metrics · not investment skill)`,
      );
      refresh();
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Could not record shadow metrics.");
    } finally {
      setBusy(false);
    }
  }, [selected, refresh]);

  const runRefineIntoSession = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await refineCharterIntoSession({
        sessionId: selected.sessionId,
        maxGenerations: 4,
      });
      const seedNote = result.usedWeakFallback
        ? "weak seed (no prior charter)"
        : "session charter";
      setStatusNote(
        `Refine into session · ${seedNote} · HFA ${result.finalHardFalseAllows} / HFD ${result.finalHardFalseDenies} · ${result.generationsRecorded} gen recorded · charter updated · not investment skill`,
      );
      refresh();
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Refine into session failed.");
    } finally {
      setBusy(false);
    }
  }, [selected, refresh]);

  const cycleCharterBindingEnforcement = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const order: CharterBindingEnforcement[] = ["warn", "fail-closed", "off"];
      const current = selected.charterBindingEnforcement ?? "warn";
      const next = order[(order.indexOf(current) + 1) % order.length]!;
      await browserSessionStore.setCharterBindingEnforcement(selected.sessionId, next);
      setDualEval(null);
      setStatusNote(
        `charterBindingEnforcement → ${next} · process-layer only, not a hard broker gateway`,
      );
      refresh();
    } catch (error) {
      setStatusNote(
        error instanceof Error ? error.message : "Could not set charter binding enforcement.",
      );
    } finally {
      setBusy(false);
    }
  }, [selected, refresh]);

  const runDualEvalDemo = useCallback(() => {
    if (!selected) return;
    try {
      // Re-read so enforcement / charter are live after toggles.
      const live = browserSessionStore.read(selected.sessionId);
      const result = demoCharterDualEval(live);
      setDualEval(result);
      setStatusNote(
        `Dual-eval · binding=${result.sessionCharterBinding} · ledgerAllowed=${String(result.ledgerAllowed)} · processAllowed=${String(result.allowed)} · enforcement=${result.charterBindingEnforcement}`,
      );
    } catch (error) {
      setDualEval(null);
      setStatusNote(error instanceof Error ? error.message : "Dual-eval demo failed.");
    }
  }, [selected]);

  const runCloneChallenge = useCallback(
    async (mutationId: ChallengeMutationId) => {
      if (!selected?.charter) return;
      setBusy(true);
      try {
        const parent = browserSessionStore.read(selected.sessionId);
        if (!parent.charter) {
          throw new Error("Parent session has no charter to clone.");
        }
        const mutation = CHALLENGE_MUTATIONS.find((m) => m.id === mutationId);
        if (!mutation) throw new Error(`Unknown challenge mutation: ${mutationId}`);

        const childCharter = applyChallengeMutation(parent.charter, mutationId);
        const parentDigest = parent.charterDigest ?? null;
        const child = await browserSessionStore.create({
          label: `Challenge: ${mutation.label} ← ${parent.sessionId}`,
          charter: childCharter,
          charterBindingEnforcement: parent.charterBindingEnforcement ?? "warn",
        });

        const digestNote =
          `clone-challenge parentSessionId=${parent.sessionId} ` +
          `parentCharterDigest=${parentDigest ?? "none"} mutation=${mutationId} · ` +
          `process fork only — not safer strategy, not returns`;
        await browserSessionStore.update(child.sessionId, (s) => ({
          ...s,
          notes: [...s.notes, digestNote].slice(-50),
        }));

        const receipt = buildCloneChallengeReceipt({
          parentSessionId: parent.sessionId,
          parentCharterDigest: parentDigest,
          childSessionId: child.sessionId,
          mutationId,
        });

        setSelectedId(child.sessionId);
        setInventoryCheck(null);
        setToolsListImport(null);
        setDualEval(null);
        setStatusNote(
          `Clone & challenge · ${mutation.label} · child=${child.sessionId} · ` +
            `not safer strategy · not returns · receipt=${JSON.stringify({
              schemaVersion: receipt.schemaVersion,
              parentSessionId: receipt.parentSessionId,
              parentCharterDigest: receipt.parentCharterDigest,
              childSessionId: receipt.childSessionId,
              mutationId: receipt.mutationId,
              mutationLabel: receipt.mutationLabel,
              notTradingPerformance: receipt.notTradingPerformance,
              brokerEffect: receipt.brokerEffect,
              compositeScore: receipt.compositeScore,
              capitalAtRisk: receipt.capitalAtRisk,
            })}`,
        );
        refresh();
      } catch (error) {
        setStatusNote(error instanceof Error ? error.message : "Clone & challenge failed.");
      } finally {
        setBusy(false);
      }
    },
    [selected, refresh],
  );

  const exportPack = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const pack = await browserSessionStore.exportPack(selected.sessionId);
      downloadEvidencePack(pack);
      setStatusNote(`Exported evidence pack for ${selected.sessionId} · local download only`);
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }, [selected]);

  const importEvidencePack = useCallback(async () => {
    setBusy(true);
    try {
      const pack = parseSessionEvidencePack(packJson);
      // Re-key so paste demos do not clobber an existing sessionId row.
      const imported = sessionFromEvidencePack(pack, {
        sessionId: `CPS-IMP-${Date.now().toString(36).toUpperCase()}`,
      });
      await browserSessionStore.write({
        ...imported,
        capitalAtRisk: 0,
        brokerEffect: false,
        compositeScore: false,
        purpose: "control-plane-process-evidence",
      });
      setSelectedId(imported.sessionId);
      setInventoryCheck(null);
      setToolsListImport(null);
      setDualEval(null);
      setStatusNote(
        `Imported evidence pack → ${imported.sessionId} · local paste only · never network-fetched · not a hard gateway`,
      );
      refresh();
    } catch (error) {
      const message =
        error instanceof SessionPackImportError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Pack import failed.";
      setStatusNote(message);
    } finally {
      setBusy(false);
    }
  }, [packJson, refresh]);

  const exportProcessClaims = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const pack = await browserSessionStore.exportPack(selected.sessionId);
      const members = buildProcessCapsulePayloads(pack);
      const claimsMember = members.find((m) => m.path === "payload/claims.json");
      if (!claimsMember) {
        throw new Error("Process capsule payloads missing payload/claims.json.");
      }
      const text = new TextDecoder().decode(claimsMember.bytes);
      const blob = new Blob([text.endsWith("\n") ? text : `${text}\n`], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `runbook-process-claims-${selected.sessionId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatusNote(
        `Exported process claims JSON for ${selected.sessionId} · verify path helper · seal via MCP runbook_session_seal_capsule (browser has no capsule-author)`,
      );
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Claims export failed.");
    } finally {
      setBusy(false);
    }
  }, [selected]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Runbook home">
          <BrandMark />
          <span>Runbook</span>
          <em>Session</em>
        </Link>
        <nav className={styles.headerNav} aria-label="Session navigation">
          <Link href="/">Product map</Link>
          <Link href="/theater">Theater</Link>
          <Link href="/shadow-lab">Shadow Lab</Link>
          <Link href="/control-room">Control Room</Link>
          <Link href="/verify">Verify</Link>
          <Link href="/mcp">MCP</Link>
        </nav>
      </header>

      <div className={styles.truthRail} role="note" aria-label="Session honesty boundary">
        <span>LOCAL PROCESS EVIDENCE</span>
        <span>NOT HARD GATEWAY</span>
        <span>NO COMPOSITE SAFETY SCORE</span>
        <span>NO LIVE CAPITAL</span>
        <span>BROWSER LOCALSTORAGE ONLY</span>
      </div>

      <section className={styles.hero} aria-labelledby="session-title">
        <div>
          <p className={styles.eyebrow}>Control Plane Session · shared spine</p>
          <h1 id="session-title">Bind charter, inventory, shadow, and dossier evidence.</h1>
          <p className={styles.lede}>
            Create a local Control Plane Session that pins a public-docs tool inventory, holds
            charter digests, records shadow-generation summaries, and attaches honest dossier
            status snapshots. Fail-closed inventory checks reject unknown tools. This is process
            evidence in the browser — not broker authorization and not certification.
          </p>
        </div>
        <aside className={styles.boundary} aria-label="Session boundary">
          <div className={styles.boundaryHead}>
            <span>BOUNDARY</span>
            <strong>ALWAYS TRUE</strong>
          </div>
          <ul>
            <li>
              <LockKeyhole size={13} aria-hidden="true" /> Sessions stay in browser localStorage
              (`runbook.control-plane-sessions.v1`). Not the MCP disk store.
            </li>
            <li>
              <ShieldAlert size={13} aria-hidden="true" /> Inventory pin is public-docs projection —
              not runtime-confirmed broker inventory.
            </li>
            <li>
              <ShieldCheck size={13} aria-hidden="true" /> capitalAtRisk=0 · brokerEffect=false ·
              compositeScore=false on every session and export pack.
            </li>
            <li>
              Dossier attachments are architecture evidence labels only — never buyer-ready
              certification.
            </li>
          </ul>
        </aside>
      </section>

      <div className={styles.layout}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>Create</p>
              <h2>New session</h2>
            </div>
          </div>
          <div className={styles.formStack}>
            <label>
              Label
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={200}
                aria-label="Session label"
              />
            </label>
            <label>
              Charter seed
              <select
                value={charterSeed}
                onChange={(event) => setCharterSeed(event.target.value as CharterSeedKind)}
                aria-label="Charter seed policy"
              >
                <option value="elite">Elite equity (shadow-lab reference)</option>
                <option value="weak">Weak starter (shadow-lab seed)</option>
                <option value="none">No charter</option>
              </select>
            </label>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void createSession()}
              disabled={busy}
            >
              <Plus size={14} aria-hidden="true" />
              Create session
            </button>
          </div>

          <div className={styles.importBlock} aria-label="Session evidence pack import" style={{ margin: "0 18px 16px" }}>
            <div className={styles.importHead}>
              <FileJson size={14} aria-hidden="true" />
              <strong>Import evidence pack JSON</strong>
              <span>@runbook/session/pack-import · local paste only</span>
            </div>
            <p style={{ margin: 0, color: "var(--sd-muted)", fontSize: 11, lineHeight: 1.45 }}>
              Paste a <code>runbook.session-evidence-pack.v1</code> export. Pure pack-import (no
              node:fs). Refuses URL fetch. Re-keys sessionId on import so existing rows are not
              clobbered.
            </p>
            <label className={styles.importLabel}>
              Evidence pack JSON
              <textarea
                className={styles.toolsListTextarea}
                value={packJson}
                onChange={(event) => setPackJson(event.target.value)}
                spellCheck={false}
                rows={6}
                placeholder='{"schemaVersion":"runbook.session-evidence-pack.v1",…}'
                aria-label="Session evidence pack JSON paste area"
              />
            </label>
            <div className={styles.actions} style={{ padding: 0 }}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => void importEvidencePack()}
                disabled={busy || packJson.trim().length === 0}
              >
                <Upload size={14} aria-hidden="true" />
                Import pack into local store
              </button>
            </div>
          </div>

          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>Local store</p>
              <h2>Sessions</h2>
            </div>
          </div>
          {sessions.length === 0 ? (
            <p className={styles.empty}>
              No sessions yet. Create one to pin inventory and attach dossier evidence.
            </p>
          ) : (
            <div className={styles.sessionList} role="listbox" aria-label="Saved sessions">
              {sessions.map((session) => (
                <button
                  key={session.sessionId}
                  type="button"
                  className={styles.sessionItem}
                  data-active={session.sessionId === selectedId}
                  role="option"
                  aria-selected={session.sessionId === selectedId}
                  onClick={() => {
                    setSelectedId(session.sessionId);
                    setInventoryCheck(null);
                    setToolsListImport(null);
                  }}
                >
                  <strong>{session.label}</strong>
                  <code>{session.sessionId}</code>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.detail}>
          {!selected ? (
            <div className={styles.panel}>
              <p className={styles.empty}>
                Select or create a session to inspect charter digest, inventory pin, shadow
                metrics, and dossier attachments.
              </p>
            </div>
          ) : (
            <>
              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <p className={styles.eyebrow}>Active session</p>
                    <h2>{selected.label}</h2>
                  </div>
                  <code className={styles.mono}>{selected.sessionId}</code>
                </div>
                <p className={styles.statusNote}>{statusNote}</p>
                <div className={styles.metrics} aria-label="Session metrics">
                  <div className={styles.metric}>
                    <span>Charter digest</span>
                    <strong title={selected.charterDigest}>{shortDigest(selected.charterDigest)}</strong>
                    <em>{selected.charter ? "Bound" : "None"}</em>
                  </div>
                  <div className={styles.metric}>
                    <span>Inventory pin</span>
                    <strong>
                      {selected.inventoryPin
                        ? `${selected.inventoryPin.tools.length} tools`
                        : "Unpinned"}
                    </strong>
                    <em>
                      {selected.inventoryPin?.admitted ? "Admitted public-docs" : "Not pinned"}
                    </em>
                  </div>
                  <div className={styles.metric}>
                    <span>Shadow metrics</span>
                    <strong>
                      HFA {selected.lastShadowHardFalseAllows ?? "—"} · HFD{" "}
                      {selected.lastShadowHardFalseDenies ?? "—"}
                    </strong>
                    <em>{selected.shadowGenerations.length} generation(s)</em>
                  </div>
                  <div className={styles.metric}>
                    <span>Dossier attachments</span>
                    <strong>{selected.dossierAttachments.length}</strong>
                    <em>architecture evidence only</em>
                  </div>
                  <div className={styles.metric} aria-label="Charter binding enforcement">
                    <span>Charter binding</span>
                    <strong>{selected.charterBindingEnforcement ?? "warn"}</strong>
                    <em>dual-eval · not broker gateway</em>
                  </div>
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => void runRefineIntoSession()}
                    disabled={busy}
                  >
                    <Repeat2 size={14} aria-hidden="true" />
                    Run refine into session
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => void cycleCharterBindingEnforcement()}
                    disabled={busy}
                  >
                    <LockKeyhole size={14} aria-hidden="true" />
                    Cycle charter binding
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => runDualEvalDemo()}
                    disabled={busy || !selected.charter}
                  >
                    <ShieldCheck size={14} aria-hidden="true" />
                    Dual-eval option probe
                  </button>
                  <Link
                    className={styles.ghostBtn}
                    href={shadowLabHrefForSession(selected.sessionId)}
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    Open in Shadow Lab
                  </Link>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => void exportPack()}
                    disabled={busy}
                  >
                    <Download size={14} aria-hidden="true" />
                    Export evidence pack
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => void exportProcessClaims()}
                    disabled={busy}
                  >
                    <FileJson size={14} aria-hidden="true" />
                    Export process claims JSON
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => void recordDemoShadow()}
                    disabled={busy}
                  >
                    <Radio size={14} aria-hidden="true" />
                    Record demo shadow gen
                  </button>
                </div>
                <p className={styles.sealNote} aria-label="Seal capsule note">
                  Browser cannot seal a signed Proof Capsule (needs capsule-author + key material).
                  Export process claims JSON for the verify path, or seal via MCP{" "}
                  <code>runbook_session_seal_capsule</code>. Process claims only — not returns, not
                  certification.
                </p>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <p className={styles.eyebrow}>Shadow Lab · live trend</p>
                    <h2>HFA / HFD from session.shadowGenerations</h2>
                  </div>
                  <span className={styles.mono} style={{ padding: "6px 8px" }}>
                    {shadowTrend.length} point(s)
                  </span>
                </div>
                <div className={styles.sectionBody}>
                  <p>
                    Process-control metrics only — hardFalseAllows / hardFalseDenies from refine
                    loops bound to this session. Not trading performance. Not a composite score.
                  </p>
                  {shadowTrend.length === 0 ? (
                    <p className={styles.empty} style={{ padding: 0 }}>
                      No shadow generations yet. Run refine into session, open Shadow Lab with this
                      session bound, or record a demo generation.
                    </p>
                  ) : (
                    <div
                      className={styles.trendList}
                      role="list"
                      aria-label="Shadow HFA HFD trend"
                    >
                      {shadowTrend.map((row) => {
                        const clean =
                          row.hardFalseAllows === 0 && row.hardFalseDenies === 0;
                        return (
                          <div
                            key={`${row.generation}-${row.recordedAt}`}
                            className={styles.trendRow}
                            role="listitem"
                            data-clean={clean ? "true" : "false"}
                          >
                            <strong>G{row.generation}</strong>
                            <span>
                              HFA <em>{row.hardFalseAllows}</em>
                            </span>
                            <span>
                              HFD <em>{row.hardFalseDenies}</em>
                            </span>
                            <code>{row.recordedAt}</code>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {dualEval ? (
                <div className={styles.panel} aria-label="Charter dual-eval result">
                  <div className={styles.panelHead}>
                    <div>
                      <p className={styles.eyebrow}>Charter dual-eval</p>
                      <h2>Ledger vs session · process layer</h2>
                    </div>
                    <code className={styles.mono} style={{ padding: "6px 8px" }}>
                      {dualEval.sessionCharterBinding}
                    </code>
                  </div>
                  <div className={styles.sectionBody}>
                    <p>
                      Weak ledger charter allows options; session charter (elite/refined) typically
                      denies. Under <code>fail-closed</code>, process <code>allowed</code> becomes
                      false while <code>ledgerAllowed</code> stays true. Still not a hard broker
                      gateway.
                    </p>
                    <div
                      className={styles.checkResult}
                      data-ok={!dualEval.processDeniedBySession && dualEval.allowed}
                      aria-live="polite"
                    >
                      <strong>
                        {dualEval.processDeniedBySession
                          ? "PROCESS DENY (session)"
                          : dualEval.allowed
                            ? "PROCESS ALLOW"
                            : "PROCESS DENY"}
                      </strong>
                      <span>
                        ledgerAllowed={String(dualEval.ledgerAllowed)} · sessionPolicyAllowed=
                        {String(dualEval.sessionPolicyAllowed)} · processAllowed=
                        {String(dualEval.allowed)} · enforcement=
                        {dualEval.charterBindingEnforcement}
                      </span>
                      <span>
                        binding={dualEval.sessionCharterBinding} · processDeniedBySession=
                        {String(dualEval.processDeniedBySession)} · brokerEffect=false ·
                        compositeScore=false
                      </span>
                      {dualEval.warningSuffix ? (
                        <code className={styles.mono}>{dualEval.warningSuffix.trim()}</code>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {selected.charter ? (
                <div className={styles.panel} aria-label="Clone and challenge">
                  <div className={styles.panelHead}>
                    <div>
                      <p className={styles.eyebrow}>Process fork</p>
                      <h2>Clone &amp; challenge</h2>
                    </div>
                    <span className={styles.mono} style={{ padding: "6px 8px" }}>
                      one-rule mutations
                    </span>
                  </div>
                  <div className={styles.sectionBody}>
                    <p>
                      Fork this session&apos;s charter with a single process-rule mutation. Child
                      inherits binding enforcement and notes the parent digest. This is{" "}
                      <strong>not</strong> a safer strategy claim and <strong>not</strong> returns —
                      lineage is digest binding only.
                    </p>
                    <div
                      className={styles.challengeGrid}
                      role="group"
                      aria-label="Challenge mutations"
                    >
                      {CHALLENGE_MUTATIONS.map((mutation) => (
                        <button
                          key={mutation.id}
                          type="button"
                          className={styles.challengeBtn}
                          onClick={() => void runCloneChallenge(mutation.id)}
                          disabled={busy}
                          title={mutation.detail}
                        >
                          <GitFork size={14} aria-hidden="true" />
                          <strong>{mutation.label}</strong>
                          <span>{mutation.detail}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <p className={styles.eyebrow}>Inventory</p>
                    <h2>Public-docs pin · fail-closed check</h2>
                  </div>
                </div>
                <div className={styles.sectionBody}>
                  <p>
                    Pin the closed {ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES.length}-tool public-docs
                    inventory, then check against a sample observed list that intentionally includes{" "}
                    <code>place_crypto_order_unknown</code> to demonstrate fail-closed rejection.
                  </p>
                  {selected.inventoryPin ? (
                    <div className={styles.mono} aria-label="Inventory pin digest">
                      pinId={selected.inventoryPin.pinId}
                      {" · "}
                      toolSetSha256={shortDigest(selected.inventoryPin.toolSetSha256)}
                      {" · "}
                      enforcement={selected.inventoryEnforcement}
                    </div>
                  ) : (
                    <p>No inventory pin yet.</p>
                  )}
                  <div className={styles.actions} style={{ padding: 0 }}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={() => void pinInventory()}
                      disabled={busy}
                    >
                      <Pin size={14} aria-hidden="true" />
                      Pin public-docs inventory (50 tools)
                    </button>
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      onClick={() => void runInventoryCheck()}
                      disabled={busy || !selected.inventoryPin}
                    >
                      <ShieldAlert size={14} aria-hidden="true" />
                      Check sample observed list
                    </button>
                  </div>
                  {inventoryCheck ? (
                    <div
                      className={styles.checkResult}
                      data-ok={inventoryCheck.ok}
                      aria-live="polite"
                    >
                      <strong>{inventoryCheck.ok ? "CHECK OK" : "FAIL-CLOSED"}</strong>
                      <span>{inventoryCheck.message}</span>
                      {inventoryCheck.unknownTools.length > 0 ? (
                        <code className={styles.mono}>
                          unknown: {inventoryCheck.unknownTools.join(", ")}
                        </code>
                      ) : null}
                      <span>
                        brokerEffect={String(inventoryCheck.brokerEffect)} · compositeScore=
                        {String(inventoryCheck.compositeScore)}
                      </span>
                    </div>
                  ) : null}

                  {selected.inventoryPin ? (
                    <div className={styles.importBlock} aria-label="tools/list inventory import">
                      <div className={styles.importHead}>
                        <FileJson size={14} aria-hidden="true" />
                        <strong>Import tools/list JSON</strong>
                        <span>vs pin · enforcement={selected.inventoryEnforcement}</span>
                      </div>
                      <p>
                        Paste MCP tools/list JSON, a <code>{`{tools:[…]}`}</code> name list, or a
                        plain string array. Local paste/file only — never network-fetched. Matches{" "}
                        <code>runbook_session_import_tools_list</code> parse rules (max 200 tools /
                        160-char names).
                      </p>
                      <label className={styles.importLabel}>
                        tools/list JSON
                        <textarea
                          className={styles.toolsListTextarea}
                          value={toolsListJson}
                          onChange={(event) => {
                            setToolsListJson(event.target.value);
                            setToolsListImport(null);
                          }}
                          spellCheck={false}
                          rows={8}
                          placeholder='{"tools":[{"name":"get_accounts"},…]}'
                          aria-label="tools/list JSON paste area"
                        />
                      </label>
                      <label className={styles.importLabel}>
                        Or choose a local file
                        <input
                          type="file"
                          accept="application/json,.json,text/plain"
                          aria-label="tools/list JSON file input"
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null;
                            void onToolsListFile(file);
                            event.target.value = "";
                          }}
                          disabled={busy}
                        />
                      </label>
                      <div className={styles.actions} style={{ padding: 0 }}>
                        <button
                          type="button"
                          className={styles.ghostBtn}
                          onClick={loadSampleToolsList}
                          disabled={busy}
                        >
                          <Upload size={14} aria-hidden="true" />
                          Load sample tools/list
                        </button>
                        <button
                          type="button"
                          className={styles.primaryBtn}
                          onClick={() => void importToolsList()}
                          disabled={busy || toolsListJson.trim().length === 0}
                        >
                          <ShieldAlert size={14} aria-hidden="true" />
                          Import &amp; check against pin
                        </button>
                      </div>
                      {toolsListImport ? (
                        <div
                          className={styles.checkResult}
                          data-ok={toolsListImport.ok}
                          aria-live="polite"
                          aria-label="tools/list import result"
                        >
                          <strong>
                            {toolsListImport.ok ? "IMPORT CHECK OK" : "IMPORT FAIL-CLOSED"}
                          </strong>
                          <span>{toolsListImport.message}</span>
                          <code className={styles.mono}>
                            ok={String(toolsListImport.ok)} · toolCount=
                            {toolsListImport.toolCount} · format={toolsListImport.parseFormat} ·
                            enforcement={toolsListImport.enforcement}
                          </code>
                          {toolsListImport.unknownTools.length > 0 ? (
                            <code className={styles.mono}>
                              unknownTools: {toolsListImport.unknownTools.join(", ")}
                            </code>
                          ) : (
                            <code className={styles.mono}>unknownTools: (none)</code>
                          )}
                          <span>
                            source={toolsListImport.source} · brokerEffect=
                            {String(toolsListImport.brokerEffect)} · compositeScore=
                            {String(toolsListImport.compositeScore)}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <p className={styles.eyebrow}>Dossier</p>
                    <h2>Status snapshot attachments</h2>
                  </div>
                </div>
                <div className={styles.sectionBody}>
                  <p>
                    Attach the honest Pre-Capital dossier status snapshot (5 process-bridged · 1
                    host-only · 25 unrun). Architecture evidence only — not buyer-ready
                    certification.
                  </p>
                  <div className={styles.actions} style={{ padding: 0 }}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={() => void attachDossier()}
                      disabled={busy}
                    >
                      <Link2 size={14} aria-hidden="true" />
                      Attach dossier status snapshot
                    </button>
                  </div>
                  {selected.dossierAttachments.length === 0 ? (
                    <p>No dossier attachments yet.</p>
                  ) : (
                    <div className={styles.attachmentList}>
                      {selected.dossierAttachments.map((attachment) => (
                        <div key={attachment.attachmentId} className={styles.attachment}>
                          <strong>
                            {attachment.kind} · {attachment.honestLabel}
                          </strong>
                          <span>{attachment.summary}</span>
                          <span>
                            {attachment.attachedAt}
                            {attachment.processBridgedCount !== undefined
                              ? ` · processBridgedCount=${attachment.processBridgedCount}`
                              : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <section className={styles.linkStrip} aria-label="Related product surfaces">
        <Link
          className={styles.linkCard}
          href={selected ? shadowLabHrefForSession(selected.sessionId) : "/shadow-lab"}
        >
          <strong>Shadow Lab</strong>
          <span>
            {selected
              ? `Bound deep link · ?sessionId=${selected.sessionId}`
              : "Recursive refine · tournament · meta-curriculum"}
          </span>
        </Link>
        <Link
          className={styles.linkCard}
          href={
            selected
              ? `/control-room?sessionId=${encodeURIComponent(selected.sessionId)}`
              : "/control-room"
          }
        >
          <strong>Control Room</strong>
          <span>Real engine preflight · dual-eval when bound</span>
        </Link>
        <Link className={styles.linkCard} href="/theater">
          <strong>Process Theater</strong>
          <span>Timeline · pin · shadow · dual-eval · HOSTED LAB</span>
        </Link>
        <Link className={styles.linkCard} href="/verify">
          <strong>Capsule verifier</strong>
          <span>Local Worker verify · claims export path</span>
        </Link>
        <Link className={styles.linkCard} href="/dossier">
          <strong>
            <Layers3 size={14} aria-hidden="true" /> Dossier
          </strong>
          <span>31-case architecture board · attach from there too</span>
        </Link>
        <Link className={styles.linkCard} href="/mcp">
          <strong>
            <Terminal size={14} aria-hidden="true" /> MCP
          </strong>
          <span>Local companion · seal via runbook_session_seal_capsule</span>
        </Link>
      </section>
    </main>
  );
}
