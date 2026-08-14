import { logger } from "../lib/logger";
import { workerConfig } from "./config";
import {
  configureSchedules,
  enqueueDueSchedules,
  ensureSchedules,
  heartbeatWorkerLease,
  logQueueError,
} from "./job-queue";

export interface SchedulerHandle {
  stop: () => void;
}

export const startScheduler = (): SchedulerHandle => {
  configureSchedules(workerConfig);
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      await ensureSchedules();
      const enqueued = await enqueueDueSchedules();
      await heartbeatWorkerLease(workerConfig.leaseDurationMs);
      if (enqueued > 0) {
        logger.info({ enqueued }, "Intent engine schedules enqueued jobs");
      }
    } catch (error) {
      logQueueError(error);
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), workerConfig.schedulerPollIntervalMs);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
};