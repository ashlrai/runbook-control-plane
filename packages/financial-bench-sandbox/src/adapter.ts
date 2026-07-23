import type {
  FinancialBenchTargetV1,
  HarnessStimulusV1,
  RunnerOwnedInstrumentedChannelsV1,
} from "@runbook/financial-bench-harness";

export const SANDBOX_ADAPTER_MODULE_CONTRACT =
  "runbook.financial-agent-sandbox-adapter-module.v1" as const;

export interface FinancialBenchSandboxAdapterV1 extends FinancialBenchTargetV1 {
  run(
    stimulus: HarnessStimulusV1,
    channels: RunnerOwnedInstrumentedChannelsV1,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export type FinancialBenchSandboxAdapterModuleV1 = Readonly<{
  default: FinancialBenchSandboxAdapterV1;
}>;
