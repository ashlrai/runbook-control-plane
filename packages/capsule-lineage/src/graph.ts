import { rawStringCompare } from "./jcs.js";
import {
  LINEAGE_ANALYSIS_SCHEMA,
  LINEAGE_VERIFIER_PROFILE,
  type LineageAnalysisReceipt,
  type LineageCycle,
  type LineageEdge,
  type LineageErrorFinding,
  type LineageKeyGroup,
  type LineageNode,
  type LineageRelation,
  type LineageWarningFinding,
  type VerifiedTransportMetadata,
} from "./types.js";

const LIMITATIONS = [
  "receipt-is-unsigned-local-analysis",
  "selected-set-does-not-prove-complete-history",
  "declared-lineage-does-not-prove-parent-consent-causality-or-correctness",
  "shared-self-asserted-key-does-not-prove-identity-control-continuity-or-common-authorship",
  "correction-or-supersession-does-not-revoke-or-erase",
  "analysis-does-not-prove-independent-time-broker-activity-performance-skill-suitability-or-compliance",
  "metadata-hashes-capsule-ids-key-ids-and-lineage-can-correlate-artifacts",
] as const;

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function findingKey(value: LineageErrorFinding | LineageWarningFinding) {
  if (value.code === "lineage.cycle") return `${value.code}\0${value.capsuleIds.join("\0")}`;
  if (value.code === "lineage.identity-conflict") return `${value.code}\0${value.capsuleId}`;
  if (value.code === "lineage.parent-missing") return `${value.code}\0${value.childCapsuleId}\0${value.parentCapsuleId}`;
  return `${value.code}\0${value.capsuleId}\0${value.transportSha256.join("\0")}`;
}

/** Deterministically derives all resolved strongly connected components. */
export function findLineageCycles(nodes: readonly LineageNode[], edges: readonly LineageEdge[]): LineageCycle[] {
  const adjacency = new Map(nodes.map((node) => [node.capsuleId, [] as string[]]));
  const reverse = new Map(nodes.map((node) => [node.capsuleId, [] as string[]]));
  for (const edge of edges) {
    if (edge.status === "resolved") {
      adjacency.get(edge.childCapsuleId)?.push(edge.parentCapsuleId);
      reverse.get(edge.parentCapsuleId)?.push(edge.childCapsuleId);
    }
  }
  for (const targets of adjacency.values()) targets.sort(rawStringCompare);
  for (const sources of reverse.values()) sources.sort(rawStringCompare);

  // Iterative Kosaraju traversal: graph size is capped at 32 nodes and 256
  // edges, and no hostile input can consume the JavaScript call stack.
  const visited = new Set<string>();
  const finishOrder: string[] = [];
  for (const node of nodes) {
    if (visited.has(node.capsuleId)) continue;
    visited.add(node.capsuleId);
    const frames = [{ id: node.capsuleId, next: 0 }];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1] as { id: string; next: number };
      const targets = adjacency.get(frame.id) ?? [];
      const target = targets[frame.next];
      if (target !== undefined) {
        frame.next += 1;
        if (!visited.has(target)) {
          visited.add(target);
          frames.push({ id: target, next: 0 });
        }
      } else {
        finishOrder.push(frame.id);
        frames.pop();
      }
    }
  }

  const assigned = new Set<string>();
  const cycles: LineageCycle[] = [];
  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const start = finishOrder[index] as string;
    if (assigned.has(start)) continue;
    assigned.add(start);
    const stack = [start];
    const component: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      component.push(current);
      const sources = reverse.get(current) ?? [];
      for (let sourceIndex = sources.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
        const source = sources[sourceIndex] as string;
        if (!assigned.has(source)) {
          assigned.add(source);
          stack.push(source);
        }
      }
    }
    component.sort(rawStringCompare);
    const only = component[0] as string;
    const selfLoop = component.length === 1 && (adjacency.get(only) ?? []).includes(only);
    if (component.length > 1 || selfLoop) cycles.push({ capsuleIds: component });
  }
  return cycles.sort((left, right) => rawStringCompare(left.capsuleIds.join("\0"), right.capsuleIds.join("\0")));
}

/** Internal graph constructor. Production callers enter through raw archives only. */
export function buildLineageReceipt(transports: readonly VerifiedTransportMetadata[]): LineageAnalysisReceipt {
  const artifacts = [...transports]
    .sort((left, right) => rawStringCompare(left.archiveSha256, right.archiveSha256))
    .map((transport) => Object.freeze({
      archiveSha256: transport.archiveSha256,
      authorKeyId: transport.coreValid ? transport.authorKeyId : null,
      byteLength: transport.byteLength,
      capsuleId: transport.coreValid ? transport.capsuleId : null,
      coreErrorCodes: Object.freeze([...new Set(transport.coreErrorCodes)].sort(rawStringCompare)),
      coreReceiptSha256: transport.coreReceiptSha256,
      coreStatus: transport.coreValid ? "valid" as const : "invalid" as const,
      parents: Object.freeze(transport.coreValid ? [...transport.parents].sort(rawStringCompare) : []),
      relation: transport.coreValid ? transport.relation : null,
    }));

  const byCapsule = new Map<string, VerifiedTransportMetadata[]>();
  for (const transport of transports) {
    if (!transport.coreValid || transport.capsuleId === null || transport.authorKeyId === null || transport.relation === null) continue;
    const group = byCapsule.get(transport.capsuleId) ?? [];
    group.push(transport);
    byCapsule.set(transport.capsuleId, group);
  }

  const errors: LineageErrorFinding[] = [];
  const warnings: LineageWarningFinding[] = [];
  const nodes: LineageNode[] = [];
  const conflicts = new Set<string>();
  for (const [capsuleId, group] of [...byCapsule.entries()].sort(([left], [right]) => rawStringCompare(left, right))) {
    const first = group[0] as VerifiedTransportMetadata;
    const conflict = group.some((candidate) => candidate.authorKeyId !== first.authorKeyId
      || candidate.relation !== first.relation || !sameStrings(candidate.parents, first.parents));
    const transportSha256 = group.map((candidate) => candidate.archiveSha256).sort(rawStringCompare);
    if (transportSha256.length > 1) warnings.push({ capsuleId, code: "lineage.transport-alias", transportSha256 });
    if (conflict) {
      conflicts.add(capsuleId);
      errors.push({ capsuleId, code: "lineage.identity-conflict" });
      continue;
    }
    nodes.push({
      authorKeyId: first.authorKeyId as string,
      capsuleId,
      parents: [...first.parents].sort(rawStringCompare),
      relation: first.relation as LineageRelation,
      transportSha256,
    });
  }

  const nodeById = new Map(nodes.map((node) => [node.capsuleId, node]));
  const edges: LineageEdge[] = [];
  for (const child of nodes) {
    if (child.relation === "root") continue;
    for (const parentCapsuleId of child.parents) {
      const parent = nodeById.get(parentCapsuleId);
      const status = parent === undefined || conflicts.has(parentCapsuleId) ? "missing" as const : "resolved" as const;
      const keyRelationship = parent === undefined
        ? "not-evaluated" as const
        : child.authorKeyId === parent.authorKeyId
          ? "same-self-asserted-key" as const
          : "different-self-asserted-key" as const;
      edges.push({ childCapsuleId: child.capsuleId, keyRelationship, parentCapsuleId, relation: child.relation, status });
      if (status === "missing") warnings.push({ childCapsuleId: child.capsuleId, code: "lineage.parent-missing", parentCapsuleId });
    }
  }
  edges.sort((left, right) => rawStringCompare(left.childCapsuleId, right.childCapsuleId)
    || rawStringCompare(left.parentCapsuleId, right.parentCapsuleId));

  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    const group = groups.get(node.authorKeyId) ?? [];
    group.push(node.capsuleId);
    groups.set(node.authorKeyId, group);
  }
  const keyGroups: LineageKeyGroup[] = [...groups.entries()]
    .sort(([left], [right]) => rawStringCompare(left, right))
    .map(([authorKeyId, capsuleIds]) => ({ authorKeyId, capsuleIds: capsuleIds.sort(rawStringCompare) }));

  const cycles = findLineageCycles(nodes, edges);
  for (const cycle of cycles) errors.push({ capsuleIds: cycle.capsuleIds, code: "lineage.cycle" });
  errors.sort((left, right) => rawStringCompare(findingKey(left), findingKey(right)));
  warnings.sort((left, right) => rawStringCompare(findingKey(left), findingKey(right)));

  const receipt: LineageAnalysisReceipt = {
    analysisComplete: true,
    artifacts,
    counts: {
      capsuleNodes: nodes.length,
      coreInvalidArtifacts: artifacts.filter((artifact) => artifact.coreStatus === "invalid").length,
      coreValidArtifacts: artifacts.filter((artifact) => artifact.coreStatus === "valid").length,
      cycleComponents: cycles.length,
      identityConflicts: conflicts.size,
      keyGroups: keyGroups.length,
      missingEdges: edges.filter((edge) => edge.status === "missing").length,
      resolvedEdges: edges.filter((edge) => edge.status === "resolved").length,
      transportAliases: warnings.filter((finding) => finding.code === "lineage.transport-alias").length,
      uniqueTransports: artifacts.length,
    },
    cycles,
    edges,
    findings: { errors, warnings },
    keyGroups,
    limitations: LIMITATIONS,
    nodes,
    schemaVersion: LINEAGE_ANALYSIS_SCHEMA,
    verifierProfile: LINEAGE_VERIFIER_PROFILE,
  };
  return receipt;
}
