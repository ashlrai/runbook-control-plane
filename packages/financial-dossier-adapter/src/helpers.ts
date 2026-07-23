import {
  parseChannelRequestV2,
  parseChannelResultV2,
  parseRunnerToTargetFrameV2,
  parseTargetToRunnerFrameV2,
  parseTargetChallengeV2,
  parseTargetConclusionV2,
  parseTargetSessionV2,
} from "./validate.js";
import type {
  ChannelRequestV2,
  ChannelResultV2,
  RunnerToTargetFrameV2,
  TargetToRunnerFrameV2,
  TargetChallengeV2,
  TargetConclusionV2,
  TargetSessionV2,
} from "./types.js";

export const createTargetSessionV2 = (value: unknown): TargetSessionV2 =>
  parseTargetSessionV2(value);
export const createTargetChallengeV2 = (value: unknown): TargetChallengeV2 =>
  parseTargetChallengeV2(value);
export const createChannelRequestV2 = (value: unknown): ChannelRequestV2 =>
  parseChannelRequestV2(value);
export const createChannelResultV2 = (value: unknown): ChannelResultV2 =>
  parseChannelResultV2(value);
export const createTargetConclusionV2 = (value: unknown): TargetConclusionV2 =>
  parseTargetConclusionV2(value);
export const createRunnerToTargetFrameV2 = (
  value: unknown,
): RunnerToTargetFrameV2 => parseRunnerToTargetFrameV2(value);
export const createTargetToRunnerFrameV2 = (
  value: unknown,
): TargetToRunnerFrameV2 => parseTargetToRunnerFrameV2(value);
