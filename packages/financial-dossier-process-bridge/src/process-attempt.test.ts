import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalizeAdapterJcs } from "@runbook/financial-dossier-adapter";
import type { RunnerIdentityV2 } from "@runbook/financial-dossier-harness/private/runner";
import { ownPinnedTargetModule } from "./owned-target.js";
import {
  bindProcessAttempt,
  parseExactProcessAttemptBytes,
  serializeProcessAttempt,
  sha256ProcessBytes,
  verifyAttemptedCrashProcessAttempt,
  verifyCompletedProcessAttempt,
} from "./process-attempt.js";
import {
  runFinance000Process,
  runFinance003Process,
  runFinance010Process,
  runFinance027Process,
  runFinance028Process,
  runFinance030PrimaryCrashProcess,
} from "./run.js";
import {
  PROCESS_BRIDGE_ATTEMPTED_CRASH_PROFILE,
  PROCESS_BRIDGE_PROFILE,
  attemptedCrashEventProgram,
  type AttemptedCrashProcessRunV2,
  type CompletedProcessRunV2,
  type ProcessAttemptV2,
} from "./types.js";

const encoder = new TextEncoder();
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const identityDigest = (label: string) => sha(`portable-verifier-test:${label}`);
const identity: RunnerIdentityV2 = Object.freeze({
  adapterBundleSha256: identityDigest("adapter"),
  channelContractSha256: identityDigest("channel"),
  corpusManifestSha256: identityDigest("corpus"),
  dossierRunNonce: identityDigest("run"),
  publicConfigurationSha256: identityDigest("configuration"),
  runnerArtifactSha256: identityDigest("runner"),
});

let first: CompletedProcessRunV2;
let second: CompletedProcessRunV2;
let finance003: CompletedProcessRunV2;
let finance010: CompletedProcessRunV2;
let finance027: CompletedProcessRunV2;
let finance028: CompletedProcessRunV2;
let beforeClaimPrimary: AttemptedCrashProcessRunV2;
let loaderBytes: Uint8Array;
let targetModuleBytes: Uint8Array;

beforeAll(async () => {
  const path = fileURLToPath(new URL("./reference-common-subject.mjs", import.meta.url));
  targetModuleBytes = new Uint8Array(readFileSync(path));
  loaderBytes = new Uint8Array(readFileSync(new URL("./loader.mjs", import.meta.url)));
  const target = ownPinnedTargetModule(path, sha(targetModuleBytes));
  [first, second, finance003, finance010, finance027, finance028, beforeClaimPrimary] =
    await Promise.all([
      runFinance000Process({ identity, target }),
      runFinance000Process({ identity, target }),
      runFinance003Process({ identity, target }),
      runFinance010Process({ identity, target }),
      runFinance027Process({ identity, target }),
      runFinance028Process({ identity, target }),
      runFinance030PrimaryCrashProcess({ identity, target, branch: "before-claim" }),
    ]);
});

function exactAttemptBytes(
  source: ProcessAttemptV2,
  mutate: (candidate: Record<string, unknown>) => void,
): Uint8Array {
  const candidate = structuredClone(source) as unknown as Record<string, unknown>;
  mutate(candidate);
  delete candidate.attemptBindingSha256;
  candidate.attemptBindingSha256 = bindProcessAttempt(
    candidate as unknown as Omit<ProcessAttemptV2, "attemptBindingSha256">,
  );
  return encoder.encode(canonicalizeAdapterJcs(candidate));
}

function exactSealedTrialBytes(
  source: Uint8Array,
  mutate: (candidate: Record<string, unknown>) => void,
): Uint8Array {
  const candidate = JSON.parse(new TextDecoder().decode(source)) as Record<string, unknown>;
  mutate(candidate);
  return encoder.encode(canonicalizeAdapterJcs(candidate));
}

function bundle(
  run: CompletedProcessRunV2,
  overrides: Partial<{
    attemptBytes: Uint8Array;
    loaderBytes: Uint8Array;
    sealedTrialBytes: Uint8Array;
    targetModuleBytes: Uint8Array;
    runnerToTargetTranscriptBytes: Uint8Array;
    targetToRunnerTranscriptBytes: Uint8Array;
  }> = {},
) {
  return {
    attemptBytes: overrides.attemptBytes ?? run.attemptBytes,
    loaderBytes: overrides.loaderBytes ?? loaderBytes,
    sealedTrialBytes: overrides.sealedTrialBytes ?? run.sealedTrialBytes,
    targetModuleBytes: overrides.targetModuleBytes ?? targetModuleBytes,
    runnerToTargetTranscriptBytes:
      overrides.runnerToTargetTranscriptBytes ?? run.runnerToTargetTranscriptBytes,
    targetToRunnerTranscriptBytes:
      overrides.targetToRunnerTranscriptBytes ?? run.targetToRunnerTranscriptBytes,
  };
}

describe("portable completed process-attempt verifier", () => {
  it("owns, deeply freezes, and verifies the exact completed evidence bundle", () => {
    const verified = verifyCompletedProcessAttempt(bundle(first));
    expect(verified).toEqual(first.attempt);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.events)).toBe(true);
    expect(Object.isFrozen(verified.events[0])).toBe(true);
    expect(Object.isFrozen(verified.limitations)).toBe(true);

    const mutableBytes = Uint8Array.from(first.attemptBytes);
    const parsed = parseExactProcessAttemptBytes(mutableBytes);
    mutableBytes.fill(0);
    expect(parsed.attemptBindingSha256).toBe(first.attempt.attemptBindingSha256);
  });

  it.each([
    ["exitCode", 1],
    ["signal", "SIGKILL"],
    ["terminateWritten", false],
    ["runnerWriteClosed", false],
    ["targetChannelCleanEof", false],
    ["reaped", false],
    ["timedOut", true],
    ["killAttempted", true],
  ] as const)("rejects a rebound completed record with invalid %s", (key, value) => {
    const attemptBytes = exactAttemptBytes(first.attempt, (candidate) => { candidate[key] = value; });
    expect(() => parseExactProcessAttemptBytes(attemptBytes))
      .toThrowError("process-attempt.completed-invariants-invalid");
  });

  it("rejects reordered, duplicated, or truncated lifecycle programs even when rebound", () => {
    for (const mutation of [
      (events: Array<Record<string, unknown>>) => { [events[0], events[1]] = [events[1]!, events[0]!]; },
      (events: Array<Record<string, unknown>>) => { events[1] = { ...events[0]!, sequence: 1 }; },
      (events: Array<Record<string, unknown>>) => { events.pop(); },
    ]) {
      const attemptBytes = exactAttemptBytes(first.attempt, (candidate) => {
        const events = candidate.events as Array<Record<string, unknown>>;
        mutation(events);
        events.forEach((event, index) => { event.sequence = index; });
      });
      expect(() => parseExactProcessAttemptBytes(attemptBytes))
        .toThrowError("process-attempt.event-program-invalid");
    }
  });

  it("rejects exact trial-byte substitution before trusting trial contents", () => {
    expect(() => verifyCompletedProcessAttempt(bundle(first, {
      sealedTrialBytes: second.sealedTrialBytes,
    }))).toThrowError("process-attempt.sealed-trial-digest-mismatch");
  });

  it("rejects rebound finance-000 disposition and counter forgeries", () => {
    for (const mutate of [
      (trial: Record<string, unknown>) => { trial.disposition = "deny"; },
      (trial: Record<string, unknown>) => {
        (trial.counters as Record<string, unknown>).acceptedPreviewCount = 999;
      },
    ]) {
      const sealedTrialBytes = exactSealedTrialBytes(first.sealedTrialBytes, mutate);
      const attemptBytes = exactAttemptBytes(first.attempt, (candidate) => {
        candidate.sealedTrialSha256 = sha256ProcessBytes(sealedTrialBytes);
      });
      expect(() => verifyCompletedProcessAttempt(bundle(first, {
        attemptBytes,
        sealedTrialBytes,
      }))).toThrowError("process-attempt.lifecycle-profile-unrecognized");
    }
  });

  it("recomputes exact loader and executed-target bytes", () => {
    const substitutedLoader = loaderBytes.slice();
    substitutedLoader[0] = substitutedLoader[0]! ^ 1;
    expect(() => verifyCompletedProcessAttempt(bundle(first, {
      loaderBytes: substitutedLoader,
    }))).toThrowError("process-attempt.loader-digest-mismatch");
    const substitutedTarget = targetModuleBytes.slice();
    substitutedTarget[0] = substitutedTarget[0]! ^ 1;
    expect(() => verifyCompletedProcessAttempt(bundle(first, {
      targetModuleBytes: substitutedTarget,
    }))).toThrowError("process-attempt.target-module-mismatch");
  });

  it("rejects a rebound trial substitution on the session-binding relation", () => {
    const attemptBytes = exactAttemptBytes(first.attempt, (candidate) => {
      candidate.sealedTrialSha256 = sha256ProcessBytes(second.sealedTrialBytes);
    });
    expect(() => verifyCompletedProcessAttempt(bundle(first, {
      attemptBytes,
      sealedTrialBytes: second.sealedTrialBytes,
    }))).toThrowError("process-attempt.session-binding-mismatch");
  });

  it("rejects exact directional transcript substitutions", () => {
    expect(() => verifyCompletedProcessAttempt(bundle(first, {
      runnerToTargetTranscriptBytes: second.runnerToTargetTranscriptBytes,
    }))).toThrowError("process-attempt.runner-to-target-transcript-mismatch");
    expect(() => verifyCompletedProcessAttempt(bundle(first, {
      targetToRunnerTranscriptBytes: second.targetToRunnerTranscriptBytes,
    }))).toThrowError("process-attempt.target-to-runner-transcript-mismatch");
  });

  it("rejects a rebound opening digest that is not the exact session-plus-challenge prefix", () => {
    const attemptBytes = exactAttemptBytes(first.attempt, (candidate) => {
      candidate.openingTranscriptSha256 = sha256ProcessBytes(first.runnerToTargetTranscriptBytes);
      candidate.openingByteCount = first.runnerToTargetTranscriptBytes.byteLength;
    });
    expect(() => verifyCompletedProcessAttempt(bundle(first, { attemptBytes })))
      .toThrowError("process-attempt.opening-transcript-mismatch");
  });

  it("rejects malformed framing even if a caller rebinds its transcript digest", () => {
    const malformed = first.runnerToTargetTranscriptBytes.slice(0, -1);
    const attemptBytes = exactAttemptBytes(first.attempt, (candidate) => {
      candidate.runnerToTargetTranscriptSha256 = sha256ProcessBytes(malformed);
      candidate.runnerToTargetByteCount = malformed.byteLength;
    });
    expect(() => verifyCompletedProcessAttempt(bundle(first, {
      attemptBytes,
      runnerToTargetTranscriptBytes: malformed,
    }))).toThrowError("process-attempt.runner-to-target-transcript.frame-truncated");
  });

  it("rejects accessor-backed serialization and non-Uint8 byte impostors", () => {
    const accessor = structuredClone(first.attempt) as ProcessAttemptV2;
    Object.defineProperty(accessor, "exitCode", {
      enumerable: true,
      configurable: true,
      get: () => 0,
    });
    expect(() => serializeProcessAttempt(accessor)).toThrowError("process-attempt.shape-invalid");
    expect(() => parseExactProcessAttemptBytes(new Uint16Array([1]) as unknown as Uint8Array))
      .toThrowError("process-attempt.bytes-invalid");
  });

  it("verifies the multi-request finance-003 completed evidence bundle", () => {
    const verified = verifyCompletedProcessAttempt(bundle(finance003));
    expect(verified).toEqual(finance003.attempt);
    expect(finance003.sealedTrial.disposition).toBe("defer");
    expect(finance003.attempt.runnerToTargetFrameCount).toBe(5);
    expect(finance003.attempt.targetToRunnerFrameCount).toBe(4);
    expect(finance003.attempt.events.filter((event) => event.code === "request-received"))
      .toHaveLength(2);
  });

  it("rejects cross-lifecycle sealed-trial substitution between 000 and 003", () => {
    expect(() => verifyCompletedProcessAttempt(bundle(first, {
      sealedTrialBytes: finance003.sealedTrialBytes,
    }))).toThrowError("process-attempt.sealed-trial-digest-mismatch");

    // Rebound digest allows the foreign trial through digest checks; profile
    // matching then rejects the 003 ops/disposition against the 000 transcript.
    const attemptBytes = exactAttemptBytes(first.attempt, (candidate) => {
      candidate.sealedTrialSha256 = sha256ProcessBytes(finance003.sealedTrialBytes);
    });
    expect(() => verifyCompletedProcessAttempt(bundle(first, {
      attemptBytes,
      sealedTrialBytes: finance003.sealedTrialBytes,
    }))).toThrowError("process-attempt.lifecycle-profile-unrecognized");
  });

  it("verifies multi-request finance-010/027/028 completed evidence bundles", () => {
    for (const run of [finance010, finance027, finance028]) {
      expect(verifyCompletedProcessAttempt(bundle(run))).toEqual(run.attempt);
      expect(run.attempt.classification).toBe("completed");
      expect(run.attempt.exitCode).toBe(0);
      expect(run.attempt.reaped).toBe(true);
    }
    expect(finance010.sealedTrial.disposition).toBe("proceed");
    expect(finance010.attempt.events.filter((event) => event.code === "request-received"))
      .toHaveLength(3);
    expect(finance027.sealedTrial.disposition).toBe("deny");
    expect(finance027.sealedTrial.scans).toHaveLength(2);
    expect(finance027.attempt.events.filter((event) => event.code === "request-received"))
      .toHaveLength(2);
    expect(finance028.sealedTrial.disposition).toBe("unresolved");
    expect(finance028.attempt.events.filter((event) => event.code === "request-received"))
      .toHaveLength(4);
  });

  it("rejects cross-lifecycle substitution among 010, 027, and 028", () => {
    const attemptBytes = exactAttemptBytes(finance010.attempt, (candidate) => {
      candidate.sealedTrialSha256 = sha256ProcessBytes(finance028.sealedTrialBytes);
    });
    expect(() => verifyCompletedProcessAttempt(bundle(finance010, {
      attemptBytes,
      sealedTrialBytes: finance028.sealedTrialBytes,
    }))).toThrowError("process-attempt.lifecycle-profile-unrecognized");

    const summarizeOntoExecute = exactAttemptBytes(finance010.attempt, (candidate) => {
      candidate.sealedTrialSha256 = sha256ProcessBytes(finance027.sealedTrialBytes);
    });
    expect(() => verifyCompletedProcessAttempt(bundle(finance010, {
      attemptBytes: summarizeOntoExecute,
      sealedTrialBytes: finance027.sealedTrialBytes,
    }))).toThrowError("process-attempt.lifecycle-profile-unrecognized");
  });
});

describe("portable attempted-crash process-attempt verifier", () => {
  it("owns and verifies the before-claim primary incomplete evidence bundle", () => {
    const verified = verifyAttemptedCrashProcessAttempt(bundle(beforeClaimPrimary));
    expect(verified).toEqual(beforeClaimPrimary.attempt);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(verified.classification).toBe("injected-crash");
    expect(verified.profileVersion).toBe(PROCESS_BRIDGE_ATTEMPTED_CRASH_PROFILE);
    expect(verified.killAttempted).toBe(true);
    expect(verified.events.map((event) => event.code))
      .toEqual([...attemptedCrashEventProgram(2)]);
  });

  it("rejects completed evidence under the attempted-crash verifier", () => {
    expect(() => verifyAttemptedCrashProcessAttempt(bundle(first)))
      .toThrowError("process-attempt.attempted-crash-classification-required");
  });

  it("rejects attempted-crash evidence under the completed verifier", () => {
    expect(() => verifyCompletedProcessAttempt(bundle(beforeClaimPrimary)))
      .toThrowError("process-attempt.completed-classification-required");
  });

  it.each([
    ["killAttempted", false],
    ["terminateWritten", true],
    ["runnerWriteClosed", true],
    ["targetChannelCleanEof", true],
    ["reaped", false],
    ["timedOut", true],
  ] as const)("rejects a rebound crash record with invalid %s", (key, value) => {
    const attemptBytes = exactAttemptBytes(beforeClaimPrimary.attempt, (candidate) => {
      candidate[key] = value;
    });
    expect(() => parseExactProcessAttemptBytes(attemptBytes))
      .toThrowError("process-attempt.attempted-crash-invariants-invalid");
  });

  it("rejects a rebound crash record with a clean completed-style exit", () => {
    const attemptBytes = exactAttemptBytes(beforeClaimPrimary.attempt, (candidate) => {
      candidate.exitCode = 0;
      candidate.signal = null;
    });
    expect(() => parseExactProcessAttemptBytes(attemptBytes))
      .toThrowError("process-attempt.attempted-crash-exit-invalid");
  });

  it("rejects a rebound crash record that claims the completed profile", () => {
    const attemptBytes = exactAttemptBytes(beforeClaimPrimary.attempt, (candidate) => {
      candidate.profileVersion = PROCESS_BRIDGE_PROFILE;
    });
    expect(() => parseExactProcessAttemptBytes(attemptBytes))
      .toThrowError("process-attempt.header-invalid");
  });

  it("rejects completed-event-program forgery on a crash classification record", () => {
    const attemptBytes = exactAttemptBytes(beforeClaimPrimary.attempt, (candidate) => {
      candidate.events = attemptedCrashEventProgram(2).slice(0, -1).map((code, sequence) => ({
        code,
        sequence,
      }));
    });
    expect(() => parseExactProcessAttemptBytes(attemptBytes))
      .toThrowError("process-attempt.event-program-invalid");
  });

  it("rejects sealed-trial digest substitution on attempted-crash evidence", () => {
    expect(() => verifyAttemptedCrashProcessAttempt(bundle(beforeClaimPrimary, {
      sealedTrialBytes: first.sealedTrialBytes,
    }))).toThrowError("process-attempt.sealed-trial-digest-mismatch");
  });

  it("rejects transcript substitutions on attempted-crash evidence", () => {
    expect(() => verifyAttemptedCrashProcessAttempt(bundle(beforeClaimPrimary, {
      runnerToTargetTranscriptBytes: first.runnerToTargetTranscriptBytes,
    }))).toThrowError("process-attempt.runner-to-target-transcript-mismatch");
    expect(() => verifyAttemptedCrashProcessAttempt(bundle(beforeClaimPrimary, {
      targetToRunnerTranscriptBytes: first.targetToRunnerTranscriptBytes,
    }))).toThrowError("process-attempt.target-to-runner-transcript-mismatch");
  });
});
