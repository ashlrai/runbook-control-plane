"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  Check,
  CircleAlert,
  Download,
  FileArchive,
  GitBranch,
  LoaderCircle,
  Plus,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  LineageAtlasClient,
  type LineageAtlasEnvironmentResult,
  type LineageAtlasOutcome,
} from "../lib/lineage-atlas-client";
import {
  validateLineageAtlasSelection,
  isKeyId,
  isSha256,
  type CreatorDomainResult,
  type LineageAtlasProgress,
} from "../lib/lineage-atlas-worker-protocol";
import { BrandMark } from "./brand-mark";
import styles from "./lineage-atlas.module.css";

const MAX_FILES = 32;
const CREATOR_SEED_CAPSULE_ID = "2f5f3d9f2f7cdf7af0f9b6d6ba290c31609623bf1acccb0f46f3bd716fc6fb64";
const ERROR_CODE_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const RECEIPT_LIMITATIONS = [
  "receipt-is-unsigned-local-analysis",
  "selected-set-does-not-prove-complete-history",
  "declared-lineage-does-not-prove-parent-consent-causality-or-correctness",
  "shared-self-asserted-key-does-not-prove-identity-control-continuity-or-common-authorship",
  "correction-or-supersession-does-not-revoke-or-erase",
  "analysis-does-not-prove-independent-time-broker-activity-performance-skill-suitability-or-compliance",
  "metadata-hashes-capsule-ids-key-ids-and-lineage-can-correlate-artifacts",
] as const;
const RECEIPT_LIMITATION_SET = new Set<string>(RECEIPT_LIMITATIONS);

type CoreStatus = "valid" | "invalid";
type Relation = "root" | "derived" | "corrects" | "supersedes";
type KeyRelationship = "same-self-asserted-key" | "different-self-asserted-key" | "not-evaluated";
type CreatorProofState = "valid-supported-fork" | "invalid-supported-fork" | "not-supported" | "not-evaluated";

export type AtlasArtifactView = {
  archiveSha256: string;
  bytes: number;
  coreErrorCodes: readonly string[];
  coreReceiptSha256: string;
  coreStatus: CoreStatus;
  capsuleId: string | null;
  authorKeyId: string | null;
};

export type AtlasNodeView = {
  authorKeyId: string;
  capsuleId: string;
  parentIds: readonly string[];
  relation: Relation;
  transportHashes: readonly string[];
};

export type AtlasEdgeView = {
  childCapsuleId: string;
  keyRelationship: KeyRelationship;
  parentCapsuleId: string;
  relation: Exclude<Relation, "root">;
  status: "resolved" | "missing";
};

export type AtlasCycleView = { capsuleIds: readonly string[] };

export type AtlasDomainView = {
  capsuleId: string;
  state: CreatorProofState;
};

export type AtlasAnalysisView = {
  analysisComplete: true;
  artifacts: readonly AtlasArtifactView[];
  nodes: readonly AtlasNodeView[];
  edges: readonly AtlasEdgeView[];
  cycles: readonly AtlasCycleView[];
  domains: readonly AtlasDomainView[];
  duplicateSelectionCount: number;
  errorFindings: readonly string[];
  identityConflictIds: readonly string[];
  warningFindings: readonly string[];
  limitations: readonly string[];
  receiptBytes: Uint8Array;
  researchPacketBytes: Uint8Array;
};

export type AtlasProgressView = LineageAtlasProgress;

export type LineageAtlasClientLike = {
  initialize(): Promise<LineageAtlasEnvironmentResult | null>;
  analyze(blobs: readonly Blob[], onProgress?: (progress: AtlasProgressView) => void): Promise<LineageAtlasOutcome>;
  cancel(): void;
  dispose(): void;
};

type LineageAtlasProps = {
  createClient?: () => LineageAtlasClientLike;
};

type PageState =
  | { kind: "checking" }
  | { kind: "idle" }
  | { kind: "working"; progress: AtlasProgressView }
  | { kind: "result"; result: AtlasAnalysisView }
  | { kind: "input-error"; code: string; detail: string }
  | { kind: "environment-error"; code: string };

type ViewMode = "map" | "outline" | "exclusions";
type Filter = "all" | "resolved" | "missing" | "creator" | "issues";

const environmentCopy: Record<string, string> = {
  "crypto.unavailable": "Required browser cryptography is unavailable. No file set was analyzed.",
  "crypto.operation-failed": "A browser cryptography operation failed. No completed lineage receipt was produced.",
  "input.read-failed": "At least one selected file could not be read. The batch was rejected without a partial result.",
  "output.size-limit": "The metadata-only receipt exceeded its bounded output limit. No completed result was shown.",
  "worker.cancelled": "The local analysis was cancelled. No partial lineage result was retained.",
  "worker.disposed": "The local analyzer was disposed before it produced a result.",
  "worker.timeout": "The bounded local analysis timed out. No partial lineage result was retained.",
  "worker.failure": "The isolated lineage Worker failed. No core or graph verdict was produced.",
};

function defaultClientFactory(): LineageAtlasClientLike { return new LineageAtlasClient(); }

function rawStringCompare(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0; }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function strings(value: unknown, valid: (entry: string) => boolean, maximum: number): string[] | null {
  return Array.isArray(value) && value.length <= maximum && value.every((entry) => typeof entry === "string" && valid(entry)) ? [...value] : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort(rawStringCompare);
  const wanted = [...expected].sort(rawStringCompare);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function adaptCreatorDomains(results: readonly CreatorDomainResult[], nodes: readonly AtlasNodeView[]): AtlasDomainView[] {
  const evaluated = new Map<string, CreatorProofState>();
  for (const result of results) {
    const id = result.receipt.childCapsuleId;
    if (id !== null) evaluated.set(id, result.receipt.valid ? "valid-supported-fork" : "invalid-supported-fork");
  }
  return nodes.map((node) => ({ capsuleId: node.capsuleId, state: evaluated.get(node.capsuleId) ?? "not-evaluated" }));
}

/** Maps only protocol-validated, allowlisted metadata into renderable values. */
function adaptResult(outcome: Extract<LineageAtlasOutcome, { kind: "result" }>): AtlasAnalysisView | null {
  const receipt = outcome.receipt;
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length > 32
    || !Array.isArray(receipt.nodes) || receipt.nodes.length > 32
    || !Array.isArray(receipt.edges) || receipt.edges.length > 256
    || !Array.isArray(receipt.cycles) || receipt.cycles.length > 32
    || !Array.isArray(receipt.limitations) || !isRecord(receipt.findings)
    || !Array.isArray(receipt.findings.errors) || !Array.isArray(receipt.findings.warnings)) return null;

  const artifacts: AtlasArtifactView[] = [];
  for (const value of receipt.artifacts) {
    if (!isRecord(value) || !exactKeys(value, ["archiveSha256", "authorKeyId", "byteLength", "capsuleId", "coreErrorCodes", "coreReceiptSha256", "coreStatus", "parents", "relation"])
      || typeof value.archiveSha256 !== "string" || !isSha256(value.archiveSha256)
      || typeof value.byteLength !== "number" || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > 64 * 1024 * 1024
      || typeof value.coreReceiptSha256 !== "string" || !isSha256(value.coreReceiptSha256)
      || (value.coreStatus !== "valid" && value.coreStatus !== "invalid")) return null;
    const coreErrorCodes = strings(value.coreErrorCodes, (entry) => ERROR_CODE_PATTERN.test(entry), 128);
    const artifactParents = strings(value.parents, isSha256, 8);
    if (coreErrorCodes === null || (value.capsuleId !== null && (typeof value.capsuleId !== "string" || !isSha256(value.capsuleId)))
      || (value.authorKeyId !== null && (typeof value.authorKeyId !== "string" || !isKeyId(value.authorKeyId)))
      || artifactParents === null
      || (value.coreStatus === "valid" && (value.capsuleId === null || value.authorKeyId === null || coreErrorCodes.length > 0
        || (value.relation !== "root" && value.relation !== "derived" && value.relation !== "corrects" && value.relation !== "supersedes")))
      || (value.coreStatus === "invalid" && (value.capsuleId !== null || value.authorKeyId !== null || value.relation !== null || artifactParents.length !== 0))) return null;
    artifacts.push({ archiveSha256: value.archiveSha256, bytes: value.byteLength, coreErrorCodes, coreReceiptSha256: value.coreReceiptSha256, coreStatus: value.coreStatus, capsuleId: value.capsuleId, authorKeyId: value.authorKeyId });
  }

  const nodes: AtlasNodeView[] = [];
  for (const value of receipt.nodes) {
    if (!isRecord(value) || !exactKeys(value, ["authorKeyId", "capsuleId", "parents", "relation", "transportSha256"])
      || typeof value.authorKeyId !== "string" || !isKeyId(value.authorKeyId)
      || typeof value.capsuleId !== "string" || !isSha256(value.capsuleId)
      || (value.relation !== "root" && value.relation !== "derived" && value.relation !== "corrects" && value.relation !== "supersedes")) return null;
    const parentIds = strings(value.parents, isSha256, 8);
    const transportHashes = strings(value.transportSha256, isSha256, 32);
    if (parentIds === null || transportHashes === null || transportHashes.length < 1) return null;
    nodes.push({ authorKeyId: value.authorKeyId, capsuleId: value.capsuleId, parentIds, relation: value.relation, transportHashes });
  }

  const edges: AtlasEdgeView[] = [];
  for (const value of receipt.edges) {
    if (!isRecord(value) || !exactKeys(value, ["childCapsuleId", "keyRelationship", "parentCapsuleId", "relation", "status"])
      || typeof value.childCapsuleId !== "string" || !isSha256(value.childCapsuleId)
      || typeof value.parentCapsuleId !== "string" || !isSha256(value.parentCapsuleId)
      || (value.relation !== "derived" && value.relation !== "corrects" && value.relation !== "supersedes")
      || (value.status !== "resolved" && value.status !== "missing")
      || (value.keyRelationship !== "same-self-asserted-key" && value.keyRelationship !== "different-self-asserted-key" && value.keyRelationship !== "not-evaluated")) return null;
    edges.push({ childCapsuleId: value.childCapsuleId, keyRelationship: value.keyRelationship, parentCapsuleId: value.parentCapsuleId, relation: value.relation, status: value.status });
  }

  const cycles: AtlasCycleView[] = [];
  for (const value of receipt.cycles) {
    if (!isRecord(value) || !exactKeys(value, ["capsuleIds"])) return null;
    const capsuleIds = strings(value.capsuleIds, isSha256, 32);
    if (capsuleIds === null || capsuleIds.length < 1) return null;
    cycles.push({ capsuleIds });
  }
  function findingCodes(values: unknown[]) {
    const codes: string[] = [];
    for (const value of values) {
      if (!isRecord(value) || typeof value.code !== "string" || !ERROR_CODE_PATTERN.test(value.code)) return null;
      codes.push(value.code);
    }
    return codes;
  }
  const errorFindings = findingCodes(receipt.findings.errors);
  const warningFindings = findingCodes(receipt.findings.warnings);
  const limitations = strings(receipt.limitations, (entry) => RECEIPT_LIMITATION_SET.has(entry), RECEIPT_LIMITATIONS.length);
  if (errorFindings === null || warningFindings === null || limitations === null
    || limitations.length !== RECEIPT_LIMITATIONS.length
    || limitations.some((entry, index) => entry !== RECEIPT_LIMITATIONS[index])) return null;
  const identityConflictIds: string[] = [];
  for (const value of receipt.findings.errors) {
    if (isRecord(value) && value.code === "lineage.identity-conflict" && typeof value.capsuleId === "string" && isSha256(value.capsuleId)) identityConflictIds.push(value.capsuleId);
  }
  return {
    analysisComplete: true,
    artifacts,
    nodes,
    edges,
    cycles,
    domains: adaptCreatorDomains(outcome.creatorDomainResults, nodes),
    duplicateSelectionCount: outcome.duplicateSelectionCount,
    errorFindings,
    identityConflictIds,
    warningFindings,
    limitations,
    receiptBytes: new Uint8Array(outcome.receiptBytes),
    researchPacketBytes: new Uint8Array(outcome.researchPacketBytes),
  };
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  if (error instanceof Error && /^[a-z]+(?:[.-][a-z]+)+$/.test(error.message)) return error.message;
  return "worker.failure";
}

function shortHash(value: string) {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function relationLabel(node: AtlasNodeView, edges: readonly AtlasEdgeView[], cycleIds: ReadonlySet<string>) {
  if (cycleIds.has(node.capsuleId)) return "CORE VALID · DECLARED CYCLE";
  if (node.relation === "root") return "CORE VALID · ROOT";
  const declared = edges.filter((edge) => edge.childCapsuleId === node.capsuleId);
  const resolved = declared.filter((edge) => edge.status === "resolved").length;
  const missing = declared.length - resolved;
  if (missing > 0 && resolved > 0) return "CORE VALID · PARTIALLY RESOLVED";
  if (missing > 0) return "CORE VALID · PARENT NOT LOADED";
  return "CORE VALID · PARENT RESOLVED";
}

function domainLabel(state: CreatorProofState) {
  if (state === "valid-supported-fork") return "Creator Proof · supported one-rule fork";
  if (state === "invalid-supported-fork") return "Creator Proof checks failed · core validity is separate";
  if (state === "not-supported") return "No Creator Proof profile applies";
  return "Creator Proof not evaluated";
}

function stageLabel(progress: AtlasProgressView) {
  if (progress.stage === "reading") return "Reading bounded local bytes";
  if (progress.stage === "verifying") return `Verifying ${Math.min(progress.completed + 1, progress.total)} of ${progress.total} files`;
  if (progress.stage === "analyzing") return "Resolving loaded parent declarations";
  if (progress.stage === "domain-checking") return "Running separate Creator Proof checks";
  return "Serializing metadata-only evidence";
}

function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  anchor.click();
  URL.revokeObjectURL(url);
}

function computeGenerations(nodes: readonly AtlasNodeView[], edges: readonly AtlasEdgeView[]) {
  const generation = new Map(nodes.map((node) => [node.capsuleId, node.relation === "root" ? 0 : 1]));
  const resolved = edges.filter((edge) => edge.status === "resolved");
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of resolved) {
      const parent = generation.get(edge.parentCapsuleId) ?? 0;
      const child = generation.get(edge.childCapsuleId) ?? 1;
      const next = Math.min(nodes.length, Math.max(child, parent + 1));
      if (next !== child) { generation.set(edge.childCapsuleId, next); changed = true; }
    }
    if (!changed) break;
  }
  const grouped = new Map<number, AtlasNodeView[]>();
  for (const node of [...nodes].sort((left, right) => rawStringCompare(left.capsuleId, right.capsuleId))) {
    const value = generation.get(node.capsuleId) ?? 0;
    grouped.set(value, [...(grouped.get(value) ?? []), node]);
  }
  return [...grouped.entries()].sort(([left], [right]) => left - right);
}

function NodeCard({ node, result, selected, onSelect }: { node: AtlasNodeView; result: AtlasAnalysisView; selected: boolean; onSelect: () => void }) {
  const cycleIds = new Set(result.cycles.flatMap((cycle) => cycle.capsuleIds));
  const nodeEdges = result.edges.filter((edge) => edge.childCapsuleId === node.capsuleId);
  const hasMissing = nodeEdges.some((edge) => edge.status === "missing");
  const hasResolved = nodeEdges.some((edge) => edge.status === "resolved");
  const keyGroupSize = result.nodes.filter((candidate) => candidate.authorKeyId === node.authorKeyId).length;
  const domain = result.domains.find((candidate) => candidate.capsuleId === node.capsuleId)?.state ?? "not-evaluated";
  return (
    <button
      className={styles.nodeButton}
      type="button"
      aria-pressed={selected}
      data-missing={hasMissing ? "true" : "false"}
      data-key-match={keyGroupSize > 1 ? "true" : "false"}
      onClick={onSelect}
    >
      <span className={styles.nodeState}>{relationLabel(node, result.edges, cycleIds)}</span>
      <code aria-label={`Capsule ID ${node.capsuleId}`}>{shortHash(node.capsuleId)}</code>
      <small>{node.relation === "root" ? "No parent declared." : hasMissing ? "At least one declared parent is not loaded." : hasResolved ? "Loaded valid parent declaration resolved." : "Declared relationship not evaluated."}</small>
      <span className={styles.domainBadge}>{domainLabel(domain)}</span>
    </button>
  );
}

function EdgeBundle({ node, result }: { node: AtlasNodeView; result: AtlasAnalysisView }) {
  const edges = result.edges
    .filter((edge) => edge.childCapsuleId === node.capsuleId)
    .sort((left, right) => rawStringCompare(left.parentCapsuleId, right.parentCapsuleId));
  return (
    <div className={styles.edgeBundle} aria-hidden="true">
      {node.relation === "root" ? <span className={styles.edgeRoot}>Root · no parent declared</span> : edges.map((edge) => (
        <span className={styles.edgeThread} data-status={edge.status} data-testid="edge-thread" key={`${edge.childCapsuleId}-${edge.parentCapsuleId}`}>
          <span>{edge.status}</span><i /><code>{shortHash(edge.parentCapsuleId)}</code>
        </span>
      ))}
    </div>
  );
}

function SemanticOutline({ nodes, result }: { nodes: readonly AtlasNodeView[]; result: AtlasAnalysisView }) {
  const nodeById = new Map(nodes.map((node) => [node.capsuleId, node]));
  const children = new Map<string, string[]>();
  const hasResolvedParent = new Set<string>();
  for (const edge of result.edges.filter((candidate) => candidate.status === "resolved" && nodeById.has(candidate.childCapsuleId))) {
    hasResolvedParent.add(edge.childCapsuleId);
    if (nodeById.has(edge.parentCapsuleId)) children.set(edge.parentCapsuleId, [...(children.get(edge.parentCapsuleId) ?? []), edge.childCapsuleId]);
  }
  for (const value of children.values()) value.sort(rawStringCompare);
  const roots = nodes.filter((node) => !hasResolvedParent.has(node.capsuleId)).map((node) => node.capsuleId).sort(rawStringCompare);
  const shown = new Set<string>();

  function branch(id: string, path: ReadonlySet<string>): ReactNode {
    const node = nodeById.get(id);
    if (!node) return null;
    shown.add(id);
    const cycle = path.has(id);
    const nextPath = new Set(path).add(id);
    const edges = result.edges
      .filter((edge) => edge.childCapsuleId === id)
      .sort((left, right) => rawStringCompare(left.parentCapsuleId, right.parentCapsuleId));
    const descendants = cycle ? [] : [...new Set(children.get(id) ?? [])];
    return (
      <li key={`${id}-${path.size}`}>
        <span>Capsule {id}. {relationLabel(node, result.edges, new Set(result.cycles.flatMap((entry) => entry.capsuleIds)))}. Declared relation {node.relation}.</span>
        {edges.length > 0 ? <ol aria-label={`Declared parents for ${id}`}>{edges.map((edge) => (
          <li key={`${id}-${edge.parentCapsuleId}`}>{edge.status === "resolved" ? "Resolved parent" : "Parent not loaded"}: {edge.parentCapsuleId}. Key relationship {edge.keyRelationship}.</li>
        ))}</ol> : null}
        {cycle ? <span>Declared cycle returns to capsule {id}.</span> : null}
        {descendants.length > 0 ? <ol aria-label={`Resolved descendants of ${id}`}>{descendants.map((child) => branch(child, nextPath))}</ol> : null}
      </li>
    );
  }

  const initial = roots.map((root) => branch(root, new Set()));
  const remainder: ReactNode[] = [];
  for (const node of [...nodes].sort((left, right) => rawStringCompare(left.capsuleId, right.capsuleId))) {
    if (!shown.has(node.capsuleId)) remainder.push(branch(node.capsuleId, new Set()));
  }
  return <ol className={styles.semanticOutline} aria-label="Canonical lineage outline for the map">{initial}{remainder}</ol>;
}

function OutlineTree({ nodes, result, selectedId, onSelect }: { nodes: readonly AtlasNodeView[]; result: AtlasAnalysisView; selectedId: string | null; onSelect: (id: string) => void }) {
  const nodeById = new Map(nodes.map((node) => [node.capsuleId, node]));
  const children = new Map<string, string[]>();
  const hasResolvedParent = new Set<string>();
  for (const edge of result.edges.filter((candidate) => candidate.status === "resolved")) {
    hasResolvedParent.add(edge.childCapsuleId);
    children.set(edge.parentCapsuleId, [...(children.get(edge.parentCapsuleId) ?? []), edge.childCapsuleId]);
  }
  for (const value of children.values()) value.sort(rawStringCompare);
  const roots = nodes.filter((node) => !hasResolvedParent.has(node.capsuleId)).map((node) => node.capsuleId).sort(rawStringCompare);
  const shown = new Set<string>();

  function branch(id: string, path: ReadonlySet<string>): ReactNode {
    const node = nodeById.get(id);
    if (!node) return null;
    shown.add(id);
    const cycle = path.has(id);
    const nextPath = new Set(path).add(id);
    const descendants = cycle ? [] : [...new Set(children.get(id) ?? [])];
    const missing = result.edges.some((edge) => edge.childCapsuleId === id && edge.status === "missing");
    return (
      <li key={`${id}-${path.size}`}>
        <NodeCard node={node} result={result} selected={selectedId === id} onSelect={() => onSelect(id)} />
        {cycle ? <p className={styles.truthBoundary}>Declared cycle returns to this capsule. Core validity is separate from the graph finding.</p> : null}
        {descendants.length > 0 ? <ul className={missing ? styles.missingBranch : undefined}>{descendants.map((child) => branch(child, nextPath))}</ul> : null}
      </li>
    );
  }

  const initial = roots.map((root) => branch(root, new Set()));
  const remainder: ReactNode[] = [];
  for (const node of [...nodes].sort((left, right) => rawStringCompare(left.capsuleId, right.capsuleId))) {
    if (!shown.has(node.capsuleId)) remainder.push(branch(node.capsuleId, new Set()));
  }
  return <ol className={styles.outline} aria-label="Loaded capsule lineage outline">{initial}{remainder}</ol>;
}

export function LineageAtlas({ createClient }: LineageAtlasProps = {}) {
  const factory = createClient ?? defaultClientFactory;
  const clientRef = useRef<LineageAtlasClientLike | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<PageState>({ kind: "checking" });
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<ViewMode>("outline");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState("");

  const initialize = useCallback(async () => {
    const client = factory();
    clientRef.current = client;
    try {
      const environment = await client.initialize();
      setState(environment === null ? { kind: "idle" } : { kind: "environment-error", code: environment.code });
    } catch (error) {
      setState({ kind: "environment-error", code: errorCode(error) });
    }
  }, [factory]);

  useEffect(() => {
    const client = factory();
    let active = true;
    clientRef.current = client;
    void client.initialize()
      .then((environment) => {
        if (!active) return;
        setState(environment === null ? { kind: "idle" } : { kind: "environment-error", code: environment.code });
      })
      .catch((error: unknown) => {
        if (active) setState({ kind: "environment-error", code: errorCode(error) });
      });
    return () => {
      active = false;
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, [factory]);

  useEffect(() => {
    if (state.kind === "result" || state.kind === "environment-error") resultHeadingRef.current?.focus();
  }, [state.kind]);

  const analyzeFiles = useCallback(async (files: readonly File[]) => {
    setExportStatus("");
    const selectionError = validateLineageAtlasSelection(files);
    if (selectionError !== null) {
      const detail = selectionError === "input.empty" ? "Choose at least one file, and ensure every file contains at least one byte."
        : selectionError === "input.batch-count-limit" ? `Choose at most ${MAX_FILES} files. The batch was not analyzed.`
          : selectionError === "input.size-limit" ? "Every file must be no larger than 64 MiB. The batch was not analyzed."
            : "Choose no more than 128 MiB total. Exact repeats still count before analysis.";
      setState({ kind: "input-error", code: selectionError, detail });
      return;
    }
    const client = clientRef.current;
    if (!client) {
      setState({ kind: "environment-error", code: "worker.failure" });
      return;
    }
    const stripped = files.map((file) => file.slice());
    setSelectedId(null);
    setState({ kind: "working", progress: { completed: 0, stage: "reading", total: files.length } });
    try {
      const outcome = await client.analyze(stripped, (progress) => setState((current) => current.kind === "working" ? { kind: "working", progress } : current));
      if (outcome.kind === "environment-error") {
        setState({ kind: "environment-error", code: outcome.code });
        return;
      }
      const result = adaptResult(outcome);
      if (result === null) {
        setState({ kind: "environment-error", code: "worker.failure" });
        return;
      }
      setState({ kind: "result", result });
      setSelectedId(result.nodes[0]?.capsuleId ?? null);
    } catch (error) {
      setState({ kind: "environment-error", code: errorCode(error) });
    }
  }, []);

  const clear = useCallback(() => {
    clientRef.current?.cancel();
    clientRef.current?.dispose();
    clientRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
    setSelectedId(null);
    setExportStatus("");
    setState({ kind: "checking" });
    void initialize();
  }, [initialize]);

  const result = state.kind === "result" ? state.result : null;
  const cycleIds = useMemo(() => new Set(result?.cycles.flatMap((cycle) => cycle.capsuleIds) ?? []), [result]);
  const filteredNodes = useMemo(() => {
    if (!result) return [];
    return result.nodes.filter((node) => {
      const edges = result.edges.filter((edge) => edge.childCapsuleId === node.capsuleId);
      if (filter === "resolved") return edges.some((edge) => edge.status === "resolved");
      if (filter === "missing") return edges.some((edge) => edge.status === "missing");
      if (filter === "creator") return result.domains.some((domain) => domain.capsuleId === node.capsuleId && domain.state === "valid-supported-fork");
      if (filter === "issues") return cycleIds.has(node.capsuleId) || edges.some((edge) => edge.status === "missing") || node.transportHashes.length > 1;
      return true;
    });
  }, [cycleIds, filter, result]);
  const selected = result?.nodes.find((node) => node.capsuleId === selectedId) ?? null;

  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="Lineage Atlas navigation">
        <Link className={styles.brand} href="/proof-capsule" aria-label="Back to Runbook Proof Capsule"><BrandMark /><span>Runbook</span><em>Lineage Atlas</em></Link>
        <div className={styles.navLinks}>
          <Link className={styles.backLink} href="/verify"><ArrowLeft size={14} aria-hidden="true" /><span>Capsule verifier</span></Link>
          <Link className={styles.backLink} href="/proof-capsule"><ArrowLeft size={14} aria-hidden="true" /><span>Proof Capsule</span></Link>
        </div>
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.kicker}>Local lineage workbench</span>
          <h1>Trace only what the files can <em>prove.</em></h1>
          <p>Choose up to 32 .runbook files. Runbook copies and verifies their bytes in this browser, then resolves only parent IDs backed by a loaded valid capsule.</p>
        </div>
        <aside className={styles.boundaryCard} aria-label="Local analysis boundary">
          <strong>No upload. No payload display.<br />No analytics. No publication.</strong>
          <ul><li><Check size={13} aria-hidden="true" /> 64 MiB per file</li><li><Check size={13} aria-hidden="true" /> 128 MiB per batch</li><li><Check size={13} aria-hidden="true" /> Filenames stripped</li><li><Check size={13} aria-hidden="true" /> Metadata-only result</li></ul>
          <p>Loading this page still makes ordinary requests to this site. Public release remains blocked on a reviewed isolated-origin policy.</p>
        </aside>
      </header>

      <section className={styles.intake} aria-labelledby="intake-title">
        <div className={styles.intakeHeading}>
          <div><span className={styles.sectionKicker}>Selected local bytes</span><h2 id="intake-title">Build one bounded file set</h2></div>
          <div className={styles.capability} data-state={state.kind === "environment-error" ? "error" : "ready"}>
            {state.kind === "checking" ? <LoaderCircle className={styles.spin} size={14} aria-hidden="true" /> : state.kind === "environment-error" ? <ShieldAlert size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
            {state.kind === "checking" ? "Checking browser" : state.kind === "environment-error" ? "Atlas unavailable" : "Local analyzer ready"}
          </div>
        </div>
        <div
          className={styles.fileControl}
          data-active={dragging ? "true" : "false"}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
          onDrop={(event) => { event.preventDefault(); setDragging(false); if (state.kind !== "checking" && state.kind !== "working" && state.kind !== "environment-error") void analyzeFiles([...event.dataTransfer.files]); }}
        >
          <FileArchive size={25} aria-hidden="true" />
          <div><strong>Choose a local .runbook file set</strong><span>1–32 files · 64 MiB each · 128 MiB aggregate · analyzed atomically</span></div>
          <input
            ref={inputRef}
            id="lineage-files"
            className={styles.fileInput}
            type="file"
            multiple
            accept=".runbook,application/vnd.runbook.proof+zip"
            disabled={state.kind === "checking" || state.kind === "working" || state.kind === "environment-error"}
            onChange={(event) => void analyzeFiles([...(event.target.files ?? [])])}
          />
          <label className={styles.chooseButton} htmlFor="lineage-files"><Plus size={14} aria-hidden="true" /> Choose .runbook files</label>
        </div>

        {state.kind === "input-error" ? <div className={styles.preflightError} role="alert"><CircleAlert size={18} aria-hidden="true" /><div><strong>File set not analyzed</strong><span>{state.detail} · {state.code}</span></div></div> : null}
        {state.kind === "environment-error" ? <div className={styles.environmentError} role="alert"><ShieldAlert size={18} aria-hidden="true" /><div><strong>Environment — no lineage verdict</strong><span>{environmentCopy[state.code] ?? environmentCopy["worker.failure"]} · {state.code}</span></div></div> : null}
        {state.kind === "working" ? <div className={styles.progress} role="status" aria-live="polite"><strong>{stageLabel(state.progress)}</strong><span>Files remain in this tab. Invalid files cannot create lineage edges.</span><div className={styles.progressTrack} aria-hidden="true"><i style={{ width: `${Math.max(4, (state.progress.completed / Math.max(1, state.progress.total)) * 100)}%` }} /></div></div> : null}
      </section>

      <section className={styles.result} aria-labelledby="atlas-result-title">
        <div className={styles.summary}>
          <div>
            <span>Atomic analysis result</span>
            <h2 ref={resultHeadingRef} id="atlas-result-title" tabIndex={-1}>{result ? (result.artifacts.some((artifact) => artifact.coreStatus === "invalid") || result.identityConflictIds.length > 0 ? "Atlas built with exclusions" : "Atlas ready") : state.kind === "environment-error" ? "No completed atlas" : "No local file set"}</h2>
            <p>{result ? "These counts describe this selected file set, not a complete public history." : state.kind === "environment-error" ? "Resolve the environment error before choosing the files again." : "Choose capsules above. Nothing has been analyzed."}</p>
          </div>
          <div className={styles.counts} aria-label="Atlas counts">
            <div><span>Transports</span><strong>{result?.artifacts.length ?? "—"}</strong></div>
            <div><span>Valid capsule IDs</span><strong>{result?.nodes.length ?? "—"}</strong></div>
            <div><span>Resolved edges</span><strong>{result?.edges.filter((edge) => edge.status === "resolved").length ?? "—"}</strong></div>
            <div><span>Missing declarations</span><strong>{result?.edges.filter((edge) => edge.status === "missing").length ?? "—"}</strong></div>
          </div>
        </div>

        {result ? <>
          <div className={styles.viewBar}>
            <div className={styles.tabs} aria-label="Atlas view">
              {(["map", "outline", "exclusions"] as const).map((mode) => <button key={mode} className={styles.tabButton} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === "map" ? "Map" : mode === "outline" ? "Outline" : "Exclusions"}</button>)}
            </div>
            <div className={styles.viewActions}>
              <button className={styles.secondaryButton} type="button" onClick={() => { if (inputRef.current) { inputRef.current.value = ""; inputRef.current.click(); } }}><Plus size={14} aria-hidden="true" /> Replace file set</button>
              <button className={styles.secondaryButton} type="button" onClick={clear}><RotateCcw size={14} aria-hidden="true" /> Clear local set</button>
            </div>
          </div>
          <div className={styles.legend} aria-label="Lineage legend"><strong>Position shows declared ancestry, not time, identity, influence, or completeness.</strong><span><i /> Loaded valid edge</span><span><i className={styles.missingKey} /> Parent not loaded</span><span><i className={styles.keyMark} /> Same self-asserted key</span></div>

          <div className={styles.workspace}>
            <aside className={styles.rail} aria-label="Atlas filters"><div className={styles.railTitle}>Filter local evidence</div><div>
              {(["all", "resolved", "missing", "creator", "issues"] as const).map((value) => <button key={value} className={styles.filterButton} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}><span>{value === "all" ? "All capsules" : value === "resolved" ? "Resolved" : value === "missing" ? "Parent missing" : value === "creator" ? "Creator Proof" : "Graph issues"}</span><span>{value === "all" ? result.nodes.length : value === "resolved" ? result.edges.filter((edge) => edge.status === "resolved").length : value === "missing" ? result.edges.filter((edge) => edge.status === "missing").length : value === "creator" ? result.domains.filter((domain) => domain.state === "valid-supported-fork").length : result.cycles.length + result.identityConflictIds.length + result.nodes.filter((node) => node.transportHashes.length > 1).length}</span></button>)}
            </div></aside>

            <section className={styles.canvas} aria-labelledby="canvas-title">
              <div className={styles.canvasHeader}><strong id="canvas-title">Broken binding thread</strong><span>{filteredNodes.length} of {result.nodes.length} capsule IDs shown</span></div>
              {view === "map" ? <>
                <div className={styles.map} aria-label="Interactive deterministic lineage map">
                  <div className={styles.mapColumns}>{computeGenerations(filteredNodes, result.edges).map(([generation, nodes]) => <div className={styles.generation} key={generation}><span className={styles.generationLabel}>Declared depth {generation}</span>{nodes.map((node) => <div className={styles.nodeWrap} key={node.capsuleId}><EdgeBundle node={node} result={result} /><NodeCard node={node} result={result} selected={selectedId === node.capsuleId} onSelect={() => setSelectedId(node.capsuleId)} /></div>)}</div>)}</div>
                </div>
                <SemanticOutline nodes={filteredNodes} result={result} />
              </> : null}
              {view === "outline" ? <div className={styles.outlineView}><OutlineTree nodes={filteredNodes} result={result} selectedId={selectedId} onSelect={setSelectedId} /></div> : null}
              {view === "exclusions" ? <div className={styles.outline}><p className={styles.truthBoundary}>Invalid transports never create nodes or satisfy declared parents. Review exact core error codes in Exclusions below.</p></div> : null}
            </section>

            <aside className={styles.inspector} aria-labelledby="inspector-title">
              <div className={styles.inspectorTitle}><div><span>Metadata inspector</span><h2 id="inspector-title">Selected capsule</h2></div><GitBranch size={18} aria-hidden="true" /></div>
              <div className={styles.inspectorBody}>{selected ? <SelectedInspector node={selected} result={result} /> : <div className={styles.emptyInspector}><GitBranch size={24} aria-hidden="true" /><strong>No capsule selected</strong><span>Choose a receipt leaf in the map or semantic outline.</span></div>}</div>
            </aside>
          </div>

          <section className={styles.quarantine} aria-labelledby="exclusions-title">
            <div className={styles.quarantineHeading}><div><span className={styles.sectionKicker}>No lineage authority</span><h2 id="exclusions-title">Exclusions and graph findings</h2></div><Ban size={19} aria-hidden="true" /></div>
            <div className={styles.quarantineList}>
              {result.artifacts.filter((artifact) => artifact.coreStatus === "invalid").map((artifact) => <article className={styles.quarantineItem} key={artifact.archiveSha256}><span>Capsule invalid · excluded from graph</span><strong>{formatBytes(artifact.bytes)} local transport</strong><code>Archive {shortHash(artifact.archiveSha256)}<br />{artifact.coreErrorCodes.join(" · ") || "core verification failed"}</code></article>)}
              {result.duplicateSelectionCount > 0 ? <article className={styles.quarantineItem}><span>Same archive SHA-256 repeated</span><strong>Analyzed once · {result.duplicateSelectionCount} repeated selection{result.duplicateSelectionCount === 1 ? "" : "s"}</strong><code>Repeat count is local-only and is not exported.</code></article> : null}
              {result.nodes.filter((node) => node.transportHashes.length > 1).map((node) => <article className={styles.quarantineItem} key={`alias-${node.capsuleId}`}><span>One capsule ID · multiple valid archives</span><strong>One lineage node · {node.transportHashes.length} transport hashes</strong><code>{shortHash(node.capsuleId)}<br />Full transport hashes appear in the selected capsule inspector.</code></article>)}
              {result.identityConflictIds.map((capsuleId) => <article className={styles.quarantineItem} key={`conflict-${capsuleId}`}><span>Capsule-ID conflict · withheld</span><strong>No node or edge authority was granted.</strong><code>{shortHash(capsuleId)}<br />Valid transports disagreed on signed key or lineage metadata.</code></article>)}
              {result.cycles.map((cycle) => <article className={styles.quarantineItem} key={`cycle-${cycle.capsuleIds.join("-")}`}><span>Declared cycle</span><strong>{cycle.capsuleIds.length} core-valid capsules affected</strong><code>Core validity remains separate.<br />{cycle.capsuleIds.map(shortHash).join(" · ")}</code></article>)}
              {result.artifacts.every((artifact) => artifact.coreStatus === "valid") && result.duplicateSelectionCount === 0 && result.nodes.every((node) => node.transportHashes.length === 1) && result.cycles.length === 0 && result.identityConflictIds.length === 0 ? <article className={styles.quarantineItem}><span>No exclusions or graph issues</span><strong>All selected unique transports were core-valid.</strong><code>Missing parents, if any, remain open-world warnings.</code></article> : null}
            </div>
          </section>

          <section className={styles.exportPanel} aria-labelledby="export-title">
            <span>Manual local authority</span><h2 id="export-title">Export what this batch established</h2>
            <p>The exact receipt and readable research packet contain deterministic metadata only: transport digests, core statuses, valid capsule and self-asserted key IDs, declared relations, graph findings, and limitations. They exclude filenames and payload or member bytes.</p>
            <div className={styles.exportWarning}><strong>This unsigned local-analysis export is metadata-only, but hashes, capsule IDs, self-asserted key IDs, and lineage can still correlate artifacts.</strong><span>It is not an author signature, trusted timestamp, complete history, or independent attestation. Review it before moving it outside this browser.</span></div>
            <div className={styles.exportActions}>
              <button className={styles.primaryButton} type="button" onClick={() => { downloadBytes(result.receiptBytes, "runbook-lineage-receipt.json", "application/json"); setExportStatus("Exact lineage receipt downloaded locally. Nothing was published or submitted."); }}><Download size={14} aria-hidden="true" /> Download exact lineage receipt</button>
              <button className={styles.secondaryButton} type="button" onClick={() => { downloadBytes(result.researchPacketBytes, "runbook-lineage-research.txt", "text/plain;charset=utf-8"); setExportStatus("Local research packet downloaded. Nothing was published or submitted."); }}><Download size={14} aria-hidden="true" /> Download local research packet</button>
            </div>
            <p className={styles.exportStatus} role="status" aria-live="polite">{exportStatus}</p>
          </section>

          <section className={styles.manualNext} aria-labelledby="manual-next-title"><h2 id="manual-next-title">Take it outward only if you choose.</h2><p>Review the capsule and receipt before publishing. Portable content, digests, key IDs, and parent IDs can correlate artifacts. <strong>Runbook has not uploaded, submitted, posted, or attributed anything.</strong></p></section>
        </> : null}
      </section>
    </main>
  );
}

function SelectedInspector({ node, result }: { node: AtlasNodeView; result: AtlasAnalysisView }) {
  const nodeEdges = result.edges.filter((edge) => edge.childCapsuleId === node.capsuleId);
  const missing = nodeEdges.filter((edge) => edge.status === "missing");
  const resolved = nodeEdges.filter((edge) => edge.status === "resolved");
  const keyGroupSize = result.nodes.filter((candidate) => candidate.authorKeyId === node.authorKeyId).length;
  const domain = result.domains.find((candidate) => candidate.capsuleId === node.capsuleId)?.state ?? "not-evaluated";
  const cycle = result.cycles.some((candidate) => candidate.capsuleIds.includes(node.capsuleId));
  const tone = missing.length > 0 || cycle || domain === "invalid-supported-fork" ? "warning" : "normal";
  return <>
    <div className={styles.detailState} data-tone={tone}>{cycle ? "Declared cycle · core validity is separate" : relationLabel(node, result.edges, new Set())}</div>
    <dl className={styles.detailList}>
      <div><dt>Capsule ID</dt><dd>{node.capsuleId}</dd></div>
      <div><dt>Declared relation</dt><dd>{node.relation}</dd></div>
      <div><dt>Loaded parent checks</dt><dd>{resolved.length} resolved · {missing.length} not loaded</dd></div>
      {missing.length > 0 ? <div><dt>Parent not loaded</dt><dd>This valid capsule declares {missing.map((edge) => edge.parentCapsuleId).join(", ")} as a parent, but no loaded valid capsule computes to that ID. The declaration is unresolved—not false.</dd></div> : null}
      <div><dt>Self-asserted key</dt><dd>{node.authorKeyId}<br />{keyGroupSize > 1 ? `Same self-asserted key as ${keyGroupSize - 1} other loaded capsule${keyGroupSize === 2 ? "" : "s"}.` : "No other loaded capsule uses this self-asserted key."}</dd></div>
      <div><dt>Transport layer</dt><dd>{node.transportHashes.length === 1 ? "One core-valid archive transport." : `${node.transportHashes.length} independently core-valid archive transports share this capsule ID.`}<br />{node.transportHashes.join("\n")}</dd></div>
      <div><dt>Creator Proof domain</dt><dd>{domainLabel(domain)}</dd></div>
    </dl>
    <div className={styles.truthBoundary}><strong>A valid edge is a narrow fact.</strong>It proves that this loaded valid child declares a loaded valid capsule ID. It does not prove identity, control, continuity, consent, common authorship, time, broker activity, performance, completeness, influence, or acceptance of a correction.</div>
    {node.capsuleId === CREATOR_SEED_CAPSULE_ID ? <p className={styles.truthBoundary}><strong>Synthetic authoring eligibility</strong>The exact frozen seed is eligible for one isolated one-rule authoring workflow. No signer origin is configured in this Atlas preview, so no archive bytes or Atlas state can be transferred.</p> : domain === "valid-supported-fork" ? <p className={styles.truthBoundary}><strong>Supported synthetic child</strong>The current signer can create another child from the frozen seed; it cannot fork this arbitrary child.</p> : <p className={styles.truthBoundary}><strong>No compatible local authoring workflow</strong>This capsule cannot be handed to the fixed synthetic signer.</p>}
  </>;
}
