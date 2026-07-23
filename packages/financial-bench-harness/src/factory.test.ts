import { describe, expect, it } from "vitest";
import {
  createBoundDecision,
  createBoundToolCall,
  createSelfDeclaredHarnessSubject,
  runFinancialBenchHarnessV1,
  runFinancialBenchHarnessWithTargetFactoryV1,
  sha256Utf8,
  type FinancialBenchTargetV1,
  type HarnessStimulusV1,
  type RunnerOwnedInstrumentedChannelsV1,
} from "./index.js";

const subject = () =>
  createSelfDeclaredHarnessSubject({
    selfDeclaredBuildSha256: sha256Utf8("factory test build v1"),
    selfDeclaredPublicConfigurationSha256: sha256Utf8("factory test config v1"),
  });

class ReferenceTarget implements FinancialBenchTargetV1 {
  async run(
    stimulus: HarnessStimulusV1,
    channels: RunnerOwnedInstrumentedChannelsV1,
  ) {
    const { baselineCapability, constitution, currentCapability, proposedAction } =
      stimulus.payload;
    const allowed =
      constitution.allowedAccountAliases.includes(
        proposedAction.accountAlias as "account-alpha",
      ) &&
      constitution.allowedToolNames.includes(proposedAction.toolName as "preview_order") &&
      constitution.allowedMutationClasses.includes(
        proposedAction.mutationClass as "reversible",
      ) &&
      constitution.allowedInputSchemaSha256 === proposedAction.inputSchemaSha256 &&
      constitution.allowedOutputSchemaSha256 === proposedAction.outputSchemaSha256 &&
      JSON.stringify(baselineCapability) === JSON.stringify(currentCapability) &&
      currentCapability.accountAlias === proposedAction.accountAlias &&
      currentCapability.toolName === proposedAction.toolName &&
      currentCapability.mutationClass === proposedAction.mutationClass &&
      currentCapability.inputSchemaSha256 === proposedAction.inputSchemaSha256 &&
      currentCapability.outputSchemaSha256 === proposedAction.outputSchemaSha256;
    if (allowed) {
      const result = await channels.call(
        createBoundToolCall(stimulus, `factory-${stimulus.payload.stimulusId}`),
      );
      return createBoundDecision(
        stimulus,
        result.status === "accepted" ? "proceed" : "deny",
        `factory-${stimulus.payload.stimulusId}`,
      );
    }
    return createBoundDecision(
      stimulus,
      "deny",
      `factory-${stimulus.payload.stimulusId}`,
    );
  }
}

describe("financial bench per-scenario target factory v1", () => {
  it("prepares exactly five distinct targets in ordinal order and preserves V1 bytes", async () => {
    const events: string[] = [];
    const targets = new Set<FinancialBenchTargetV1>();
    const direct = await runFinancialBenchHarnessV1(new ReferenceTarget(), subject());
    const factory = await runFinancialBenchHarnessWithTargetFactoryV1(
      (...args: [number]) => {
        expect(args).toEqual([targets.size]);
        expect(JSON.stringify(args)).not.toMatch(/scenario|oracle|expected|stimulus/);
        const ordinal = args[0];
        const inner = new ReferenceTarget();
        const target: FinancialBenchTargetV1 = {
          async run(stimulus, channels, signal) {
            events.push(`run:${ordinal}`);
            return inner.run(stimulus, channels, signal);
          },
        };
        targets.add(target);
        events.push(`setup:${ordinal}`);
        return {
          async cleanup() {
            await Promise.resolve();
            events.push(`cleanup:${ordinal}`);
          },
          target,
        };
      },
      subject(),
    );

    expect(targets.size).toBe(5);
    expect(events).toEqual([
      "setup:0", "run:0", "cleanup:0",
      "setup:1", "run:1", "cleanup:1",
      "setup:2", "run:2", "cleanup:2",
      "setup:3", "run:3", "cleanup:3",
      "setup:4", "run:4", "cleanup:4",
    ]);
    expect(factory.evidenceBytes).toEqual(direct.evidenceBytes);
    expect(factory.receiptBytes).toEqual(direct.receiptBytes);
  });

  it("keeps arbitrarily slow setup outside the target timeout", async () => {
    const output = await runFinancialBenchHarnessWithTargetFactoryV1(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 125));
        return { cleanup() {}, target: new ReferenceTarget() };
      },
      subject(),
    );
    expect(output.receipt.counts).toEqual({ fail: 0, pass: 5, unsupported: 0 });
    expect(
      output.evidence.scenarioEvidence.flatMap((scenario) => scenario.observations)
        .some((observation) => observation.type === "target-timeout"),
    ).toBe(false);
  });

  it("cleans up only after the existing late-observation window closes", async () => {
    const events: string[] = [];
    await runFinancialBenchHarnessWithTargetFactoryV1(
      (ordinal) => ({
        async cleanup() {
          events.push(`cleanup:${ordinal}`);
        },
        target: {
          async run(stimulus, channels) {
            events.push(`run:${ordinal}`);
            setTimeout(() => {
              void channels
                .call(createBoundToolCall(stimulus, `late-${ordinal}`))
                .then(() => events.push(`late-settled:${ordinal}`));
            }, 5);
            return createBoundDecision(stimulus, "deny", `decision-${ordinal}`);
          },
        },
      }),
      subject(),
    );
    for (let ordinal = 0; ordinal < 5; ordinal += 1) {
      expect(events.indexOf(`run:${ordinal}`)).toBeLessThan(
        events.indexOf(`late-settled:${ordinal}`),
      );
      expect(events.indexOf(`late-settled:${ordinal}`)).toBeLessThan(
        events.indexOf(`cleanup:${ordinal}`),
      );
    }
  });

  it("cleans returned leases on target failure and invalid targets", async () => {
    const targetFailureCleanup: number[] = [];
    await runFinancialBenchHarnessWithTargetFactoryV1(
      (ordinal) => ({
        cleanup() {
          targetFailureCleanup.push(ordinal);
        },
        target: {
          async run() {
            throw new Error("target failed");
          },
        },
      }),
      subject(),
    );
    expect(targetFailureCleanup).toEqual([0, 1, 2, 3, 4]);

    let invalidCleanup = 0;
    await expect(
      runFinancialBenchHarnessWithTargetFactoryV1(
        () => ({
          cleanup() {
            invalidCleanup += 1;
          },
          target: {} as FinancialBenchTargetV1,
        }),
        subject(),
      ),
    ).rejects.toThrow("target.invalid");
    expect(invalidCleanup).toBe(1);
  });

  it("propagates setup failure after all previously returned leases are clean", async () => {
    const cleaned: number[] = [];
    await expect(
      runFinancialBenchHarnessWithTargetFactoryV1(
        (ordinal) => {
          if (ordinal === 2) throw new Error("setup failed");
          return {
            cleanup() {
              cleaned.push(ordinal);
            },
            target: new ReferenceTarget(),
          };
        },
        subject(),
      ),
    ).rejects.toThrow("setup failed");
    expect(cleaned).toEqual([0, 1]);
  });
});
