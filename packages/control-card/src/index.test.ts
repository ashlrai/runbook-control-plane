import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  finalizeProofCapsule,
  prepareProofCapsule,
  serializeJcs,
  type CapsulePayloadMember,
} from "@runbook/capsule-author";
import { verifyProofCapsule as verifyBrowserCore } from "@runbook/capsule-browser";
import {
  getSyntheticV0ScenarioDefinitions,
  runFinancialBench,
  serializeBenchRunReceipt,
  sha256Utf8,
  type ScenarioDefinition,
} from "@runbook/financial-bench";
import { verifyProofCapsule as verifyNodeCore } from "../../capsule/src/index.js";
import { assembleProofCapsuleZip } from "../../capsule-author/src/zip.js";
import { readCapsuleMembers } from "../../capsule-browser/src/zip.js";
import {
  CONTROL_CARD_CORPUS_MANIFEST_SHA256,
  CONTROL_CARD_CORPUS_SHA256,
  CONTROL_CARD_DISCLOSURES,
  CONTROL_CARD_EXPERIMENT_ID,
  CONTROL_CARD_MANIFEST_SHA256,
  CONTROL_CARD_OUTCOMES_SHA256,
  CONTROL_CARD_SAMPLE_ARCHIVE_SHA256,
  CONTROL_CARD_SAMPLE_AUTHOR_KEY_ID,
  CONTROL_CARD_SAMPLE_CAPSULE_ID,
  controlCardProfileSnapshot,
  prepareControlCard,
  serializeControlCardVerificationReceipt,
  verifyControlCard,
  type PrepareControlCardInput,
} from "./index.js";
import { verifyControlCardNode } from "./node.js";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const fixtureUrl = new URL("../fixtures/synthetic-control-self-test-v0.runbook", import.meta.url);
const metadataUrl = new URL("../fixtures/synthetic-control-self-test-v0.metadata.json", import.meta.url);
const domainUrl = new URL("../fixtures/synthetic-control-self-test-v0.domain-receipt.jcs", import.meta.url);
const fixture = new Uint8Array(readFileSync(fixtureUrl));
const text = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function keys() {
  const pair = await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  return { pair, spki: new Uint8Array(await subtle.exportKey("spki", pair.publicKey)) };
}

async function authoredControlCard(createdAt = "2026-07-22T13:00:00Z") {
  const { pair, spki } = await keys();
  const prepared = await prepareControlCard({ checkpointSequence: 1, createdAt, publicKeySpkiDer: spki }, { subtle });
  const signature = new Uint8Array(await subtle.sign("Ed25519", pair.privateKey, prepared.signingBytes));
  const authored = await finalizeProofCapsule(prepared, signature, { subtle });
  return { authored, pair, prepared, spki };
}

function payloadsFrom(archive: Uint8Array): CapsulePayloadMember[] {
  const parsed = readCapsuleMembers(archive);
  const manifest = JSON.parse(text(parsed.members.get("runbook/manifest.json") as Uint8Array)) as {
    members: Array<{ mediaType: string; path: `payload/${string}`; role: CapsulePayloadMember["role"] }>;
  };
  return manifest.members.map((member) => ({
    bytes: new Uint8Array(parsed.members.get(member.path) as Uint8Array),
    mediaType: member.mediaType,
    path: member.path,
    role: member.role,
  }));
}

async function authorPayloads(
  payloads: readonly CapsulePayloadMember[],
  options: { lineage?: { relation: "root"; parents: [] } | { relation: "derived"; parents: string[] } } = {},
) {
  const { pair, spki } = await keys();
  const prepared = await prepareProofCapsule({
    checkpointSequence: 1,
    createdAt: "2026-07-22T14:00:00Z",
    dataClass: "synthetic",
    eventChain: { eventCount: 0, headHash: "0".repeat(64) },
    experimentId: CONTROL_CARD_EXPERIMENT_ID,
    lineage: options.lineage ?? { relation: "root", parents: [] },
    payloads,
    publicKeySpkiDer: spki,
  }, { subtle });
  const signature = new Uint8Array(await subtle.sign("Ed25519", pair.privateKey, prepared.signingBytes));
  return finalizeProofCapsule(prepared, signature, { subtle });
}

async function rewriteSignedStatement(
  archive: Uint8Array,
  pair: CryptoKeyPair,
  update: (statement: Record<string, unknown>) => void,
) {
  const parsed = readCapsuleMembers(archive);
  const statement = JSON.parse(text(parsed.members.get("runbook/checkpoint.statement.json") as Uint8Array)) as Record<string, unknown>;
  update(statement);
  const statementBytes = serializeJcs(statement);
  const payloadType = "application/vnd.runbook.checkpoint+json;version=1";
  const typeBytes = new TextEncoder().encode(payloadType);
  const signingBytes = new Uint8Array([
    ...new TextEncoder().encode(`DSSEv1 ${typeBytes.byteLength} `), ...typeBytes,
    ...new TextEncoder().encode(` ${statementBytes.byteLength} `), ...statementBytes,
  ]);
  const signature = new Uint8Array(await subtle.sign("Ed25519", pair.privateKey, signingBytes));
  const existing = JSON.parse(text(parsed.members.get("runbook/checkpoint.dsse.json") as Uint8Array)) as {
    signatures: Array<{ keyid: string }>;
  };
  const envelope = serializeJcs({
    payload: Buffer.from(statementBytes).toString("base64"),
    payloadType,
    signatures: [{ keyid: existing.signatures[0]?.keyid, sig: Buffer.from(signature).toString("base64") }],
  });
  return assembleProofCapsuleZip(parsed.order.map((path) => ({
    path,
    bytes: path === "runbook/checkpoint.statement.json" ? statementBytes
      : path === "runbook/checkpoint.dsse.json" ? envelope : parsed.members.get(path) as Uint8Array,
  })));
}

function replacePayload(payloads: readonly CapsulePayloadMember[], path: string, bytes: Uint8Array) {
  return payloads.map((payload) => payload.path === path ? { ...payload, bytes } : payload);
}

function substitutedCorpus(kind: "one" | "skip" | "unsupported" | "not-evaluable") {
  let definitions = structuredClone(getSyntheticV0ScenarioDefinitions()) as ScenarioDefinition[];
  if (kind === "one") definitions = [definitions[0] as ScenarioDefinition];
  if (kind === "skip" || kind === "unsupported") {
    definitions = definitions.map((definition) => ({ ...definition, mode: kind })) as ScenarioDefinition[];
  }
  if (kind === "not-evaluable") {
    const first = definitions[0];
    if (first?.kind !== "wrong-account") throw new Error("test.fixture-kind-invalid");
    definitions = [{
      ...first,
      action: { ...first.action, accountAlias: first.constitution.allowedAccountAliases[0] as string },
    }];
  }
  return definitions;
}

async function selfConsistentSubstitution(kind: "one" | "skip" | "unsupported" | "not-evaluable") {
  const definitions = substitutedCorpus(kind);
  const receipt = runFinancialBench(definitions);
  const outcomeText = serializeBenchRunReceipt(receipt);
  const payloads = payloadsFrom(fixture);
  const claimsIndex = payloads.findIndex((payload) => payload.path === "payload/claims.json");
  const scenariosIndex = payloads.findIndex((payload) => payload.path === "payload/scenarios.json");
  const claims = JSON.parse(text(payloads[claimsIndex]!.bytes)) as Record<string, unknown>;
  const scenarios = JSON.parse(text(payloads[scenariosIndex]!.bytes)) as Record<string, unknown>;
  claims.outcomesSha256 = sha256Utf8(outcomeText);
  claims.scenarioCount = definitions.length;
  scenarios.definitions = definitions;
  const changed = replacePayload(payloads, "payload/outcomes.json", new TextEncoder().encode(outcomeText));
  changed[claimsIndex] = { ...changed[claimsIndex]!, bytes: serializeJcs(claims) };
  changed[scenariosIndex] = { ...changed[scenariosIndex]!, bytes: serializeJcs(scenarios) };
  return authorPayloads(changed);
}

describe("immutable Synthetic Control Self-Test Card", () => {
  it("matches the pinned fixture and exact Node/browser application receipts", async () => {
    const [browserCore, browserDomain] = await Promise.all([
      verifyBrowserCore(fixture, { subtle }),
      verifyControlCard(fixture, { subtle }),
    ]);
    const nodeCore = verifyNodeCore(fixture);
    const nodeDomain = verifyControlCardNode(fixture);
    expect(browserCore).toEqual(nodeCore);
    expect(browserDomain).toEqual(nodeDomain);
    expect(browserDomain).toMatchObject({
      authorKeyId: CONTROL_CARD_SAMPLE_AUTHOR_KEY_ID,
      capsuleId: CONTROL_CARD_SAMPLE_CAPSULE_ID,
      checks: {
        completeCoverage: true,
        coreValid: true,
        corpusIdentity: true,
        exactMemberProfile: true,
        referenceReceiptReproduced: true,
        statementProfile: true,
      },
      valid: true,
    });
    expect(hash(fixture)).toBe(CONTROL_CARD_SAMPLE_ARCHIVE_SHA256);
    expect(serializeControlCardVerificationReceipt(browserDomain)).toEqual(new Uint8Array(readFileSync(domainUrl)));
    expect(readFileSync(domainUrl).at(-1)).not.toBe(0x0a);
    expect(JSON.parse(readFileSync(metadataUrl, "utf8"))).toMatchObject({
      archiveSha256: CONTROL_CARD_SAMPLE_ARCHIVE_SHA256,
      authorKeyId: CONTROL_CARD_SAMPLE_AUTHOR_KEY_ID,
      capsuleId: CONTROL_CARD_SAMPLE_CAPSULE_ID,
      corpusManifestSha256: CONTROL_CARD_CORPUS_MANIFEST_SHA256,
      corpusSha256: CONTROL_CARD_CORPUS_SHA256,
      fixtureKey: "public-rfc8032-test-vector-2-not-an-identity-or-issuer",
      manifestSha256: CONTROL_CARD_MANIFEST_SHA256,
      outcomesSha256: CONTROL_CARD_OUTCOMES_SHA256,
    });
  });

  it("authors identical bytes from one prepared snapshot and passes both domain implementations", async () => {
    const { authored, pair, prepared } = await authoredControlCard();
    const signature = new Uint8Array(await subtle.sign("Ed25519", pair.privateKey, prepared.signingBytes));
    const second = await finalizeProofCapsule(prepared, signature, { subtle });
    expect(second.archiveBytes).toEqual(authored.archiveBytes);
    await expect(verifyControlCard(authored.archiveBytes, { subtle })).resolves.toEqual(verifyControlCardNode(authored.archiveBytes));
  });

  it("owns signed control inputs and rejects getters, accessors, and exotic prototypes", async () => {
    const { pair, spki } = await keys();
    const input: PrepareControlCardInput = { checkpointSequence: 1, createdAt: "2026-07-22T13:30:00Z", publicKeySpkiDer: spki };
    const preparing = prepareControlCard(input, { subtle });
    (input as { checkpointSequence: number }).checkpointSequence = 0;
    (input as { createdAt: string }).createdAt = "not-a-time";
    spki.fill(0xff);
    const prepared = await preparing;
    expect(prepared.review).toMatchObject({ checkpointSequence: 1, createdAt: "2026-07-22T13:30:00Z" });
    const signature = new Uint8Array(await subtle.sign("Ed25519", pair.privateKey, prepared.signingBytes));
    await expect(finalizeProofCapsule(prepared, signature, { subtle })).resolves.toMatchObject({ capsuleId: prepared.capsuleId });

    const getter = Object.defineProperties({}, {
      checkpointSequence: { enumerable: true, get: () => 1 },
      createdAt: { enumerable: true, value: "2026-07-22T13:30:00Z" },
      publicKeySpkiDer: { enumerable: true, value: new Uint8Array(44) },
    });
    await expect(prepareControlCard(getter as PrepareControlCardInput, { subtle })).rejects.toThrow("control-card.input-invalid");
    class Exotic { checkpointSequence = 1; createdAt = "2026-07-22T13:30:00Z"; publicKeySpkiDer = new Uint8Array(44); }
    await expect(prepareControlCard(new Exotic(), { subtle })).rejects.toThrow("control-card.input-invalid");
  });

  it.each(["one", "skip", "unsupported", "not-evaluable"] as const)("rejects a core-valid, self-consistent %s corpus substitution", async (kind) => {
    const hostile = await selfConsistentSubstitution(kind);
    await expect(verifyBrowserCore(hostile.archiveBytes, { subtle })).resolves.toMatchObject({ valid: true });
    await expect(verifyControlCard(hostile.archiveBytes, { subtle })).resolves.toMatchObject({
      benchReceipt: null,
      checks: { coreValid: true, exactMemberProfile: false },
      valid: false,
    });
  });

  it("rejects core-valid role, extra-member, report, disclosure, and secret substitutions", async () => {
    const originals = payloadsFrom(fixture);
    const role = originals.map((payload) => payload.path === "payload/outcomes.json" ? { ...payload, role: "policy" as const } : payload);
    const extra = [...originals, { path: "payload/z.json" as const, role: "policy" as const, mediaType: "application/json", bytes: serializeJcs({ schemaVersion: "hostile.extra.v0" }) }];
    const activeTag = ["scr", "ipt"].join("");
    const report = replacePayload(originals, "payload/report.html", new TextEncoder().encode(`<!doctype html><${activeTag} src="https://hostile.invalid/x.js"></${activeTag}><form></form>`));
    const disclosures = replacePayload(originals, "payload/disclosures.json", serializeJcs({ limitations: [], schemaVersion: "hostile.v0" }));
    const secret = replacePayload(originals, "payload/claims.json", serializeJcs({ privatePrompt: "do-not-persist", token: "sk-hostile-canary", schemaVersion: "hostile.v0" }));
    for (const payloads of [role, extra, report, disclosures, secret]) {
      const authored = await authorPayloads(payloads);
      await expect(verifyBrowserCore(authored.archiveBytes, { subtle })).resolves.toMatchObject({ valid: true });
      await expect(verifyControlCard(authored.archiveBytes, { subtle })).resolves.toMatchObject({ valid: false, benchReceipt: null });
    }
    const invalidMedia = originals.map((payload) => payload.path === "payload/outcomes.json" ? { ...payload, mediaType: "text/plain" } : payload);
    await expect(authorPayloads(invalidMedia)).rejects.toThrow("author.payload-profile-invalid");
  });

  it("rejects core-valid live, nonempty-event, and derived statement profiles", async () => {
    const { authored, pair } = await authoredControlCard();
    const [live, events] = await Promise.all([
      rewriteSignedStatement(authored.archiveBytes, pair, (statement) => { statement.dataClass = "live-author-declared"; }),
      rewriteSignedStatement(authored.archiveBytes, pair, (statement) => {
        statement.eventChain = { algorithm: "runbook-jsonl-chain-v1", eventCount: 1, headHash: "1".repeat(64) };
      }),
    ]);
    const derived = await authorPayloads(payloadsFrom(fixture), { lineage: { relation: "derived", parents: ["a".repeat(64)] } });
    for (const archive of [live, events, derived.archiveBytes]) {
      await expect(verifyBrowserCore(archive, { subtle })).resolves.toMatchObject({ valid: true });
      await expect(verifyControlCard(archive, { subtle })).resolves.toMatchObject({
        checks: { coreValid: true },
        valid: false,
      });
    }
  });

  it("keeps the exact fixture inert, synthetic, metadata-bounded, and free of positive assurance claims", () => {
    const parsed = readCapsuleMembers(fixture);
    const paths = parsed.order.join("\n");
    const allText = parsed.order.filter((path) => path !== "runbook/author-key.spki.der")
      .map((path) => text(parsed.members.get(path) as Uint8Array)).join("\n");
    const report = text(parsed.members.get("payload/report.html") as Uint8Array);
    expect(paths).not.toMatch(/credential|prompt|token|secret|account-number|routing|private/i);
    expect(allText).not.toMatch(/sk-[a-z0-9]|-----begin [a-z ]*private key-----|eyj[a-z0-9_-]+\.[a-z0-9_-]+\./i);
    expect(report).not.toMatch(/<script|<form|\ssrc=|\shref=|http:|https:|javascript:|<iframe|<object|<embed/i);
    expect(report).toContain("expected finding set reproduced");
    expect(report).toContain("NO AGENT OR BROKER CONNECTION");
    expect(report).not.toMatch(/agent (?:is |was )?(?:safe|verified|certified|ready)|safety score|assurance level/i);
    expect(CONTROL_CARD_DISCLOSURES).toHaveLength(8);
    const snapshot = controlCardProfileSnapshot();
    expect(snapshot.manifestSha256).toBe(CONTROL_CARD_MANIFEST_SHA256);
    expect(snapshot.outcomesSha256).toBe(CONTROL_CARD_OUTCOMES_SHA256);
    expect(snapshot.payloads).toHaveLength(7);
  });

  it("treats fixture and arbitrary keys as self-asserted and never as identity or time authority", async () => {
    expect(CONTROL_CARD_SAMPLE_AUTHOR_KEY_ID).not.toBe("sha256:06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9");
    const backdated = await authoredControlCard("2001-01-01T00:00:00Z");
    const receipt = await verifyControlCard(backdated.authored.archiveBytes, { subtle });
    expect(receipt.valid).toBe(true);
    expect(receipt.authorKeyId).not.toBe(CONTROL_CARD_SAMPLE_AUTHOR_KEY_ID);
    expect(receipt.limitations).toContain("self-asserted-signature-does-not-prove-identity-or-independent-time");
    const substituted = new Uint8Array(backdated.authored.archiveBytes);
    const parsed = readCapsuleMembers(substituted);
    const key = parsed.members.get("runbook/author-key.spki.der") as Uint8Array;
    const offset = substituted.findIndex((byte, index) => index + key.byteLength <= substituted.byteLength
      && key.every((candidate, keyIndex) => substituted[index + keyIndex] === candidate));
    expect(offset).toBeGreaterThanOrEqual(0);
    substituted[offset + key.byteLength - 1] ^= 1;
    await expect(verifyControlCard(substituted, { subtle })).resolves.toMatchObject({ valid: false, benchReceipt: null });
  });
});
