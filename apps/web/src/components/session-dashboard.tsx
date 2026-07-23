"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  Layers3,
  Link2,
  LockKeyhole,
  Pin,
  Plus,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import {
  browserSessionStore,
  buildDossierStatusSnapshotAttachment,
  buildPublicDocsInventoryPin,
  checkObservedToolsAgainstPin,
  downloadEvidencePack,
  ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES,
  SAMPLE_OBSERVED_TOOLS_WITH_UNKNOWN,
  type CharterSeedKind,
  type ControlPlaneSession,
  type InventoryCheckResult,
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
  }, [refresh]);

  const selected = useMemo(
    () => sessions.find((s) => s.sessionId === selectedId) ?? null,
    [sessions, selectedId],
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
      const result = await checkObservedToolsAgainstPin(
        selected.inventoryPin,
        SAMPLE_OBSERVED_TOOLS_WITH_UNKNOWN,
        selected.inventoryEnforcement,
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
          <Link href="/shadow-lab">Shadow Lab</Link>
          <Link href="/control-room">Control Room</Link>
          <Link href="/dossier">Dossier</Link>
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
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => void exportPack()}
                    disabled={busy}
                  >
                    <Download size={14} aria-hidden="true" />
                    Export evidence pack
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
              </div>

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
        <Link className={styles.linkCard} href="/shadow-lab">
          <strong>Shadow Lab</strong>
          <span>Recursive refine · tournament · meta-curriculum</span>
        </Link>
        <Link className={styles.linkCard} href="/control-room">
          <strong>Control Room</strong>
          <span>Real engine preflight · advisory tickets</span>
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
          <span>Local companion · shared session spine</span>
        </Link>
      </section>
    </main>
  );
}
