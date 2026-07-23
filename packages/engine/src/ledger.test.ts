import { access, chmod, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileLedger, canonicalize } from "./ledger.js";

async function tempLedger() {
  const directory = await mkdtemp(join(tmpdir(), "runbook-ledger-"));
  return { directory, path: join(directory, "events.jsonl"), ledger: new FileLedger(directory) };
}

const firstInput = {
  experimentId: "RUN-001",
  type: "experiment.created" as const,
  occurredAt: "2026-07-21T14:00:00.000Z",
  actor: { type: "human" as const, id: "MasonWyatt23" },
  idempotencyKey: "create-RUN-001",
  payload: { name: "Small Account Baseline", budget: 500 },
};

describe("canonicalize", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalize({ z: 1, a: { y: 2, b: true } })).toBe('{"a":{"b":true,"y":2},"z":1}');
  });

  it("rejects ambiguous or unsafe numeric values", () => {
    expect(() => canonicalize(-0)).toThrow("negative zero");
    expect(() => canonicalize(Number.MAX_SAFE_INTEGER + 1)).toThrow("unsafe integer");
  });
});

describe("FileLedger", () => {
  it("creates the ledger root and data file with explicit owner-only modes", async () => {
    const parent = await mkdtemp(join(tmpdir(), "runbook-ledger-parent-"));
    const directory = join(parent, "private");
    const ledger = new FileLedger(directory);

    await ledger.append(firstInput);

    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(ledger.path)).mode & 0o777).toBe(0o600);
  });

  it("accepts a pre-existing owner-private root and ledger file", async () => {
    const { directory, path, ledger } = await tempLedger();
    await chmod(directory, 0o700);
    await writeFile(path, "", { mode: 0o600 });
    await chmod(path, 0o600);

    await expect(ledger.append(firstInput)).resolves.toMatchObject({ duplicate: false });
    await expect(ledger.verify()).resolves.toMatchObject({ valid: true, eventCount: 1 });
  });

  it("fails closed on an owned ledger root that permits group or other access", async () => {
    const { directory, ledger } = await tempLedger();
    await chmod(directory, 0o755);

    await expect(ledger.append(firstInput)).rejects.toThrow("must deny all group and other access");
    await expect(ledger.verify()).resolves.toMatchObject({
      valid: false,
      errors: [expect.stringContaining("mode 0755")],
    });
  });

  it("fails closed on an owned ledger file that permits group or other access", async () => {
    const { path, ledger } = await tempLedger();
    await writeFile(path, "", { mode: 0o644 });
    await chmod(path, 0o644);

    await expect(ledger.append(firstInput)).rejects.toThrow("must deny all group and other access");
    await expect(ledger.verify()).resolves.toMatchObject({
      valid: false,
      errors: [expect.stringContaining("mode 0644")],
    });
  });

  it("fails closed immediately on an owned writer lock that permits group or other access", async () => {
    const { ledger } = await tempLedger();
    await writeFile(ledger.lockPath, "stale", { mode: 0o644 });
    await chmod(ledger.lockPath, 0o644);

    await expect(ledger.append(firstInput)).rejects.toThrow("must deny all group and other access");
    await expect(ledger.verify()).resolves.toMatchObject({
      valid: false,
      errors: [expect.stringContaining("mode 0644")],
    });
  });

  it("appends a verifiable hash chain", async () => {
    const { ledger } = await tempLedger();
    const first = await ledger.append(firstInput);
    const second = await ledger.append({
      ...firstInput,
      type: "charter.activated",
      idempotencyKey: "charter-RUN-001-v1",
      payload: { version: "1.0", policy: { allowedInstruments: ["equity"] } },
    });

    expect(first.duplicate).toBe(false);
    expect(second.event.previousHash).toBe(first.event.hash);
    await expect(ledger.verify()).resolves.toMatchObject({ valid: true, eventCount: 2, headHash: second.event.hash });
  });

  it("returns filtered events and the global head from one ledger snapshot", async () => {
    const { ledger } = await tempLedger();
    const first = await ledger.append(firstInput);
    const second = await ledger.append({
      ...firstInput,
      experimentId: "RUN-OTHER",
      idempotencyKey: "create-RUN-OTHER",
    });
    await expect(ledger.snapshot("RUN-001")).resolves.toEqual({
      verification: { valid: true, eventCount: 2, headHash: second.event.hash, errors: [] },
      events: [first.event],
    });
  });

  it("returns the existing event for the same idempotency key", async () => {
    const { ledger } = await tempLedger();
    const first = await ledger.append(firstInput);
    const duplicate = await ledger.append(firstInput);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.event.eventId).toBe(first.event.eventId);
    await expect(ledger.list()).resolves.toHaveLength(1);
  });

  it("rejects reuse of an idempotency key with different content", async () => {
    const { ledger } = await tempLedger();
    await ledger.append(firstInput);
    await expect(
      ledger.append({ ...firstInput, payload: { name: "Different experiment", budget: 500 } }),
    ).rejects.toThrow("Idempotency conflict");
  });

  it("detects content tampering and refuses another append", async () => {
    const { ledger, path } = await tempLedger();
    await ledger.append(firstInput);
    const content = await readFile(path, "utf8");
    await writeFile(path, content.replace("Small Account Baseline", "Guaranteed Alpha"));
    await expect(ledger.verify()).resolves.toMatchObject({ valid: false });
    await expect(ledger.append({ ...firstInput, idempotencyKey: "second" })).rejects.toThrow("Refusing to append");
  });

  it("refuses an incomplete trailing record", async () => {
    const { ledger, path } = await tempLedger();
    await ledger.append(firstInput);
    const content = await readFile(path, "utf8");
    await writeFile(path, content.trimEnd());
    await expect(ledger.verify()).resolves.toMatchObject({ valid: false, errors: [expect.stringContaining("incomplete trailing record")] });
  });

  it("refuses a symlinked ledger", async () => {
    const { directory } = await tempLedger();
    const target = join(directory, "target.jsonl");
    const linked = join(directory, "linked.jsonl");
    await writeFile(target, "");
    await symlink(target, linked);
    const ledger = new FileLedger(directory, "linked");
    await expect(ledger.append(firstInput)).rejects.toThrow("symlinked ledger");
  });

  it("rejects traversal-like ledger identifiers", async () => {
    const { directory } = await tempLedger();
    expect(() => new FileLedger(directory, "../outside")).toThrow("Ledger ID");
  });

  it("rejects credential-shaped fields before persistence", async () => {
    const { ledger } = await tempLedger();
    await expect(
      ledger.append({ ...firstInput, payload: { apiKey: "never-store-this" } }),
    ).rejects.toThrow("credential-like field");
    await expect(
      ledger.append({ ...firstInput, payload: { accountNumber: "synthetic" } }),
    ).rejects.toThrow("credential-like field");
  });

  it.each([
    ["JWT", ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"].join(".")],
    ["JWT embedded in prose", `credential: ${["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJ1c2VyIn0", "Pj2gY4mEXAMPLEsignature"].join(".")}`],
    ["PEM private key", ["-----BEGIN", "PRIVATE KEY-----\nZXhhbXBsZS1ub3QtYS1yZWFsLWtleQ==\n-----END PRIVATE KEY-----"].join(" ")],
    ["RSA PEM private key", ["-----BEGIN", "RSA PRIVATE KEY-----\nZXhhbXBsZS1ub3QtYS1yZWFsLWtleQ==\n-----END RSA PRIVATE KEY-----"].join(" ")],
    ["PGP private key", ["-----BEGIN", "PGP PRIVATE KEY BLOCK-----\nZXhhbXBsZS1ub3QtYS1yZWFsLWtleQ==\n-----END PGP PRIVATE KEY BLOCK-----"].join(" ")],
    ["GitHub token", `github_pat_${"Ab3_".repeat(12)}`],
    ["known token wrapped in a fixture label", `fixture:github_pat_${"Ab3_".repeat(12)}`],
    ["GitLab token", `glpat-${"Ab3_".repeat(10)}`],
    ["npm token", `npm_${"Ab3".repeat(12)}`],
    ["Docker token", `dckr_pat_${"Ab3_".repeat(10)}`],
    ["Hugging Face token", `hf_${"Ab3".repeat(12)}`],
    ["OpenAI-style token", `sk-${"Ab3_".repeat(10)}`],
    ["Stripe secret", `sk_live_${"Ab3".repeat(10)}`],
    ["webhook secret", `whsec_${"Ab3".repeat(10)}`],
    ["Twilio API key", `SK${"A1b2".repeat(8)}`],
    ["AWS access key ID", "AKIAIOSFODNN7EXAMPLE"],
    ["bearer credential", `Bearer ${"Ab3_".repeat(10)}`],
    ["credential URI", "postgresql://researcher:V3ry-S3cret-Passphrase@db.example.invalid/runbook"],
    ["high-entropy credential assignment", [["CLIENT", "SECRET"].join("_"), ["R4nD0m_7xQp9V", "k2Mz6Ht8Uw3Aa5Cc1Ee"].join("")].join("=")],
    ["quoted high-entropy credential assignment", `{"client_secret":"${"a1b2c3d4e5f6g7h8"}"}`],
    ["bare account number", "000123456789"],
    ["formatted account number", "0001 2345 6789 0123"],
    ["labeled routing number", "routing: 021000021"],
    ["account number embedded in prose", "Imported from reference 000123456789 yesterday"],
    ["IBAN-like value", "GB82 WEST 1234 5698 7654 32"],
    ["unlabeled high-entropy token", ["Zx8_Qp2-Lm9Vb4Nc", "7Ad1Ef6Gh3Jk0Rt5Uw"].join("")],
    ["hex-encoded private material", "private=4c0883a69102937d6231471b5dbb6204fe512961708279433e4c72f6c49f8a2e"],
  ])("rejects a %s in an ordinary payload field before creating a ledger", async (_label, value) => {
    const { ledger, path } = await tempLedger();
    await expect(
      ledger.append({ ...firstInput, payload: { note: value } }),
    ).rejects.toThrow("credential-like value");
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects credential-shaped envelope values before persistence", async () => {
    const { ledger, path } = await tempLedger();
    await expect(
      ledger.append({ ...firstInput, actor: { type: "agent", id: `sk-${"Ab3_".repeat(10)}` } }),
    ).rejects.toThrow("event.actor.id contains a credential-like value");
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recursively rejects credential-shaped values in arrays", async () => {
    const { ledger } = await tempLedger();
    await expect(
      ledger.append({ ...firstInput, payload: { evidence: [{ note: `Bearer ${"Ab3_".repeat(10)}` }] } }),
    ).rejects.toThrow("event.payload.evidence[0].note contains a credential-like value");
  });

  it("does not repeat a rejected value in its error message", async () => {
    const { ledger } = await tempLedger();
    const suspect = `sk-${"Ab3_".repeat(10)}`;
    await expect(
      ledger.append({ ...firstInput, payload: { note: suspect } }),
    ).rejects.not.toThrow(suspect);
  });

  it("fails closed when a credential-shaped value is manually inserted into a ledger", async () => {
    const { ledger, path } = await tempLedger();
    await ledger.append(firstInput);
    const content = await readFile(path, "utf8");
    await writeFile(path, content.replace("Small Account Baseline", `sk-${"Ab3_".repeat(10)}`));
    await expect(ledger.verify()).resolves.toMatchObject({
      valid: false,
      errors: [expect.stringContaining("credential-like value")],
    });
  });

  it("preserves ordinary domain values, synthetic IDs, UUIDs, and SHA-256 digests", async () => {
    const { ledger } = await tempLedger();
    const digest = "06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9";
    const sha512Digest = "0123456789abcdef".repeat(8);
    await expect(ledger.append({
      ...firstInput,
      actor: { type: "agent", id: "runbook-policy-v1" },
      idempotencyKey: "preflight:proposal-001:policy-v1",
      payload: {
        proposalId: "proposal-001",
        runId: "RUN-SYNTHETIC-001",
        eventId: "2f1c205b-9b7a-4f4d-81a2-35ee0b04ac82",
        preflightHash: digest,
        taggedDigest: `sha256:${digest}`,
        longTaggedDigest: `sha512:${sha512Digest}`,
        syntheticOpaqueId: "fixture:Zx8_Qp2-Lm9Vb4Nc7Ad1Ef6Gh3Jk0Rt5Uw",
        syntheticAccountId: "synthetic-account-000123456789",
        datedRunId: "RUN-20260721-001",
        occurredAt: "2026-07-21T14:00:00.000Z",
        symbol: "HOOD",
        note: "Synthetic hostile-fixture ID, not a credential.",
      },
    })).resolves.toMatchObject({ duplicate: false });
  });

  it("does not mistake credential vocabulary without secret-shaped material for a credential", async () => {
    const { ledger } = await tempLedger();
    await expect(ledger.append({
      ...firstInput,
      payload: {
        note: "The client secret rotation control was tested with a redacted fixture.",
        fixtureLabel: "example:credential-rotation-control-v2",
      },
    })).resolves.toMatchObject({ duplicate: false });
  });

  it("rejects unknown envelope fields instead of silently stripping them", async () => {
    const { ledger } = await tempLedger();
    await expect(
      ledger.append({ ...firstInput, unexpected: true } as typeof firstInput),
    ).rejects.toThrow();
  });
});
