import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { fixtureRecordsTable } from "./fixture-collector";

export const intentSignalsTable = pgTable(
  "intent_signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fixtureRecordId: uuid("fixture_record_id")
      .notNull()
      .references(() => fixtureRecordsTable.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    signalKey: text("signal_key").notNull(),
    sourceUrl: text("source_url").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    fixtureRecordUnique: uniqueIndex("intent_signals_fixture_record_unique").on(
      table.fixtureRecordId,
    ),
    signalKeyUnique: uniqueIndex("intent_signals_signal_key_unique").on(table.signalKey),
  }),
);

export const qualificationLlmCacheTable = pgTable(
  "qualification_llm_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentHash: text("content_hash").notNull(),
    team: text("team"),
    fixture: text("fixture"),
    ticketIntent: text("ticket_intent").notNull(),
    quantity: integer("quantity"),
    groupCorporateIntent: boolean("group_corporate_intent").notNull(),
    urgency: text("urgency").notNull(),
    confidence: real("confidence").notNull(),
    intentScore: real("intent_score").notNull(),
    reason: text("reason").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    contentHashUnique: uniqueIndex("qualification_llm_cache_content_hash_unique").on(
      table.contentHash,
    ),
  }),
);

export const signalQualificationsTable = pgTable(
  "signal_qualifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => intentSignalsTable.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    team: text("team"),
    fixture: text("fixture"),
    ticketIntent: text("ticket_intent").notNull(),
    quantity: integer("quantity"),
    groupCorporateIntent: boolean("group_corporate_intent").notNull(),
    urgency: text("urgency").notNull(),
    confidence: real("confidence").notNull(),
    intentScore: real("intent_score").notNull(),
    reason: text("reason").notNull(),
    classifier: text("classifier").notNull(),
    llmEligible: boolean("llm_eligible").notNull().default(false),
    llmCompleted: boolean("llm_completed").notNull().default(false),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    signalContentHashUnique: uniqueIndex("signal_qualifications_signal_content_hash_unique").on(
      table.signalId,
      table.contentHash,
    ),
  }),
);

export type IntentSignal = typeof intentSignalsTable.$inferSelect;
export type QualificationLlmCache = typeof qualificationLlmCacheTable.$inferSelect;
export type SignalQualification = typeof signalQualificationsTable.$inferSelect;