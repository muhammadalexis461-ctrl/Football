import type { IntentJob } from "@workspace/db";
import { logger } from "../lib/logger";
import { workerConfig } from "./config";
import { collectGoOfficialFixtures } from "./fixture-collector";
import { qualifyIntentSignals } from "./qualification";
import type { IntentJobType, JobCheckpoint, JobHandler } from "./job-types";

const foundationHandler = (jobType: IntentJobType): JobHandler =>
  async (job: IntentJob, signal: AbortSignal): Promise<JobCheckpoint> => {
    if (signal.aborted) {
      throw new Error("Job cancelled during shutdown");
    }

    logger.info(
      {
        jobId: job.id,
        jobType,
        attempt: job.attempts,
        checkpoint: job.checkpoint,
      },
      "Intent engine foundation job executed",
    );

    return {
      stage: "foundation-ready",
      jobType,
      processed: 0,
      aiCalls: 0,
      aiBatchSize: workerConfig.aiBatchSize,
      completedAt: new Date().toISOString(),
    };
  };

export const jobHandlers: Record<IntentJobType, JobHandler> = {
  fixture_sync: async (_job, signal) => collectGoOfficialFixtures(signal),
  source_collection: foundationHandler("source_collection"),
  deduplication: foundationHandler("deduplication"),
  signal_qualification: async (_job, signal) => qualifyIntentSignals(signal),
  fixture_matching: foundationHandler("fixture_matching"),
  lead_scoring: foundationHandler("lead_scoring"),
};