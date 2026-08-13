import type { IntentJob } from "@workspace/db";

export const intentJobTypes = [
  "fixture_sync",
  "source_collection",
  "deduplication",
  "signal_qualification",
  "fixture_matching",
  "lead_scoring",
] as const;

export type IntentJobType = (typeof intentJobTypes)[number];
export type JobCheckpoint = Record<string, unknown>;
export type JobHandler = (
  job: IntentJob,
  signal: AbortSignal,
) => Promise<JobCheckpoint>;

export const isIntentJobType = (value: string): value is IntentJobType =>
  (intentJobTypes as readonly string[]).includes(value);