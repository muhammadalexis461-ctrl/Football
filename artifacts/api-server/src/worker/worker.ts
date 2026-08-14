import { logger } from "../lib/logger";
import { workerConfig } from "./config";
import { jobHandlers } from "./handlers";
import { RateLimiter } from "./rate-limiter";
import {
  acquireWorkerLease,
  claimNextJob,
  completeJob,
  failJob,
  getWorkerOwnerId,
  heartbeatJob,
  logQueueError,
  recoverStaleJobs,
  releaseWorkerLease,
} from "./job-queue";
import type { JobHandler } from "./job-types";

export interface WorkerHandle {
  stop: () => Promise<void>;
}

const wait = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

const runJob = async (
  handler: JobHandler,
  jobId: string,
  workerId: string,
  signal: AbortSignal,
  job: Parameters<JobHandler>[0],
): Promise<void> => {
  const heartbeatTimer = setInterval(
    () => void heartbeatJob(jobId, workerId, workerConfig.jobLockDurationMs).catch(logQueueError),
    Math.max(1_000, Math.floor(workerConfig.jobLockDurationMs / 3)),
  );

  try {
    const checkpoint = await handler(job, signal);
    await completeJob(jobId, workerId, checkpoint);
  } catch (error) {
    await failJob(job, workerId, error);
    logger.error({ err: error, jobId, jobType: job.jobType }, "Intent engine job failed");
  } finally {
    clearInterval(heartbeatTimer);
  }
};

export const startWorker = async (): Promise<WorkerHandle | null> => {
  const workerId = getWorkerOwnerId();
  let acquired = await acquireWorkerLease(workerConfig.leaseDurationMs);
  while (!acquired) {
    await wait(workerConfig.schedulerPollIntervalMs);
    acquired = await acquireWorkerLease(workerConfig.leaseDurationMs);
  }

  const controller = new AbortController();
  const rateLimiter = new RateLimiter(workerConfig.requestRatePerSecond);
  let stopped = false;
  const activeJobs = new Set<Promise<void>>();

  const poll = async (): Promise<void> => {
    if (stopped || activeJobs.size >= workerConfig.maxConcurrency) {
      return;
    }

    const staleJobs = await recoverStaleJobs(
      new Date(Date.now() - workerConfig.jobLockDurationMs),
    );
    if (staleJobs > 0) {
      logger.warn({ staleJobs }, "Recovered stale intent engine jobs");
    }

    while (!stopped && activeJobs.size < workerConfig.maxConcurrency) {
      const job = await claimNextJob(workerId, workerConfig.jobLockDurationMs);
      if (!job) {
        break;
      }

      const handler = jobHandlers[job.jobType];
      const task = rateLimiter
        .take(controller.signal)
        .then(() => runJob(handler, job.id, workerId, controller.signal, job))
        .catch(logQueueError)
        .finally(() => activeJobs.delete(task));
      activeJobs.add(task);
    }
  };

  const timer = setInterval(() => void poll().catch(logQueueError), workerConfig.jobPollIntervalMs);
  void poll().catch(logQueueError);

  logger.info(
    {
      workerId,
      maxConcurrency: workerConfig.maxConcurrency,
      requestRatePerSecond: workerConfig.requestRatePerSecond,
      aiBatchSize: workerConfig.aiBatchSize,
    },
    "Intent engine worker started",
  );

  return {
    stop: async (): Promise<void> => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(timer);
      controller.abort();
      await Promise.allSettled(activeJobs);
      await releaseWorkerLease();
      logger.info({ workerId }, "Intent engine worker stopped");
    },
  };
};