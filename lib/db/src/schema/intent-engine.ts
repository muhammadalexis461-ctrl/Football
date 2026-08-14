import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const intentJobTypeEnum = pgEnum("intent_job_type", [
  "fixture_sync",
  "source_collection",
  "deduplication",
  "signal_qualification",
  "fixture_matching",
  "lead_scoring",
]);

export const intentJobStatusEnum = pgEnum("intent_job_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
]);

export const intentJobsTable = pgTable("intent_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobType: intentJobTypeEnum("job_type").notNull(),
  status: intentJobStatusEnum("status").notNull().default("pending"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  checkpoint: jsonb("checkpoint").$type<Record<string, unknown> | null>(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
  lockedBy: text("locked_by"),
  lockExpiresAt: timestamp("lock_expires_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const intentJobSchedulesTable = pgTable("intent_job_schedules", {
  jobType: intentJobTypeEnum("job_type").primaryKey(),
  intervalMs: integer("interval_ms").notNull(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastEnqueuedAt: timestamp("last_enqueued_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const intentWorkerLeasesTable = pgTable("intent_worker_leases", {
  leaseName: text("lease_name").primaryKey(),
  ownerId: text("owner_id").notNull(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIntentJobSchema = createInsertSchema(intentJobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertIntentJob = z.infer<typeof insertIntentJobSchema>;
export type IntentJob = typeof intentJobsTable.$inferSelect;
export type IntentJobSchedule = typeof intentJobSchedulesTable.$inferSelect;
export type IntentWorkerLease = typeof intentWorkerLeasesTable.$inferSelect;