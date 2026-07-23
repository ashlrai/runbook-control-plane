// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LineageAtlasOutcome } from "../lib/lineage-atlas-client";
import {
  LineageAtlas,
  type LineageAtlasClientLike,
} from "./lineage-atlas";

const ROOT = "1".repeat(64);
const CHILD = "2".repeat(64);
const MISSING = "3".repeat(64);
const CYCLE_A = "4".repeat(64);
const CYCLE_B = "5".repeat(64);
const DIAMOND_ROOT = "6".repeat(64);
const DIAMOND_LEFT = "7".repeat(64);
const DIAMOND_RIGHT = "8".repeat(64);
const DIAMOND_JOIN = "9".repeat(64);
const KEY_A = `sha256:${"a".repeat(64)}`;
const KEY_B = `sha256:${"b".repeat(64)}`;

function arrayBuffer(text: string) {
  return new TextEncoder().encode(text).buffer;
}

function analysisOutcome(): LineageAtlasOutcome {
  return {
    kind: "result",
    requestId: 2,
    duplicateSelectionCount: 1,
    receipt: {
      analysisComplete: true,
      schemaVersion: "runbook.proof-lineage-analysis.v1",
      verifierProfile: "runbook.proof-capsule.v1",
      artifacts: [
        { archiveSha256: "a".repeat(64), byteLength: 4012, coreErrorCodes: [], coreReceiptSha256: "c".repeat(64), coreStatus: "valid", capsuleId: ROOT, authorKeyId: KEY_A, parents: [], relation: "root" },
        { archiveSha256: "b".repeat(64), byteLength: 4300, coreErrorCodes: [], coreReceiptSha256: "d".repeat(64), coreStatus: "valid", capsuleId: CHILD, authorKeyId: KEY_A, parents: [ROOT, MISSING], relation: "derived" },
        { archiveSha256: "e".repeat(64), byteLength: 4400, coreErrorCodes: [], coreReceiptSha256: "f".repeat(64), coreStatus: "valid", capsuleId: CYCLE_A, authorKeyId: KEY_B, parents: [CYCLE_B], relation: "corrects" },
        { archiveSha256: "6".repeat(64), byteLength: 4500, coreErrorCodes: [], coreReceiptSha256: "7".repeat(64), coreStatus: "valid", capsuleId: CYCLE_B, authorKeyId: KEY_B, parents: [CYCLE_A], relation: "supersedes" },
        { archiveSha256: "8".repeat(64), byteLength: 99, coreErrorCodes: ["payload.digest-mismatch"], coreReceiptSha256: "9".repeat(64), coreStatus: "invalid", capsuleId: null, authorKeyId: null, parents: [], relation: null },
      ],
      nodes: [
        { authorKeyId: KEY_A, capsuleId: ROOT, parents: [], relation: "root", transportSha256: ["a".repeat(64)] },
        { authorKeyId: KEY_A, capsuleId: CHILD, parents: [ROOT, MISSING], relation: "derived", transportSha256: ["0".repeat(64), "b".repeat(64)] },
        { authorKeyId: KEY_B, capsuleId: CYCLE_A, parents: [CYCLE_B], relation: "corrects", transportSha256: ["e".repeat(64)] },
        { authorKeyId: KEY_B, capsuleId: CYCLE_B, parents: [CYCLE_A], relation: "supersedes", transportSha256: ["6".repeat(64)] },
      ],
      edges: [
        { childCapsuleId: CHILD, keyRelationship: "same-self-asserted-key", parentCapsuleId: ROOT, relation: "derived", status: "resolved" },
        { childCapsuleId: CHILD, keyRelationship: "not-evaluated", parentCapsuleId: MISSING, relation: "derived", status: "missing" },
        { childCapsuleId: CYCLE_A, keyRelationship: "same-self-asserted-key", parentCapsuleId: CYCLE_B, relation: "corrects", status: "resolved" },
        { childCapsuleId: CYCLE_B, keyRelationship: "same-self-asserted-key", parentCapsuleId: CYCLE_A, relation: "supersedes", status: "resolved" },
      ],
      keyGroups: [{ authorKeyId: KEY_A, capsuleIds: [ROOT, CHILD] }, { authorKeyId: KEY_B, capsuleIds: [CYCLE_A, CYCLE_B] }],
      cycles: [{ capsuleIds: [CYCLE_A, CYCLE_B] }],
      findings: {
        errors: [{ code: "lineage.cycle", capsuleIds: [CYCLE_A, CYCLE_B] }],
        warnings: [
          { childCapsuleId: CHILD, code: "lineage.parent-missing", parentCapsuleId: MISSING },
          { capsuleId: CHILD, code: "lineage.transport-alias", transportSha256: ["0".repeat(64), "b".repeat(64)] },
        ],
      },
      counts: { capsuleNodes: 4, coreInvalidArtifacts: 1, coreValidArtifacts: 4, cycleComponents: 1, identityConflicts: 0, keyGroups: 2, missingEdges: 1, resolvedEdges: 3, transportAliases: 1, uniqueTransports: 5 },
      limitations: [
        "receipt-is-unsigned-local-analysis",
        "selected-set-does-not-prove-complete-history",
        "declared-lineage-does-not-prove-parent-consent-causality-or-correctness",
        "shared-self-asserted-key-does-not-prove-identity-control-continuity-or-common-authorship",
        "correction-or-supersession-does-not-revoke-or-erase",
        "analysis-does-not-prove-independent-time-broker-activity-performance-skill-suitability-or-compliance",
        "metadata-hashes-capsule-ids-key-ids-and-lineage-can-correlate-artifacts",
      ],
    },
    receiptBytes: arrayBuffer('{"analysisComplete":true}'),
    researchPacketBytes: arrayBuffer("RUNBOOK LOCAL LINEAGE RESEARCH PACKET"),
    creatorDomainResults: [{
      receipt: {
        checks: { childCoreValid: true, childNamesExactParent: true, exactOneAllowedRuleChanged: true, fixedSyntheticProfile: true, parentCoreValid: true, policyDeltaRecomputed: true },
        childCapsuleId: CHILD,
        changedRule: { from: 2, path: "policy.maxDailyProposals", reasonCode: "reduce-action-frequency", to: 1 },
        limitations: ["domain-check-does-not-prove-parent-consent", "domain-check-does-not-prove-common-authorship", "domain-check-does-not-prove-broker-activity", "domain-check-does-not-prove-identity-performance-skill-suitability-or-compliance"],
        parentCapsuleId: ROOT,
        schemaVersion: "runbook.creator-fork-verification.v1",
        valid: true,
      },
      receiptBytes: arrayBuffer('{"schemaVersion":"runbook.creator-fork-verification.v1"}'),
    }],
  };
}

function diamondOutcome(): LineageAtlasOutcome {
  return {
    kind: "result",
    requestId: 3,
    duplicateSelectionCount: 0,
    receipt: {
      analysisComplete: true,
      schemaVersion: "runbook.proof-lineage-analysis.v1",
      verifierProfile: "runbook.proof-capsule.v1",
      artifacts: [
        { archiveSha256: "6".repeat(64), byteLength: 1000, coreErrorCodes: [], coreReceiptSha256: "a".repeat(64), coreStatus: "valid", capsuleId: DIAMOND_ROOT, authorKeyId: KEY_A, parents: [], relation: "root" },
        { archiveSha256: "7".repeat(64), byteLength: 1001, coreErrorCodes: [], coreReceiptSha256: "b".repeat(64), coreStatus: "valid", capsuleId: DIAMOND_LEFT, authorKeyId: KEY_A, parents: [DIAMOND_ROOT], relation: "derived" },
        { archiveSha256: "8".repeat(64), byteLength: 1002, coreErrorCodes: [], coreReceiptSha256: "c".repeat(64), coreStatus: "valid", capsuleId: DIAMOND_RIGHT, authorKeyId: KEY_A, parents: [DIAMOND_ROOT], relation: "derived" },
        { archiveSha256: "9".repeat(64), byteLength: 1003, coreErrorCodes: [], coreReceiptSha256: "d".repeat(64), coreStatus: "valid", capsuleId: DIAMOND_JOIN, authorKeyId: KEY_A, parents: [DIAMOND_LEFT, DIAMOND_RIGHT], relation: "derived" },
      ],
      nodes: [
        { authorKeyId: KEY_A, capsuleId: DIAMOND_ROOT, parents: [], relation: "root", transportSha256: ["6".repeat(64)] },
        { authorKeyId: KEY_A, capsuleId: DIAMOND_LEFT, parents: [DIAMOND_ROOT], relation: "derived", transportSha256: ["7".repeat(64)] },
        { authorKeyId: KEY_A, capsuleId: DIAMOND_RIGHT, parents: [DIAMOND_ROOT], relation: "derived", transportSha256: ["8".repeat(64)] },
        { authorKeyId: KEY_A, capsuleId: DIAMOND_JOIN, parents: [DIAMOND_LEFT, DIAMOND_RIGHT], relation: "derived", transportSha256: ["9".repeat(64)] },
      ],
      edges: [
        { childCapsuleId: DIAMOND_LEFT, keyRelationship: "same-self-asserted-key", parentCapsuleId: DIAMOND_ROOT, relation: "derived", status: "resolved" },
        { childCapsuleId: DIAMOND_RIGHT, keyRelationship: "same-self-asserted-key", parentCapsuleId: DIAMOND_ROOT, relation: "derived", status: "resolved" },
        { childCapsuleId: DIAMOND_JOIN, keyRelationship: "same-self-asserted-key", parentCapsuleId: DIAMOND_LEFT, relation: "derived", status: "resolved" },
        { childCapsuleId: DIAMOND_JOIN, keyRelationship: "same-self-asserted-key", parentCapsuleId: DIAMOND_RIGHT, relation: "derived", status: "resolved" },
      ],
      keyGroups: [{ authorKeyId: KEY_A, capsuleIds: [DIAMOND_ROOT, DIAMOND_LEFT, DIAMOND_RIGHT, DIAMOND_JOIN] }],
      cycles: [],
      findings: { errors: [], warnings: [] },
      counts: { capsuleNodes: 4, coreInvalidArtifacts: 0, coreValidArtifacts: 4, cycleComponents: 0, identityConflicts: 0, keyGroups: 1, missingEdges: 0, resolvedEdges: 4, transportAliases: 0, uniqueTransports: 4 },
      limitations: [
        "receipt-is-unsigned-local-analysis",
        "selected-set-does-not-prove-complete-history",
        "declared-lineage-does-not-prove-parent-consent-causality-or-correctness",
        "shared-self-asserted-key-does-not-prove-identity-control-continuity-or-common-authorship",
        "correction-or-supersession-does-not-revoke-or-erase",
        "analysis-does-not-prove-independent-time-broker-activity-performance-skill-suitability-or-compliance",
        "metadata-hashes-capsule-ids-key-ids-and-lineage-can-correlate-artifacts",
      ],
    },
    receiptBytes: arrayBuffer('{"analysisComplete":true}'),
    researchPacketBytes: arrayBuffer("RUNBOOK LOCAL LINEAGE RESEARCH PACKET"),
    creatorDomainResults: [],
  };
}

function mockClient(result = analysisOutcome()) {
  const blobs: Blob[][] = [];
  const client: LineageAtlasClientLike = {
    initialize: vi.fn().mockResolvedValue(null),
    analyze: vi.fn(async (selected, onProgress) => {
      blobs.push([...selected]);
      onProgress?.({ completed: 1, stage: "verifying", total: selected.length });
      return result;
    }),
    cancel: vi.fn(),
    dispose: vi.fn(),
  };
  return { blobs, client, createClient: () => client };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Local Lineage Atlas", () => {
  it("renders the exact local boundary in the idle state without publication authority", async () => {
    const mock = mockClient();
    render(<LineageAtlas createClient={mock.createClient} />);

    await screen.findByText("Local analyzer ready");
    expect(screen.getByRole("heading", { name: /Trace only what the files can prove/i })).toBeTruthy();
    expect(screen.getByText(/No upload. No payload display/i)).toBeTruthy();
    expect(screen.getByText(/Loading this page still makes ordinary requests/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "No local file set" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /share|post|publish|submit/i })).toBeNull();
  });

  it("shows valid, missing, excluded, repeat, alternate-transport, and cycle states without upgrading their meaning", async () => {
    const mock = mockClient();
    render(<LineageAtlas createClient={mock.createClient} />);
    await screen.findByText("Local analyzer ready");

    const filenameSentinel = "PRIVATE-client-name-<script>alert(1)</script>.runbook";
    const payloadSentinel = "<script>PAYLOAD_HTML_MUST_NEVER_RENDER</script>";
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([payloadSentinel], filenameSentinel)] } });

    await screen.findByRole("heading", { name: "Atlas built with exclusions" });
    expect(mock.blobs).toHaveLength(1);
    expect(mock.blobs[0]).toHaveLength(1);
    expect(mock.blobs[0]?.[0]).toBeInstanceOf(Blob);
    expect(mock.blobs[0]?.[0]).not.toBeInstanceOf(File);
    expect("name" in (mock.blobs[0]?.[0] as object)).toBe(false);

    expect(screen.getAllByText("CORE VALID · ROOT").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CORE VALID · PARTIALLY RESOLVED").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CORE VALID · DECLARED CYCLE").length).toBeGreaterThan(0);
    expect(screen.getByText("Capsule invalid · excluded from graph")).toBeTruthy();
    expect(screen.getByText("Same archive SHA-256 repeated")).toBeTruthy();
    expect(screen.getByText("One capsule ID · multiple valid archives")).toBeTruthy();
    expect(screen.getByText(/Full transport hashes appear in the selected capsule inspector\./)).toBeTruthy();
    expect(screen.queryByText("Each transport remains inspectable.")).toBeNull();
    expect(screen.getByText("Position shows declared ancestry, not time, identity, influence, or completeness.")).toBeTruthy();

    const child = screen.getAllByText("2222222222…22222222")[0]?.closest("button");
    expect(child).toBeTruthy();
    fireEvent.click(child as HTMLButtonElement);
    expect(screen.getByText(/The declaration is unresolved—not false/)).toBeTruthy();
    expect(screen.getByText(/Same self-asserted key as 1 other loaded capsule/)).toBeTruthy();
    expect(screen.getAllByText("Creator Proof · supported one-rule fork").length).toBeGreaterThan(0);

    expect(document.body.textContent).not.toContain(filenameSentinel);
    expect(document.body.textContent).not.toContain("PAYLOAD_HTML_MUST_NEVER_RENDER");
    expect(document.body.innerHTML).not.toContain("<script>PAYLOAD_HTML_MUST_NEVER_RENDER</script>");
  });

  it("moves focus to the atomic result summary after analysis", async () => {
    const mock = mockClient();
    render(<LineageAtlas createClient={mock.createClient} />);
    await screen.findByText("Local analyzer ready");
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["opaque bytes"], "secret.runbook")] } });

    const heading = await screen.findByRole("heading", { name: "Atlas built with exclusions" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("discloses correlation risk before exact metadata-only downloads", async () => {
    const createObjectURL = vi.fn().mockReturnValueOnce("blob:lineage-receipt").mockReturnValueOnce("blob:lineage-research");
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const mock = mockClient();
    render(<LineageAtlas createClient={mock.createClient} />);
    await screen.findByText("Local analyzer ready");
    fireEvent.change(document.querySelector("input[type='file']") as HTMLInputElement, { target: { files: [new File(["opaque"], "private.runbook")] } });
    await screen.findByRole("heading", { name: "Atlas built with exclusions" });

    expect(screen.getByText(/hashes, capsule IDs, self-asserted key IDs, and lineage can still correlate artifacts/i)).toBeTruthy();
    expect(screen.getByText(/They exclude filenames and payload or member bytes/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download exact lineage receipt" }));
    fireEvent.click(screen.getByRole("button", { name: "Download local research packet" }));

    expect(anchorClick).toHaveBeenCalledTimes(2);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect((createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe("application/json");
    expect((createObjectURL.mock.calls[1]?.[0] as Blob).type).toBe("text/plain;charset=utf-8");
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, "blob:lineage-receipt");
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, "blob:lineage-research");
    expect(screen.getByText("Local research packet downloaded. Nothing was published or submitted.")).toBeTruthy();
  });

  it("rejects a zero-byte file before it reaches the local analyzer", async () => {
    const mock = mockClient();
    render(<LineageAtlas createClient={mock.createClient} />);
    await screen.findByText("Local analyzer ready");
    fireEvent.change(document.querySelector("input[type='file']") as HTMLInputElement, { target: { files: [new File([], "empty.runbook")] } });

    expect(await screen.findByText("File set not analyzed")).toBeTruthy();
    expect(screen.getByText(/ensure every file contains at least one byte/)).toBeTruthy();
    expect(mock.client.analyze).not.toHaveBeenCalled();
  });

  it("fails closed instead of rendering hostile strings from a malformed result", async () => {
    const base = analysisOutcome();
    if (base.kind !== "result") throw new Error("expected result fixture");
    const first = base.receipt.artifacts;
    if (!Array.isArray(first) || first.length === 0 || typeof first[0] !== "object" || first[0] === null) throw new Error("expected artifact fixture");
    const sentinel = "payload.<script>HOSTILE_WORKER_TEXT</script>";
    const malformed: LineageAtlasOutcome = {
      ...base,
      receipt: { ...base.receipt, artifacts: [{ ...first[0], coreErrorCodes: [sentinel] }, ...first.slice(1)] },
    };
    const mock = mockClient(malformed);
    render(<LineageAtlas createClient={mock.createClient} />);
    await screen.findByText("Local analyzer ready");
    fireEvent.change(document.querySelector("input[type='file']") as HTMLInputElement, { target: { files: [new File(["opaque"], "never-render-me.runbook")] } });

    expect(await screen.findByRole("heading", { name: "No completed atlas" })).toBeTruthy();
    expect(screen.getByText(/Environment — no lineage verdict/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("HOSTILE_WORKER_TEXT");
    expect(document.body.textContent).not.toContain("never-render-me.runbook");
  });

  it("renders every diamond edge exactly once and exposes both parents in the AT outline", async () => {
    const mock = mockClient(diamondOutcome());
    render(<LineageAtlas createClient={mock.createClient} />);
    await screen.findByText("Local analyzer ready");
    fireEvent.change(document.querySelector("input[type='file']") as HTMLInputElement, { target: { files: [new File(["opaque"], "diamond.runbook")] } });
    await screen.findByRole("heading", { name: "Atlas ready" });
    fireEvent.click(screen.getByRole("button", { name: "Map" }));

    const map = screen.getByLabelText("Interactive deterministic lineage map");
    expect(within(map).getAllByTestId("edge-thread")).toHaveLength(4);
    expect(within(map).getAllByTestId("edge-thread").every((edge) => edge.getAttribute("data-status") === "resolved")).toBe(true);

    const semantic = screen.getByRole("list", { name: "Canonical lineage outline for the map" });
    const parents = within(semantic).getAllByRole("list", { name: `Declared parents for ${DIAMOND_JOIN}` });
    expect(parents).toHaveLength(2);
    for (const parentList of parents) {
      expect(parentList.textContent).toContain(DIAMOND_LEFT);
      expect(parentList.textContent).toContain(DIAMOND_RIGHT);
    }
    expect(within(semantic).queryByRole("button")).toBeNull();
  });

  it("keeps only the active view interactive while preserving keyboard focus and AT structure", async () => {
    const mock = mockClient();
    render(<LineageAtlas createClient={mock.createClient} />);
    await screen.findByText("Local analyzer ready");
    fireEvent.change(document.querySelector("input[type='file']") as HTMLInputElement, { target: { files: [new File(["opaque"], "focus.runbook")] } });
    await screen.findByRole("heading", { name: "Atlas built with exclusions" });
    fireEvent.click(screen.getByRole("button", { name: "Map" }));

    const map = screen.getByLabelText("Interactive deterministic lineage map");
    const mapButtons = within(map).getAllByRole("button");
    expect(mapButtons).toHaveLength(4);
    expect(mapButtons.every((button) => button.tabIndex === 0)).toBe(true);
    mapButtons[1]?.focus();
    expect(document.activeElement).toBe(mapButtons[1]);
    fireEvent.click(mapButtons[1] as HTMLButtonElement);
    expect(mapButtons[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByRole("list", { name: "Canonical lineage outline for the map" })).queryByRole("button")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    expect(screen.queryByLabelText("Interactive deterministic lineage map")).toBeNull();
    expect(screen.queryByRole("list", { name: "Canonical lineage outline for the map" })).toBeNull();
    expect(within(screen.getByRole("list", { name: "Loaded capsule lineage outline" })).getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("keeps explicit narrow-screen containment, reduced-motion, and forced-colors fallbacks", () => {
    const css = readFileSync(resolve(process.cwd(), "src/components/lineage-atlas.module.css"), "utf8");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain("width: calc(100% - 24px)");
    expect(css).toMatch(/\.workspace\s*\{\s*grid-template-columns:\s*1fr;/);
    expect(css).toMatch(/\.map\s*\{[^}]*overflow:\s*auto;/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".spin { animation: none; }");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain(".edgeThread i,");
    expect(css).not.toContain(".nodeWrap::before");
  });
});
