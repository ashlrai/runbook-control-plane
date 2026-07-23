/**
 * Browser adapter for Control Plane Session spine.
 *
 * Authority for types/schema shape: `@runbook/session`.
 * SessionStore and canonical digests in that package use node:fs / node:crypto —
 * this module reimplements digests with Web Crypto and persists sessions in
 * localStorage under `runbook.control-plane-sessions.v1`.
 *
 * Local process evidence only. Not a hard broker gateway. Not trading performance.
 * Not composite safety certification.
 */

import type { RiskPolicy } from "@runbook/engine/schema";
import type {
  ControlPlaneSession,
  DossierAttachment,
  InventoryCheckResult,
  InventoryPin,
  InventoryToolEntry,
  SessionEvidencePack,
} from "@runbook/session";
import { REFERENCE_ELITE_POLICY, WEAK_STARTER_POLICY } from "@runbook/shadow-lab";
import { DOSSIER_COUNTS, PROCESS_BRIDGED_IDS } from "./dossier-status-data";

export const BROWSER_SESSION_STORAGE_KEY = "runbook.control-plane-sessions.v1" as const;

export type BrowserSessionBag = {
  schemaVersion: "runbook.control-plane-sessions-bag.v1";
  sessions: Record<string, ControlPlaneSession>;
};

/** Closed public-docs tool names (mirror of @runbook/session inventory). */
export const ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES = Object.freeze([
  "get_accounts",
  "get_portfolio",
  "get_realized_pnl",
  "get_pnl_trade_history",
  "search",
  "get_watchlists",
  "get_watchlist_items",
  "get_option_watchlist",
  "get_popular_watchlists",
  "create_watchlist",
  "update_watchlist",
  "follow_watchlist",
  "unfollow_watchlist",
  "add_to_watchlist",
  "remove_from_watchlist",
  "add_option_to_watchlist",
  "remove_option_from_watchlist",
  "get_equity_historicals",
  "get_equity_fundamentals",
  "get_financials",
  "get_equity_price_book",
  "get_equity_technical_indicators",
  "get_earnings_results",
  "get_earnings_calendar",
  "get_indexes",
  "get_index_quotes",
  "get_equity_positions",
  "get_equity_tax_lots",
  "get_equity_quotes",
  "get_equity_orders",
  "get_equity_tradability",
  "review_equity_order",
  "place_equity_order",
  "cancel_equity_order",
  "get_option_level_upgrade_info",
  "get_option_historicals",
  "get_option_chains",
  "get_option_instruments",
  "get_option_quotes",
  "get_option_positions",
  "get_option_orders",
  "review_option_order",
  "cancel_option_order",
  "place_option_order",
  "get_scans",
  "get_scanner_filter_specs",
  "create_scan",
  "run_scan",
  "update_scan_filters",
  "update_scan_config",
] as const);

/** Sample observed set for fail-closed demo — includes one unknown tool. */
export const SAMPLE_OBSERVED_TOOLS_WITH_UNKNOWN = Object.freeze([
  ...ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES.slice(0, 12),
  "place_crypto_order_unknown",
] as const);

export const SESSION_LIMITATIONS = [
  "advisory-not-hard-gateway",
  "not-trading-performance",
  "not-capital-allocation",
  "no-composite-safety-score",
  "local-session-only",
  "browser-localStorage-not-mcp-disk",
] as const;

export type CharterSeedKind = "elite" | "weak" | "none";

export function elitePolicy(): RiskPolicy {
  return clonePolicy(REFERENCE_ELITE_POLICY);
}

export function weakPolicy(): RiskPolicy {
  return clonePolicy(WEAK_STARTER_POLICY);
}

function clonePolicy(policy: RiskPolicy): RiskPolicy {
  return {
    ...policy,
    allowedInstruments: [...policy.allowedInstruments],
    allowedSymbols: [...policy.allowedSymbols],
    deniedSymbols: [...policy.deniedSymbols],
  };
}

/** Web Crypto SHA-256 hex — browser-safe twin of package `sha256Hex`. */
export async function browserSha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Same normalization as `@runbook/session` `charterDigest`. */
export async function browserCharterDigest(policy: RiskPolicy): Promise<string> {
  const normalized = {
    capitalBudget: policy.capitalBudget,
    cashReserve: policy.cashReserve,
    maxPositionPercent: policy.maxPositionPercent,
    maxOrderNotional: policy.maxOrderNotional,
    maxDrawdownPercent: policy.maxDrawdownPercent,
    maxDailyTrades: policy.maxDailyTrades,
    allowedInstruments: [...policy.allowedInstruments].sort(),
    allowedSymbols: [...policy.allowedSymbols].map((s) => s.toUpperCase()).sort(),
    deniedSymbols: [...policy.deniedSymbols].map((s) => s.toUpperCase()).sort(),
    approvalRequired: policy.approvalRequired,
  };
  return browserSha256Hex(JSON.stringify(normalized));
}

export async function browserToolSetSha256(toolNames: readonly string[]): Promise<string> {
  const sorted = [...new Set(toolNames.map((n) => n.trim()).filter(Boolean))].sort();
  return browserSha256Hex(sorted.join("\n"));
}

export async function browserNewId(prefix: string): Promise<string> {
  const rand = (await browserSha256Hex(`${Date.now()}-${Math.random()}`)).slice(0, 12);
  return `${prefix}-${rand}`;
}

function effectForName(name: string): InventoryToolEntry["effectClass"] {
  if (name.startsWith("place_") || name.startsWith("cancel_")) return "capital-order-mutation";
  if (name.startsWith("review_")) return "order-review";
  if (
    name.includes("watchlist") ||
    name.includes("scan") ||
    name.startsWith("create_") ||
    name.startsWith("update_") ||
    name.startsWith("follow_") ||
    name.startsWith("unfollow_") ||
    name.startsWith("add_") ||
    name.startsWith("remove_")
  ) {
    if (name.startsWith("get_")) return "observation";
    return "research-state-mutation";
  }
  return "observation";
}

/** Browser twin of package `buildPublicDocsInventoryPin` (50 tools). */
export async function buildPublicDocsInventoryPin(input?: {
  createdAt?: string;
  label?: string;
  admitted?: boolean;
  pinId?: string;
}): Promise<InventoryPin> {
  const tools: InventoryToolEntry[] = ROBINHOOD_TRADING_PUBLIC_DOCS_TOOL_NAMES.map((name) => ({
    name,
    source: "public-docs" as const,
    effectClass: effectForName(name),
  }));
  return {
    schemaVersion: "runbook.inventory-pin.v1",
    pinId: input?.pinId ?? (await browserNewId("pin")),
    createdAt: input?.createdAt ?? new Date().toISOString(),
    label: input?.label ?? "Robinhood Trading public-docs 50-tool pin",
    provider: "robinhood-public-docs",
    tools,
    toolSetSha256: await browserToolSetSha256(tools.map((t) => t.name)),
    admitted: input?.admitted ?? true,
    limitations: [
      "not-runtime-confirmed-unless-source-is-runtime-snapshot",
      "not-broker-authorization",
      "fail-closed-on-unknown-tools-when-enforced",
      "public-documentation-projection-only",
    ],
  };
}

/** Browser twin of package `checkObservedToolsAgainstPin`. */
export async function checkObservedToolsAgainstPin(
  pin: InventoryPin | undefined,
  observedToolNames: readonly string[],
  enforcement: "off" | "warn" | "fail-closed",
): Promise<InventoryCheckResult> {
  const observed = [...new Set(observedToolNames.map((n) => n.trim()).filter(Boolean))].sort();
  const observedSha = await browserToolSetSha256(observed);

  if (!pin || enforcement === "off") {
    return {
      schemaVersion: "runbook.inventory-check.v1",
      ok: true,
      enforcement,
      unknownTools: [],
      missingPinnedTools: [],
      extraTools: [],
      pinToolSetSha256: pin?.toolSetSha256 ?? null,
      observedToolSetSha256: observedSha,
      brokerEffect: false,
      compositeScore: false,
      message:
        enforcement === "off"
          ? "Inventory enforcement is off."
          : "No inventory pin attached; check treated as pass with no pin.",
    };
  }

  const pinned = new Set(pin.tools.map((t) => t.name));
  const unknownTools = observed.filter((n) => !pinned.has(n));
  const missingPinnedTools = [...pinned].filter((n) => !observed.includes(n)).sort();
  const extraTools = unknownTools.slice();
  const hasUnknown = unknownTools.length > 0;
  const ok = enforcement === "warn" ? true : !hasUnknown;

  return {
    schemaVersion: "runbook.inventory-check.v1",
    ok,
    enforcement,
    unknownTools,
    missingPinnedTools,
    extraTools,
    pinToolSetSha256: pin.toolSetSha256,
    observedToolSetSha256: observedSha,
    brokerEffect: false,
    compositeScore: false,
    message: hasUnknown
      ? enforcement === "fail-closed"
        ? `Fail-closed: ${unknownTools.length} unknown tool(s) not in admitted pin.`
        : `Warn: ${unknownTools.length} unknown tool(s) not in admitted pin.`
      : "Observed tools are within the admitted inventory pin.",
  };
}

function emptyBag(): BrowserSessionBag {
  return { schemaVersion: "runbook.control-plane-sessions-bag.v1", sessions: {} };
}

function isSessionLike(value: unknown): value is ControlPlaneSession {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.schemaVersion === "runbook.control-plane-session.v1" &&
    typeof row.sessionId === "string" &&
    typeof row.label === "string" &&
    row.purpose === "control-plane-process-evidence" &&
    row.capitalAtRisk === 0 &&
    row.brokerEffect === false &&
    row.compositeScore === false
  );
}

function readBag(): BrowserSessionBag {
  if (typeof localStorage === "undefined") return emptyBag();
  try {
    const raw = localStorage.getItem(BROWSER_SESSION_STORAGE_KEY);
    if (!raw) return emptyBag();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyBag();
    const bag = parsed as Partial<BrowserSessionBag>;
    if (bag.schemaVersion !== "runbook.control-plane-sessions-bag.v1") return emptyBag();
    const sessions: Record<string, ControlPlaneSession> = {};
    if (bag.sessions && typeof bag.sessions === "object") {
      for (const [id, session] of Object.entries(bag.sessions)) {
        if (isSessionLike(session)) sessions[id] = session;
      }
    }
    return { schemaVersion: "runbook.control-plane-sessions-bag.v1", sessions };
  } catch {
    return emptyBag();
  }
}

function writeBag(bag: BrowserSessionBag): void {
  if (typeof localStorage === "undefined") {
    throw new Error("localStorage is not available in this environment.");
  }
  localStorage.setItem(BROWSER_SESSION_STORAGE_KEY, JSON.stringify(bag));
}

/**
 * localStorage-backed Control Plane Session store.
 * API mirrors `@runbook/session` SessionStore (async), without node:fs.
 */
export class BrowserSessionStore {
  list(): ControlPlaneSession[] {
    const bag = readBag();
    return Object.values(bag.sessions).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  async create(input: {
    sessionId?: string;
    label: string;
    charter?: RiskPolicy;
    charterSeed?: CharterSeedKind;
    experimentId?: string;
    inventoryPin?: InventoryPin;
    inventoryEnforcement?: "off" | "warn" | "fail-closed";
    createdAt?: string;
  }): Promise<ControlPlaneSession> {
    const now = input.createdAt ?? new Date().toISOString();
    const sessionId = input.sessionId ?? (await browserNewId("CPS"));
    let charter = input.charter;
    if (!charter && input.charterSeed === "elite") charter = elitePolicy();
    if (!charter && input.charterSeed === "weak") charter = weakPolicy();

    const session: ControlPlaneSession = {
      schemaVersion: "runbook.control-plane-session.v1",
      sessionId,
      createdAt: now,
      updatedAt: now,
      label: input.label.trim() || "Untitled control plane session",
      purpose: "control-plane-process-evidence",
      capitalAtRisk: 0,
      brokerEffect: false,
      compositeScore: false,
      ...(charter
        ? { charter: clonePolicy(charter), charterDigest: await browserCharterDigest(charter) }
        : {}),
      ...(input.experimentId ? { experimentId: input.experimentId } : {}),
      ...(input.inventoryPin ? { inventoryPin: input.inventoryPin } : {}),
      inventoryEnforcement: input.inventoryEnforcement ?? "fail-closed",
      shadowGenerations: [],
      dossierAttachments: [],
      notes: [],
      limitations: [...SESSION_LIMITATIONS],
    };

    const bag = readBag();
    bag.sessions[session.sessionId] = session;
    writeBag(bag);
    return session;
  }

  read(sessionId: string): ControlPlaneSession {
    const session = readBag().sessions[sessionId];
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }

  async write(session: ControlPlaneSession): Promise<void> {
    if (!isSessionLike(session)) {
      throw new Error("Invalid ControlPlaneSession payload.");
    }
    const next: ControlPlaneSession = {
      ...session,
      updatedAt: new Date().toISOString(),
      capitalAtRisk: 0,
      brokerEffect: false,
      compositeScore: false,
      purpose: "control-plane-process-evidence",
    };
    const bag = readBag();
    bag.sessions[next.sessionId] = next;
    writeBag(bag);
  }

  async update(
    sessionId: string,
    mutator: (session: ControlPlaneSession) => ControlPlaneSession | Promise<ControlPlaneSession>,
  ): Promise<ControlPlaneSession> {
    const current = this.read(sessionId);
    const next = await mutator(current);
    await this.write(next);
    return this.read(sessionId);
  }

  async setCharter(sessionId: string, charter: RiskPolicy): Promise<ControlPlaneSession> {
    return this.update(sessionId, async (s) => ({
      ...s,
      charter: clonePolicy(charter),
      charterDigest: await browserCharterDigest(charter),
    }));
  }

  async setInventoryPin(sessionId: string, pin: InventoryPin): Promise<ControlPlaneSession> {
    return this.update(sessionId, (s) => ({ ...s, inventoryPin: pin }));
  }

  async setInventoryEnforcement(
    sessionId: string,
    inventoryEnforcement: "off" | "warn" | "fail-closed",
  ): Promise<ControlPlaneSession> {
    return this.update(sessionId, (s) => ({ ...s, inventoryEnforcement }));
  }

  async attachDossier(
    sessionId: string,
    attachment: Omit<DossierAttachment, "attachmentId" | "attachedAt"> & {
      attachmentId?: string;
      attachedAt?: string;
    },
  ): Promise<ControlPlaneSession> {
    return this.update(sessionId, async (s) => {
      const full: DossierAttachment = {
        attachmentId: attachment.attachmentId ?? (await browserNewId("att")),
        attachedAt: attachment.attachedAt ?? new Date().toISOString(),
        kind: attachment.kind,
        scenarioIds: attachment.scenarioIds ?? [],
        summary: attachment.summary,
        honestLabel: attachment.honestLabel ?? "architecture-evidence-not-certification",
        ...(attachment.evidenceRef ? { evidenceRef: attachment.evidenceRef } : {}),
        ...(attachment.processBridgedCount !== undefined
          ? { processBridgedCount: attachment.processBridgedCount }
          : {}),
      };
      return {
        ...s,
        dossierAttachments: [...s.dossierAttachments, full].slice(-32),
      };
    });
  }

  async recordShadowGeneration(
    sessionId: string,
    generation: {
      generation: number;
      hardFalseAllows: number;
      hardFalseDenies: number;
      recordedAt?: string;
    },
  ): Promise<ControlPlaneSession> {
    return this.update(sessionId, (s) => ({
      ...s,
      lastShadowHardFalseAllows: generation.hardFalseAllows,
      lastShadowHardFalseDenies: generation.hardFalseDenies,
      shadowGenerations: [
        ...s.shadowGenerations,
        {
          generation: generation.generation,
          hardFalseAllows: generation.hardFalseAllows,
          hardFalseDenies: generation.hardFalseDenies,
          recordedAt: generation.recordedAt ?? new Date().toISOString(),
        },
      ].slice(-32),
    }));
  }

  async exportPack(sessionId: string): Promise<SessionEvidencePack> {
    const session = this.read(sessionId);
    return {
      schemaVersion: "runbook.session-evidence-pack.v1",
      exportedAt: new Date().toISOString(),
      session,
      assurance: "local-control-plane-export-only",
      brokerEffect: false,
      compositeScore: false,
      notTradingPerformance: true,
    };
  }

  delete(sessionId: string): void {
    const bag = readBag();
    delete bag.sessions[sessionId];
    writeBag(bag);
  }
}

/** Shared singleton for dashboard + dossier attach panel. */
export const browserSessionStore = new BrowserSessionStore();

/** Status-snapshot attachment derived from honest DOSSIER_COUNTS (not certification). */
export function buildDossierStatusSnapshotAttachment(input?: {
  attachmentId?: string;
  attachedAt?: string;
}): Omit<DossierAttachment, "attachmentId" | "attachedAt"> & {
  attachmentId?: string;
  attachedAt?: string;
} {
  return {
    ...(input?.attachmentId ? { attachmentId: input.attachmentId } : {}),
    ...(input?.attachedAt ? { attachedAt: input.attachedAt } : {}),
    kind: "status-snapshot",
    scenarioIds: [...PROCESS_BRIDGED_IDS],
    summary:
      `Dossier status snapshot: ${DOSSIER_COUNTS.total} cases · ` +
      `${DOSSIER_COUNTS.processBridged} process-bridged · ` +
      `${DOSSIER_COUNTS.hostOnly} host-only · ` +
      `${DOSSIER_COUNTS.unrun} unrun · ` +
      `${DOSSIER_COUNTS.recoverProcessPartialTrials} recover trials process-partial. ` +
      `Architecture evidence only — not buyer-ready certification.`,
    processBridgedCount: DOSSIER_COUNTS.processBridged,
    evidenceRef: `dossier-counts:v1:pb=${DOSSIER_COUNTS.processBridged}:ho=${DOSSIER_COUNTS.hostOnly}:un=${DOSSIER_COUNTS.unrun}`,
    honestLabel: "architecture-evidence-not-certification",
  };
}

export function downloadEvidencePack(pack: SessionEvidencePack): void {
  const blob = new Blob([`${JSON.stringify(pack, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `runbook-session-evidence-${pack.session.sessionId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type { ControlPlaneSession, DossierAttachment, InventoryCheckResult, InventoryPin, SessionEvidencePack };
