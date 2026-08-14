import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dashboardMetricsTable = pgTable("dashboard_metrics", {
  id: serial("id").primaryKey(),
  workerState: text("worker_state").notNull().default("online"),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }).notNull(),
  lastSuccessfulCollection: timestamp("last_successful_collection", {
    withTimezone: true,
  }).notNull(),
  activeWorkers: integer("active_workers").notNull().default(0),
  totalWorkers: integer("total_workers").notNull().default(0),
  jobsRunning: integer("jobs_running").notNull().default(0),
  failedJobs: integer("failed_jobs").notNull().default(0),
  signalsCollected: integer("signals_collected").notNull().default(0),
});

export const leadsTable = pgTable("leads", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company").notNull(),
  email: text("email").notNull(),
  source: text("source").notNull(),
  score: integer("score").notNull(),
  intent: text("intent").notNull(),
  status: text("status").notNull(),
  signal: text("signal").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  lastActivity: timestamp("last_activity", { withTimezone: true }).notNull(),
});

export const fixturesTable = pgTable("fixtures", {
  id: text("id").primaryKey(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  competition: text("competition").notNull(),
  kickoffAt: timestamp("kickoff_at", { withTimezone: true }).notNull(),
  venue: text("venue").notNull(),
  status: text("status").notNull(),
  confidence: integer("confidence").notNull(),
});

export const insertDashboardMetricsSchema = createInsertSchema(
  dashboardMetricsTable,
).omit({ id: true });
export const insertLeadSchema = createInsertSchema(leadsTable);
export const insertFixtureSchema = createInsertSchema(fixturesTable);

export type InsertDashboardMetrics = z.infer<
  typeof insertDashboardMetricsSchema
>;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type InsertFixture = z.infer<typeof insertFixtureSchema>;
export type DashboardMetrics = typeof dashboardMetricsTable.$inferSelect;
export type Lead = typeof leadsTable.$inferSelect;
export type Fixture = typeof fixturesTable.$inferSelect;