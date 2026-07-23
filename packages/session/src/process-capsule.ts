/**
 * Build synthetic Proof Capsule payload members from a session evidence pack.
 * Process claims only — never returns / capital / certification.
 */

import type { SessionEvidencePack } from "./types.js";

export type ProcessCapsulePayloadDraft = {
  path:
    | "payload/charter.json"
    | "payload/claims.json"
    | "payload/disclosures.json"
    | "payload/events.ndjson"
    | "payload/report.html"
    | "payload/session-evidence-pack.json";
  role:
    | "charter"
    | "claims"
    | "disclosures"
    | "events"
    | "report"
    | "evidence-projection";
  mediaType: string;
  bytes: Uint8Array;
};

const utf8 = new TextEncoder();

function jsonBytes(value: unknown): Uint8Array {
  return utf8.encode(`${JSON.stringify(value)}\n`);
}

const DISCLOSURES = {
  dataClass: "synthetic" as const,
  schemaVersion: "runbook.control-plane-disclosures.v1",
  limitations: [
    "self-asserted-author-key-integrity-only",
    "not-broker-authorization",
    "not-trading-performance",
    "not-capital-allocation",
    "no-composite-safety-score",
    "advisory-not-hard-gateway",
    "process-evidence-only",
    "host-may-bypass-runbook",
  ],
  capitalAtRisk: 0,
  brokerEffect: false,
  compositeScore: false,
};

/**
 * Map a session evidence pack into ordered capsule payloads (required + optional projection).
 * Paths must be ASCII-sorted for capsule-author.
 */
export function buildProcessCapsulePayloads(pack: SessionEvidencePack): ProcessCapsulePayloadDraft[] {
  const session = pack.session;
  const charter = session.charter ?? {
    capitalBudget: 0,
    cashReserve: 0,
    maxPositionPercent: 0,
    maxOrderNotional: 0,
    maxDrawdownPercent: 0,
    maxDailyTrades: 0,
    allowedInstruments: ["equity"],
    allowedSymbols: [],
    deniedSymbols: [],
    approvalRequired: true,
  };

  const claims = {
    schemaVersion: "runbook.control-plane-claims.v1",
    dataClass: "synthetic",
    sessionId: session.sessionId,
    charterDigest: session.charterDigest ?? null,
    inventoryPinToolSetSha256: session.inventoryPin?.toolSetSha256 ?? null,
    inventoryEnforcement: session.inventoryEnforcement,
    charterBindingEnforcement: session.charterBindingEnforcement,
    lastShadowHardFalseAllows: session.lastShadowHardFalseAllows ?? null,
    lastShadowHardFalseDenies: session.lastShadowHardFalseDenies ?? null,
    shadowGenerationCount: session.shadowGenerations.length,
    capitalAtRisk: 0,
    brokerEffect: false,
    compositeScore: false,
    notTradingPerformance: true,
    claims: [
      "session-exported-as-process-evidence",
      "not-a-safety-certification",
      "not-broker-issued",
    ],
  };

  const eventsLines = [
    JSON.stringify({
      type: "session.exported",
      sessionId: session.sessionId,
      exportedAt: pack.exportedAt,
      capitalAtRisk: 0,
      brokerEffect: false,
    }),
    ...session.shadowGenerations.map((g) =>
      JSON.stringify({
        type: "shadow.generation",
        generation: g.generation,
        hardFalseAllows: g.hardFalseAllows,
        hardFalseDenies: g.hardFalseDenies,
        recordedAt: g.recordedAt,
      }),
    ),
    ...session.notes.slice(-10).map((note, i) =>
      JSON.stringify({ type: "session.note", index: i, note }),
    ),
  ];

  const reportHtml = `<!doctype html><html><head><meta charset="utf-8"/><title>Runbook process capsule</title></head><body>
<h1>Runbook control-plane process evidence</h1>
<p>Session <code>${escapeHtml(session.sessionId)}</code> · synthetic process evidence only.</p>
<ul>
<li>capitalAtRisk: 0</li>
<li>brokerEffect: false</li>
<li>compositeScore: false</li>
<li>notTradingPerformance: true</li>
<li>charterDigest: ${escapeHtml(session.charterDigest ?? "none")}</li>
<li>inventory pin: ${session.inventoryPin ? escapeHtml(session.inventoryPin.toolSetSha256) : "none"}</li>
<li>shadow HFA: ${session.lastShadowHardFalseAllows ?? "—"} · HFD: ${session.lastShadowHardFalseDenies ?? "—"}</li>
</ul>
<p>Limitations: advisory not hard gateway · self-asserted author key only · host may bypass Runbook.</p>
</body></html>`;

  // Required paths first in ASCII path order for authoring.
  const members: ProcessCapsulePayloadDraft[] = [
    {
      path: "payload/charter.json",
      role: "charter",
      mediaType: "application/json",
      bytes: jsonBytes({ dataClass: "synthetic", policy: charter }),
    },
    {
      path: "payload/claims.json",
      role: "claims",
      mediaType: "application/json",
      bytes: jsonBytes(claims),
    },
    {
      path: "payload/disclosures.json",
      role: "disclosures",
      mediaType: "application/json",
      bytes: jsonBytes(DISCLOSURES),
    },
    {
      path: "payload/events.ndjson",
      role: "events",
      mediaType: "application/x-ndjson",
      bytes: utf8.encode(eventsLines.join("\n") + (eventsLines.length ? "\n" : "")),
    },
    {
      path: "payload/report.html",
      role: "report",
      mediaType: "text/html;charset=utf-8",
      bytes: utf8.encode(reportHtml),
    },
    {
      path: "payload/session-evidence-pack.json",
      role: "evidence-projection",
      mediaType: "application/json",
      bytes: jsonBytes(pack),
    },
  ];

  return members.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function processCapsuleExperimentId(sessionId: string): string {
  const cleaned = sessionId.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 80);
  return `CPS-SEAL-${cleaned || "SESSION"}`;
}
