import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RiskPolicy } from "@runbook/engine/schema";
import { charterDigest, newId } from "./canonical.js";
import {
  controlPlaneSessionSchema,
  sessionEvidencePackSchema,
  type ControlPlaneSession,
  type DossierAttachment,
  type InventoryPin,
  type SessionEvidencePack,
} from "./types.js";

export type SessionStoreOptions = {
  /** Absolute directory for session JSON files. */
  rootDir: string;
};

function sessionPath(rootDir: string, sessionId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(sessionId)) {
    throw new Error("Invalid sessionId");
  }
  return join(rootDir, `${sessionId}.json`);
}

export class SessionStore {
  constructor(private readonly options: SessionStoreOptions) {}

  get rootDir(): string {
    return this.options.rootDir;
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.options.rootDir, { recursive: true, mode: 0o700 });
  }

  async create(input: {
    sessionId?: string;
    label: string;
    charter?: RiskPolicy;
    experimentId?: string;
    inventoryPin?: InventoryPin;
    inventoryEnforcement?: "off" | "warn" | "fail-closed";
    createdAt?: string;
  }): Promise<ControlPlaneSession> {
    await this.ensureRoot();
    const now = input.createdAt ?? new Date().toISOString();
    const sessionId = input.sessionId ?? newId("CPS");
    const session: ControlPlaneSession = controlPlaneSessionSchema.parse({
      schemaVersion: "runbook.control-plane-session.v1",
      sessionId,
      createdAt: now,
      updatedAt: now,
      label: input.label,
      purpose: "control-plane-process-evidence",
      capitalAtRisk: 0,
      brokerEffect: false,
      compositeScore: false,
      ...(input.charter
        ? { charter: input.charter, charterDigest: charterDigest(input.charter) }
        : {}),
      ...(input.experimentId ? { experimentId: input.experimentId } : {}),
      ...(input.inventoryPin ? { inventoryPin: input.inventoryPin } : {}),
      inventoryEnforcement: input.inventoryEnforcement ?? "fail-closed",
      shadowGenerations: [],
      dossierAttachments: [],
      notes: [],
      limitations: [
        "advisory-not-hard-gateway",
        "not-trading-performance",
        "not-capital-allocation",
        "no-composite-safety-score",
        "local-session-only",
      ],
    });
    await this.write(session);
    return session;
  }

  async read(sessionId: string): Promise<ControlPlaneSession> {
    const raw = await readFile(sessionPath(this.options.rootDir, sessionId), "utf8");
    return controlPlaneSessionSchema.parse(JSON.parse(raw));
  }

  async write(session: ControlPlaneSession): Promise<void> {
    await this.ensureRoot();
    const parsed = controlPlaneSessionSchema.parse({
      ...session,
      updatedAt: new Date().toISOString(),
    });
    const path = sessionPath(this.options.rootDir, parsed.sessionId);
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, path);
  }

  async update(
    sessionId: string,
    mutator: (session: ControlPlaneSession) => ControlPlaneSession | Promise<ControlPlaneSession>,
  ): Promise<ControlPlaneSession> {
    const current = await this.read(sessionId);
    const next = await mutator(current);
    await this.write(next);
    return this.read(sessionId);
  }

  async setCharter(sessionId: string, charter: RiskPolicy): Promise<ControlPlaneSession> {
    return this.update(sessionId, (s) => ({
      ...s,
      charter,
      charterDigest: charterDigest(charter),
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
    return this.update(sessionId, (s) => {
      const full: DossierAttachment = {
        attachmentId: attachment.attachmentId ?? newId("att"),
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

  async bindExperiment(
    sessionId: string,
    experimentId: string,
    ledgerHeadHash?: string,
  ): Promise<ControlPlaneSession> {
    return this.update(sessionId, (s) => ({
      ...s,
      experimentId,
      ...(ledgerHeadHash ? { ledgerHeadHash } : {}),
    }));
  }

  async exportPack(sessionId: string): Promise<SessionEvidencePack> {
    const session = await this.read(sessionId);
    return sessionEvidencePackSchema.parse({
      schemaVersion: "runbook.session-evidence-pack.v1",
      exportedAt: new Date().toISOString(),
      session,
      assurance: "local-control-plane-export-only",
      brokerEffect: false,
      compositeScore: false,
      notTradingPerformance: true,
    });
  }
}

export function defaultSessionRoot(dataDir?: string): string {
  if (dataDir) return join(dataDir, "sessions");
  return join(process.env.HOME ?? "/tmp", ".runbook", "sessions");
}

export { dirname };
