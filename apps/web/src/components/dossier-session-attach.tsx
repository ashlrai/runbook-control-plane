"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import {
  browserSessionStore,
  buildDossierStatusSnapshotAttachment,
  type ControlPlaneSession,
} from "../lib/control-plane-session";
import styles from "./dossier-session-attach.module.css";

/**
 * Attach the honest dossier status snapshot to a browser Control Plane Session.
 * Architecture evidence only — not certification.
 */
export function DossierSessionAttach() {
  const [sessions, setSessions] = useState<ControlPlaneSession[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [status, setStatus] = useState(
    "Select a local session to attach this architecture-evidence snapshot.",
  );
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    const list = browserSessionStore.list();
    setSessions(list);
    setSessionId((current) => {
      if (current && list.some((s) => s.sessionId === current)) return current;
      return list[0]?.sessionId ?? "";
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onAttach = useCallback(async () => {
    if (!sessionId) {
      setStatus("Create a session on /session first, then return here to attach.");
      return;
    }
    setBusy(true);
    try {
      const next = await browserSessionStore.attachDossier(
        sessionId,
        buildDossierStatusSnapshotAttachment(),
      );
      setStatus(
        `Attached status snapshot to ${next.sessionId} · ${next.dossierAttachments.length} attachment(s) · architecture evidence, not certification`,
      );
      refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Attach failed.");
    } finally {
      setBusy(false);
    }
  }, [sessionId, refresh]);

  return (
    <section className={styles.panel} aria-labelledby="dossier-attach-title">
      <div className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Control Plane Session</p>
          <h2 id="dossier-attach-title">Attach to session</h2>
        </div>
        <span className={styles.badge}>ARCHITECTURE EVIDENCE · NOT CERTIFICATION</span>
      </div>
      <div className={styles.body}>
        <p>
          Bind this dossier status board (5 process-bridged · 1 host-only · 25 unrun) to a local
          browser Control Plane Session as a status-snapshot attachment. This does not certify an
          agent, create a composite safety score, or establish broker authorization.
        </p>
        {sessions.length === 0 ? (
          <p className={styles.empty}>
            No local sessions found. Open{" "}
            <a href="/session">/session</a> to create one (elite or weak charter seed), then return
            here.
          </p>
        ) : (
          <label className={styles.label}>
            Session
            <select
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              aria-label="Session id to attach dossier snapshot"
            >
              {sessions.map((session) => (
                <option key={session.sessionId} value={session.sessionId}>
                  {session.label} · {session.sessionId}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className={styles.actions}>
          <button type="button" onClick={() => void onAttach()} disabled={busy || !sessionId}>
            <Link2 size={14} aria-hidden="true" />
            Attach status snapshot
          </button>
          <a href="/session">Open Session dashboard</a>
        </div>
        <p className={styles.status} aria-live="polite">
          {status}
        </p>
      </div>
    </section>
  );
}
