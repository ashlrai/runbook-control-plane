"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileJson2,
  Fingerprint,
  LockKeyhole,
  ShieldAlert,
} from "lucide-react";
import { AppShell } from "./app-shell";
import { fingerprintPayload, importEventSchema, publicSnapshotSchema } from "@/lib/runbook";
import { saveExperimentDraft } from "@/lib/local-store";

type SaveState = "idle" | "saving" | "saved" | "error";

const sampleImport = JSON.stringify(
  {
    schemaVersion: "runbook.event.v1",
    source: "robinhood-mcp",
    recordedAt: "2026-07-21T14:42:00.000Z",
    accountAlias: "Mason Agentic",
    event: {
      type: "fill",
      symbol: "VTI",
      side: "buy",
      quantity: 0.31,
      notional: 100,
      brokerEventId: "redacted-demo-id",
      note: "Imported from the account owner's MCP session.",
    },
  },
  null,
  2,
);

export function ExperimentBuilder() {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [budget, setBudget] = useState(500);
  const [reserve, setReserve] = useState(125);
  const [positionCap, setPositionCap] = useState(25);
  const [drawdown, setDrawdown] = useState(8);
  const [importText, setImportText] = useState(sampleImport);
  const [importResult, setImportResult] = useState<{ ok: boolean; message: string } | null>(null);
  const validationGeneration = useRef(0);

  async function saveExperiment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      schemaVersion: 1,
      name: new FormData(event.currentTarget).get("name"),
      budget,
      reserve,
      positionCap,
      drawdown,
      approvalRequired: true,
      instruments: ["equity"],
      savedAt: new Date().toISOString(),
    };
    setSaveState("saving");
    try {
      await saveExperimentDraft("primary", payload);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  async function validateImport() {
    const sourceText = importText;
    const generation = ++validationGeneration.current;
    try {
      const parsedJson: unknown = JSON.parse(sourceText);
      const isPublicSnapshot =
        typeof parsedJson === "object" &&
        parsedJson !== null &&
        "schemaVersion" in parsedJson &&
        parsedJson.schemaVersion === "runbook.public-snapshot.v1";
      const eventCount = isPublicSnapshot
        ? publicSnapshotSchema.parse(parsedJson).events.length
        : (importEventSchema.parse(parsedJson), undefined);
      const fingerprint = await fingerprintPayload(sourceText);
      if (generation !== validationGeneration.current || sourceText !== importText) return;
      setImportResult({
        ok: true,
        message: `${eventCount === undefined ? "Event schema valid" : `${eventCount} metadata events`} · source SHA-256 ${fingerprint.slice(0, 12)}…`,
      });
    } catch (error) {
      if (generation !== validationGeneration.current || sourceText !== importText) return;
      const message = error instanceof Error ? error.message : "Invalid import payload";
      setImportResult({ ok: false, message: message.slice(0, 180) });
    }
  }

  const available = Math.max(0, budget - reserve);
  const maxPosition = budget * (positionCap / 100);

  return (
    <AppShell>
      <header className="topbar builder-topbar">
        <div>
          <Link className="back-link" href="/control-room"><ArrowLeft size={15} /> Control Room</Link>
          <h1>Charter a new experiment</h1>
          <p>Set the boundaries before you know the outcome.</p>
        </div>
      </header>

      <div className="builder-grid">
        <form className="charter-form" onSubmit={saveExperiment}>
          <section>
            <div className="section-number">01</div>
            <div className="form-section-body">
              <span className="eyebrow">Identity</span>
              <h2>Name the question, not the promised result</h2>
              <label>
                Experiment name
                <input name="name" defaultValue="Approval-gated broad market baseline" required maxLength={80} />
              </label>
              <label>
                Falsifiable question
                <textarea name="question" defaultValue="Does an approval-gated research agent add decision quality relative to a simple VTI control over 30 days?" required maxLength={280} />
              </label>
              <div className="field-row">
                <label>Benchmark<input name="benchmark" defaultValue="VTI" required maxLength={12} /></label>
                <label>Observation window<select name="window" defaultValue="30"><option value="14">14 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label>
              </div>
            </div>
          </section>

          <section>
            <div className="section-number">02</div>
            <div className="form-section-body">
              <span className="eyebrow">Capital envelope</span>
              <h2>Decide what the agent cannot touch</h2>
              <div className="field-row">
                <label>Experiment budget, USD<input type="number" min="25" max="3500" step="25" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /></label>
                <label>Protected reserve, USD<input type="number" min="0" max={budget} step="25" value={reserve} onChange={(event) => setReserve(Number(event.target.value))} /></label>
              </div>
              <div className="range-field">
                <div><label htmlFor="position-cap">Maximum position</label><strong>{positionCap}% · ${maxPosition.toFixed(0)}</strong></div>
                <input id="position-cap" type="range" min="5" max="50" step="5" value={positionCap} onChange={(event) => setPositionCap(Number(event.target.value))} />
              </div>
              <div className="range-field stop-range">
                <div><label htmlFor="drawdown-stop">Hard drawdown stop</label><strong>{drawdown}% · ${(budget * drawdown / 100).toFixed(0)} at risk</strong></div>
                <input id="drawdown-stop" type="range" min="2" max="20" step="1" value={drawdown} onChange={(event) => setDrawdown(Number(event.target.value))} />
              </div>
            </div>
          </section>

          <section>
            <div className="section-number">03</div>
            <div className="form-section-body">
              <span className="eyebrow">Permissions</span>
              <h2>Start with the narrowest useful mandate</h2>
              <div className="permission-grid">
                <label className="choice is-selected"><input type="checkbox" defaultChecked /> <span><Check size={14} /> Long equities</span><em>Allowed</em></label>
                <label className="choice"><input type="checkbox" disabled /> <span>Options</span><em>Blocked for pilot</em></label>
                <label className="choice"><input type="checkbox" disabled /> <span>Crypto</span><em>Not yet available</em></label>
                <label className="choice is-selected"><input type="checkbox" defaultChecked /> <span><Check size={14} /> Human approval</span><em>Required every time</em></label>
              </div>
              <div className="warning-note"><ShieldAlert size={18} /><span>Runbook preflight is advisory until every broker order is forced through a policy gateway. Keep direct execution approval on.</span></div>
            </div>
          </section>

          <div className="form-actions">
            <div><LockKeyhole size={14} /> Saved locally on this device</div>
            <button className="button primary" type="submit" disabled={saveState === "saving"}>{saveState === "saved" ? "Charter saved" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Retry local save" : "Save local charter"}{saveState === "saved" ? <Check size={15} /> : <ChevronRight size={15} />}</button>
          </div>
        </form>

        <aside className="builder-side">
          <section className="budget-summary">
            <span className="eyebrow">Live envelope</span>
            <h2>${budget.toLocaleString()} total</h2>
            <div><span>Protected reserve</span><strong>${reserve.toLocaleString()}</strong></div>
            <div><span>Agent-deployable</span><strong>${available.toLocaleString()}</strong></div>
            <div><span>One-position ceiling</span><strong>${maxPosition.toFixed(0)}</strong></div>
            <div className="summary-stop"><span>Hard loss stop</span><strong>−${(budget * drawdown / 100).toFixed(0)}</strong></div>
          </section>

          <section className="import-panel">
            <div className="module-heading"><div><span className="eyebrow">Owned-data bridge</span><h2>Validate an event</h2></div><FileJson2 size={20} /></div>
            <p>Paste an owned event or metadata-only snapshot from the local Runbook CLI. No credentials or Robinhood Social data.</p>
            <textarea aria-label="Runbook event JSON" value={importText} onChange={(event) => { validationGeneration.current += 1; setImportText(event.target.value); setImportResult(null); }} spellCheck={false} />
            <button className="button ghost" type="button" onClick={validateImport}><Fingerprint size={15} /> Validate & fingerprint</button>
            {importResult ? <div className={`import-result ${importResult.ok ? "is-valid" : "is-invalid"}`}>{importResult.ok ? <Check size={14} /> : <ShieldAlert size={14} />}<span>{importResult.message}</span></div> : null}
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
