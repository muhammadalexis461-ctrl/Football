import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, or } from "drizzle-orm";
import {
  db,
  intentJobSchedulesTable,
  intentJobsTable,
  intentWorkerLeasesTable,
  type IntentJob,
  type IntentJobSchedule,
} from "@workspace/db";
import { logger } from "../lib/logger";
import type { IntentJobType, JobCheckpoint } from "./job-types";

const LEASE_NAME = "intent-engine";
const LEASE_OWNER = `${process.pid}-${randomUUID()}`;

type DbClient = typeof db;

export interface WorkerHealth {
  active: boolean;
  ownerId: string | null;
  heartbeatAt: Date | null;
  expiresAt: Date | null;
  queuedJobs: number;
  runningJobs: number;
  failedJobs: number;
}

const scheduleDefinitions: Array<{
  jobType: IntentJobType;
  intervalMs: number;
}> = [];

export const configureSchedules = (intervals: {
  collectionIntervalMs: number;
  fixtureSyncIntervalMs: number;
}): void => {
  scheduleDefinitions.splice(
    0,
    scheduleDefinitions.length,
    { jobType: "fixture_sync", intervalMs: intervals.fixtureSyncIntervalMs },
    { jobType: "source_collection", intervalMs: intervals.collectionIntervalMs },
    { jobType: "deduplication", intervalMs: intervals.collectionIntervalMs },
    { jobType: "signal_qualification", intervalMs: intervals.collectionIntervalMs },
    { jobType: "fixture_matching", intervalMs: intervals.collectionIntervalMs },
    { jobType: "lead_scoring", intervalMs: intervals.collectionIntervalMs },
  );
};

export const ensureSchedules = async (): Promise<void> => {
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const schedule of scheduleDefinitions) {
      await tx
        .insert(intentJobSchedulesTable)
        .values({
          jobType: schedule.jobType,
          intervalMs: schedule.intervalMs,
          nextRunAt: now,
        })
        .onConflictDoNothing();
    }
  });
};

export const acquireWorkerLease = async (leaseDurationMs: number): Promise<boolean> => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseDurationMs);
  const result = await db
    .insert(intentWorkerLeasesTable)
    .values({
      leaseName: LEASE_NAME,
      ownerId: LEASE_OWNER,
      heartbeatAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: intentWorkerLeasesTable.leaseName,
      set: {
        ownerId: LEASE_OWNER,
        heartbeatAt: now,
        expiresAt,
        updatedAt: now,
      },
      setWhere: or(
        eq(intentWorkerLeasesTable.ownerId, LEASE_OWNER),
        lt(intentWorkerLeasesTable.expiresAt, now),
      ),
    })
    .returning({ ownerId: intentWorkerLeasesTable.ownerId });

  const acquired = result[0]?.ownerId === LEASE_OWNER;
  if (!acquired) {
    logger.warn({ leaseName: LEASE_NAME }, "Another worker already owns the lease");
  }
  return acquired;
};

export const heartbeatWorkerLease = async (leaseDurationMs: number): Promise<void> => {
  const now = new Date();
  await db
    .update(intentWorkerLeasesTable)
    .set({
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + leaseDurationMs),
      updatedAt: now,
    })
    .where(
      and(
        eq(intentWorkerLeasesTable.leaseName, LEASE_NAME),
        eq(intentWorkerLeasesTable.ownerId, LEASE_OWNER),
      ),
    );
};

export const releaseWorkerLease = async (): Promise<void> => {
  await db
    .delete(intentWorkerLeasesTable)
    .where(
      and(
        eq(intentWorkerLeasesTable.leaseName, LEASE_NAME),
        eq(intentWorkerLeasesTable.ownerId, LEASE_OWNER),
      ),
    );
};

export const enqueueDueSchedules = async (): Promise<number> => {
  const now = new Date();
  let enqueued = 0;

  await db.transaction(async (tx) => {
    const dueSchedules = await tx
      .select()
      .from(intentJobSchedulesTable)
      .where(
        and(
          eq(intentJobSchedulesTable.enabled, true),
          lt(intentJobSchedulesTable.nextRunAt, now),
        ),
      )
      .for("update", { skipLocked: true });

    for (const schedule of dueSchedules) {
      const nextRunAt = new Date(now.getTime() + schedule.intervalMs);
      await tx.insert(intentJobsTable).values({
        jobType: schedule.jobType,
        payload: { scheduledBy: "scheduler", scheduledAt: now.toISOString() },
        runAfter: now,
      });
      await tx
        .update(intentJobSchedulesTable)
        .set({
          nextRunAt,
          lastEnqueuedAt: now,
          updatedAt: now,
        })
        .where(eq(intentJobSchedulesTable.jobType, schedule.jobType));
      enqueued += 1;
    }
  });

  return enqueued;
};

export const recoverStaleJobs = async (lockExpiresBefore: Date): Promise<number> => {
  const recovered = await db
    .update(intentJobsTable)
    .set({
      status: "pending",
      lockedBy: null,
      lockExpiresAt: null,
      heartbeatAt: null,
      runAfter: new Date(),
      updatedAt: new Date(),
      lastError: "Recovered after worker lease expired",
    })
    .where(
      and(
        eq(intentJobsTable.status, "running"),
        lt(intentJobsTable.lockExpiresAt, lockExpiresBefore),
      ),
    )
    .returning({ id: intentJobsTable.id });

  return recovered.length;
};

export const claimNextJob = async (
  workerId: string,
  lockDurationMs: number,
): Promise<IntentJob | null> => {
  const now = new Date();
  const lockExpiresAt = new Date(now.getTime() + lockDurationMs);

  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(intentJobsTable)
      .where(
        and(
          or(
            eq(intentJobsTable.status, "pending"),
            and(
              eq(intentJobsTable.status, "running"),
              lt(intentJobsTable.lockExpiresAt, now),
            ),
          ),
          lt(intentJobsTable.runAfter, now),
        ),
      )
      .orderBy(intentJobsTable.runAfter, intentJobsTable.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });

    if (!job) {
      return null;
    }

    const [claimed] = await tx
      .update(intentJobsTable)
      .set({
        status: "running",
        attempts: job.attempts + 1,
        lockedBy: workerId,
        lockExpiresAt,
        heartbeatAt: now,
        startedAt: job.startedAt ?? now,
        updatedAt: now,
      })
      .where(eq(intentJobsTable.id, job.id))
      .returning();

    return claimed ?? null;
  });
};

export const heartbeatJob = async (
  jobId: string,
  workerId: string,
  lockDurationMs: number,
): Promise<void> => {
  const now = new Date();
  await db
    .update(intentJobsTable)
    .set({
      heartbeatAt: now,
      lockExpiresAt: new Date(now.getTime() + lockDurationMs),
      updatedAt: now,
    })
    .where(
      and(
        eq(intentJobsTable.id, jobId),
        eq(intentJobsTable.status, "running"),
        eq(intentJobsTable.lockedBy, workerId),
      ),
    );
};

export const completeJob = async (
  jobId: string,
  workerId: string,
  checkpoint: JobCheckpoint,
): Promise<void> => {
  const now = new Date();
  await db
    .update(intentJobsTable)
    .set({
      status: "succeeded",
      checkpoint,
      lockedBy: null,
      lockExpiresAt: null,
      heartbeatAt: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(intentJobsTable.id, jobId),
        eq(intentJobsTable.status, "running"),
        eq(intentJobsTable.lockedBy, workerId),
      ),
    );
};

export const failJob = async (
  job: IntentJob,
  workerId: string,
  error: unknown,
): Promise<void> => {
  const now = new Date();
  const message = error instanceof Error ? error.message : String(error);
  const retryable = job.attempts < job.maxAttempts;
  const backoffMs = Math.min(60 * 60 * 1000, 1_000 * 2 ** Math.max(job.attempts - 1, 0));

  await db
    .update(intentJobsTable)
    .set({
      status: retryable ? "pending" : "failed",
      runAfter: retryable ? new Date(now.getTime() + backoffMs) : now,
      lockedBy: null,
      lockExpiresAt: null,
      heartbeatAt: null,
      finishedAt: retryable ? null : now,
      lastError: message.slice(0, 4_000),
      updatedAt: now,
    })
    .where(
      and(
        eq(intentJobsTable.id, job.id),
        eq(intentJobsTable.status, "running"),
        eq(intentJobsTable.lockedBy, workerId),
      ),
    );
};

export const getWorkerHealth = async (): Promise<WorkerHealth> => {
  const [lease] = await db
    .select()
    .from(intentWorkerLeasesTable)
    .where(eq(intentWorkerLeasesTable.leaseName, LEASE_NAME))
    .limit(1);
  const [queued] = await db
    .select({ count: intentJobsTable.id })
    .from(intentJobsTable)
    .where(eq(intentJobsTable.status, "pending"));
  const [running] = await db
    .select({ count: intentJobsTable.id })
    .from(intentJobsTable)
    .where(eq(intentJobsTable.status, "running"));
  const [failed] = await db
    .select({ count: intentJobsTable.id })
    .from(intentJobsTable)
    .where(eq(intentJobsTable.status, "failed"));

  return {
    active: Boolean(lease && lease.expiresAt > new Date()),
    ownerId: lease?.ownerId ?? null,
    heartbeatAt: lease?.heartbeatAt ?? null,
    expiresAt: lease?.expiresAt ?? null,
    queuedJobs: Number(queued?.count ?? 0),
    runningJobs: Number(running?.count ?? 0),
    failedJobs: Number(failed?.count ?? 0),
  };
};

export const getScheduleSnapshot = async (): Promise<IntentJobSchedule[]> =>
  db
    .select()
    .from(intentJobSchedulesTable)
    .where(inArray(intentJobSchedulesTable.jobType, scheduleDefinitions.map(({ jobType }) => jobType)));

export const getWorkerOwnerId = (): string => LEASE_OWNER;

export const logQueueError = (error: unknown): void => {
  logger.error({ err: error }, "Intent engine queue operation failed");
};