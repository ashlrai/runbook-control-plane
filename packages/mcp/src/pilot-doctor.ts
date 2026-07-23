import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import * as z from "zod/v4";
import type { LedgerEvent, RiskPolicy } from "@runbook/engine/schema";
import { riskPolicySchema } from "@runbook/engine/schema";
import type { RunbookService } from "./service.js";

export const shadowPilotManifestSchema = z.object({
  schemaVersion: z.literal("runbook.shadow-pilot.v1"),
  experimentId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/),
  mode: z.literal("shadow"),
  brokerageConnection: z.literal("disconnected"),
  dataSource: z.enum(["synthetic", "manually-entered-owned-data"]),
  orderExecution: z.literal("disabled"),
  capitalAtRisk: z.literal(0),
  publication: z.literal("manual-human-reviewed"),
  operatorAttestations: z.object({
    noBrokerCredentials: z.literal(true),
    noBrokerOrderTools: z.literal(true),
    noLiveExecutionImports: z.literal(true),
    noAutomatedPublishing: z.literal(true),
  }).strict(),
}).strict();

export type ShadowPilotManifest = z.infer<typeof shadowPilotManifestSchema>;

export type PilotDoctorCheck = {
  id: string;
  label: string;
  passed: boolean;
  severity: "blocking" | "advisory";
  detail: string;
};

export type PilotDoctorReport = {
  schemaVersion: "runbook.pilot-doctor.v1";
  profile: "shadow-no-broker";
  experimentId: string;
  ready: boolean;
  assurance: "local-attestation-and-ledger-only";
  checks: PilotDoctorCheck[];
  nextActions: string[];
};

export type DiagnoseShadowPilotInput = {
  manifest: ShadowPilotManifest;
  service: RunbookService;
  dataDir: string;
  workspaceRoot: string;
  environment?: NodeJS.ProcessEnv;
};

const ROBINHOOD_CREDENTIAL_NAME = /(?:^|_)(?:ROBINHOOD|RH)(?:_|$).*(?:PASSWORD|PASSCODE|TOKEN|SECRET|API_KEY|SESSION|COOKIE|CREDENTIAL)/i;
const OBVIOUS_SYNC_COMPONENTS = new Set([
  "dropbox",
  "google drive",
  "icloud drive",
  "mobile documents",
  "onedrive",
]);

function payload(event: LedgerEvent) {
  return event.payload as Record<string, unknown>;
}

function isInside(parent: string, candidate: string) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === "" || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent));
}

function hasObviousSyncComponent(path: string) {
  return path
    .split(sep)
    .map((component) => component.toLowerCase())
    .some((component) => OBVIOUS_SYNC_COMPONENTS.has(component) || component.includes("clouddocs"));
}

function check(
  id: string,
  label: string,
  passed: boolean,
  detail: string,
  severity: PilotDoctorCheck["severity"] = "blocking",
): PilotDoctorCheck {
  return { id, label, passed, severity, detail };
}

type PrivatePathInspection = {
  exists: boolean;
  valid: boolean;
  mode?: string;
  reason?: "missing" | "not-plain" | "ownership-unverifiable" | "wrong-owner" | "permissions" | "unreadable";
};

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function modeString(mode: number) {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

async function inspectPrivatePath(
  path: string,
  kind: "directory" | "file",
  missingAllowed = false,
): Promise<PrivatePathInspection> {
  try {
    const link = await lstat(path);
    if (link.isSymbolicLink()) return { exists: true, valid: false, reason: "not-plain" };
  } catch (error) {
    if (isMissingFile(error)) return { exists: false, valid: missingAllowed, reason: "missing" };
    return { exists: false, valid: false, reason: "unreadable" };
  }

  let handle;
  try {
    const flags = constants.O_RDONLY | constants.O_NOFOLLOW |
      (kind === "directory" ? constants.O_DIRECTORY : 0);
    handle = await open(path, flags);
  } catch (error) {
    if (isMissingFile(error)) return { exists: false, valid: missingAllowed, reason: "missing" };
    return { exists: true, valid: false, reason: "unreadable" };
  }
  try {
    const opened = await handle.stat();
    const plain = kind === "directory" ? opened.isDirectory() : opened.isFile();
    if (!plain) return { exists: true, valid: false, reason: "not-plain" };
    const mode = modeString(opened.mode);
    if (typeof process.getuid !== "function") {
      return { exists: true, valid: false, mode, reason: "ownership-unverifiable" };
    }
    if (opened.uid !== process.getuid()) {
      return { exists: true, valid: false, mode, reason: "wrong-owner" };
    }
    if ((opened.mode & 0o077) !== 0) {
      return { exists: true, valid: false, mode, reason: "permissions" };
    }
    return { exists: true, valid: true, mode };
  } finally {
    await handle.close();
  }
}

function privatePathDetail(
  inspection: PrivatePathInspection,
  kind: "data directory" | "ledger file" | "writer lock",
  missingAllowed = false,
) {
  if (inspection.valid && !inspection.exists && missingAllowed) {
    return `No ${kind} exists; no permissions are being attested for it.`;
  }
  if (inspection.valid) {
    return `${kind[0]?.toUpperCase()}${kind.slice(1)} is owned by the current user with owner-only mode ${inspection.mode}.`;
  }
  if (inspection.reason === "permissions") {
    return `${kind[0]?.toUpperCase()}${kind.slice(1)} mode ${inspection.mode} permits group or other access; require owner-only permissions (normally 0700 for the directory and 0600 for files).`;
  }
  if (inspection.reason === "wrong-owner") return `${kind[0]?.toUpperCase()}${kind.slice(1)} is not owned by the current user.`;
  if (inspection.reason === "ownership-unverifiable") return `${kind[0]?.toUpperCase()}${kind.slice(1)} ownership cannot be verified on this platform.`;
  if (inspection.reason === "missing") return `${kind[0]?.toUpperCase()}${kind.slice(1)} does not exist.`;
  return `${kind[0]?.toUpperCase()}${kind.slice(1)} is not an inspectable, ordinary ${kind === "data directory" ? "directory" : "file"}.`;
}

async function canonicalPath(path: string) {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function parseActivePolicy(events: LedgerEvent[]): RiskPolicy | undefined {
  const charter = events.filter((event) => event.type === "charter.activated").at(-1);
  if (!charter) return undefined;
  const parsed = riskPolicySchema.safeParse(payload(charter).policy);
  return parsed.success ? parsed.data : undefined;
}

export async function diagnoseShadowPilot(
  rawInput: DiagnoseShadowPilotInput,
): Promise<PilotDoctorReport> {
  const manifest = shadowPilotManifestSchema.parse(rawInput.manifest);
  const environment = rawInput.environment ?? process.env;
  const credentialVariables = Object.entries(environment)
    .filter(([name, value]) => Boolean(value) && ROBINHOOD_CREDENTIAL_NAME.test(name))
    .map(([name]) => name);

  const absoluteDataDir = isAbsolute(rawInput.dataDir);
  const absoluteWorkspaceRoot = isAbsolute(rawInput.workspaceRoot);
  const [canonicalDataDir, canonicalWorkspaceRoot, dataDirectoryStat] = await Promise.all([
    canonicalPath(rawInput.dataDir),
    canonicalPath(rawInput.workspaceRoot),
    lstat(rawInput.dataDir).catch(() => undefined),
  ]);
  const storageOutsideWorkspace = absoluteDataDir && absoluteWorkspaceRoot && !isInside(canonicalWorkspaceRoot, canonicalDataDir);
  const privateDirectoryIsPlain = dataDirectoryStat?.isDirectory() === true && !dataDirectoryStat.isSymbolicLink();
  const [dataDirectorySecurity, ledgerFileSecurity, writerLockSecurity] = await Promise.all([
    inspectPrivatePath(rawInput.dataDir, "directory"),
    inspectPrivatePath(rawInput.service.ledger.path, "file"),
    inspectPrivatePath(rawInput.service.ledger.lockPath, "file", true),
  ]);
  const ledgerVerification = await rawInput.service.verify();
  const events = ledgerVerification.valid
    ? await rawInput.service.listEvents(manifest.experimentId).catch(() => [])
    : [];
  const hasExperiment = events.some((event) => event.type === "experiment.created");
  const activePolicy = parseActivePolicy(events);
  const executionCount = events.filter((event) => event.type === "execution.recorded").length;
  const proposals = events.filter((event) => event.type === "proposal.recorded");
  const preflights = events.filter((event) => event.type === "preflight.completed");
  const proposalIds = proposals.map((event) => payload(event).proposalId).filter((id): id is string => typeof id === "string");
  const preflightIds = preflights.map((event) => payload(event).proposalId).filter((id): id is string => typeof id === "string");
  const proposalIdSet = new Set(proposalIds);
  const preflightIdSet = new Set(preflightIds);
  const proposalCount = proposals.length;
  const preflightCount = preflights.length;
  const proposalsHavePreflights =
    proposalIds.length === proposalCount &&
    preflightIds.length === preflightCount &&
    proposalCount === preflightCount &&
    proposalIds.every((id) => preflightIdSet.has(id)) &&
    preflightIds.every((id) => proposalIdSet.has(id));
  const equityOnly = activePolicy?.allowedInstruments.length === 1 && activePolicy.allowedInstruments[0] === "equity";

  const checks: PilotDoctorCheck[] = [
    check("manifest.shadow-mode", "Shadow mode declared", manifest.mode === "shadow", "Manifest is locked to shadow mode."),
    check("manifest.broker-disconnected", "Broker connection disabled", manifest.brokerageConnection === "disconnected", "No Robinhood or other brokerage MCP connection is permitted in this profile."),
    check("manifest.execution-disabled", "Order execution disabled", manifest.orderExecution === "disabled" && manifest.capitalAtRisk === 0, "The profile declares zero capital at risk and no order execution."),
    check("manifest.manual-publication", "Publication remains manual", manifest.publication === "manual-human-reviewed" && manifest.operatorAttestations.noAutomatedPublishing, "Every public draft requires human review and manual submission."),
    check("manifest.operator-attestations", "No-credential and no-order-tool attestations recorded", manifest.operatorAttestations.noBrokerCredentials && manifest.operatorAttestations.noBrokerOrderTools && manifest.operatorAttestations.noLiveExecutionImports, "Operator attestations are local declarations, not technical enforcement."),
    check("environment.no-broker-credentials", "No Robinhood credential-shaped environment variables", credentialVariables.length === 0, credentialVariables.length === 0 ? "No populated Robinhood credential-shaped variables were detected." : `${credentialVariables.length} populated credential-shaped variable(s) detected; names and values are withheld.`),
    check("storage.absolute", "Private data path is absolute", absoluteDataDir, absoluteDataDir ? "Data path is absolute." : "Use an absolute RUNBOOK_DATA_DIR."),
    check("storage.plain-directory", "Private data path is a real directory", privateDirectoryIsPlain, privateDirectoryIsPlain ? "Data path is an existing non-symlink directory." : "Use an existing private directory, not a symlink."),
    check("storage.owner-private", "Data directory is owner-private", dataDirectorySecurity.valid, privatePathDetail(dataDirectorySecurity, "data directory")),
    check("storage.outside-workspace", "Private data stays outside the workspace", storageOutsideWorkspace, storageOutsideWorkspace ? "Data path is outside the declared workspace root." : "Move RUNBOOK_DATA_DIR outside the repository/workspace."),
    check("storage.not-obviously-synced", "Private data path is not obviously synced", absoluteDataDir && !hasObviousSyncComponent(canonicalDataDir), absoluteDataDir && !hasObviousSyncComponent(canonicalDataDir) ? "No common sync-provider path component was detected." : "Do not use iCloud Drive, Dropbox, Google Drive, or OneDrive for private ledger data."),
    check("ledger.file-owner-private", "Ledger file is owner-private", ledgerFileSecurity.valid, privatePathDetail(ledgerFileSecurity, "ledger file")),
    check("ledger.lock-owner-private", "Writer lock is owner-private when present", writerLockSecurity.valid, privatePathDetail(writerLockSecurity, "writer lock", true)),
    check("ledger.integrity", "Local ledger verifies", ledgerVerification.valid, ledgerVerification.valid ? `${ledgerVerification.eventCount} event(s); local hash chain is valid.` : `${ledgerVerification.errors.length} ledger verification error(s).`),
    check("experiment.created", "Shadow experiment exists", hasExperiment, hasExperiment ? `${manifest.experimentId} has an experiment.created event.` : `Create ${manifest.experimentId} before beginning the pilot.`),
    check("charter.active", "Active charter parses", Boolean(activePolicy), activePolicy ? "The latest charter contains a valid risk policy." : "Create or repair the experiment charter."),
    check("charter.approval-required", "Approval-required policy flag is set", activePolicy?.approvalRequired === true, activePolicy?.approvalRequired ? "The active charter declares that an approval record is required; this does not authenticate human authority." : "Set approvalRequired to true for the shadow pilot."),
    check("charter.equity-only", "Pilot charter is equity-only", equityOnly, equityOnly ? "The active charter permits equities only." : "Restrict allowedInstruments to exactly [\"equity\"] for this first pilot."),
    check("experiment.no-executions", "No execution records exist", executionCount === 0, executionCount === 0 ? "No live or imported execution is mixed into the shadow experiment." : `${executionCount} execution record(s) found; create a new shadow-only experiment.`),
    check("experiment.preflights-paired", "Recorded proposals have deterministic preflights", proposalsHavePreflights, proposalsHavePreflights ? `${proposalCount} proposal(s) and ${preflightCount} preflight(s).` : `${proposalCount} proposal(s) but ${preflightCount} preflight(s).`),
    check("workflow.shadow-evidence", "At least one shadow proposal has been evaluated", proposalCount > 0 && preflightCount > 0, proposalCount > 0 ? `${proposalCount} shadow proposal(s) recorded.` : "Readiness can pass before the first proposal; record one proposal to produce pilot evidence.", "advisory"),
  ];

  const blockingFailures = checks.filter((item) => item.severity === "blocking" && !item.passed);
  const nextActions = blockingFailures.map((item) => item.detail);
  if (blockingFailures.length === 0 && proposalCount === 0) {
    nextActions.push("Run one synthetic or manually entered owned-data proposal through runbook_preflight_trade; do not connect a broker.");
  }
  if (blockingFailures.length === 0 && proposalCount > 0) {
    nextActions.push("Perform human review outside MCP and manually publish only a metadata-only snapshot; a caller-asserted MCP actor does not prove human authority.");
  }

  return {
    schemaVersion: "runbook.pilot-doctor.v1",
    profile: "shadow-no-broker",
    experimentId: manifest.experimentId,
    ready: blockingFailures.length === 0,
    assurance: "local-attestation-and-ledger-only",
    checks,
    nextActions,
  };
}
