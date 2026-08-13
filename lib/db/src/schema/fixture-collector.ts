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

export const collectorSourcesTable = pgTable(
  "collector_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    url: text("url").notNull(),
    host: text("host").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    etag: text("etag"),
    lastModified: text("last_modified"),
    contentHash: text("content_hash"),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
    robotsCheckedAt: timestamp("robots_checked_at", { withTimezone: true }),
    robotsAllowed: boolean("robots_allowed").notNull().default(false),
    crawlDelayMs: integer("crawl_delay_ms").notNull().default(1_000),
    nextRequestAt: timestamp("next_request_at", { withTimezone: true }),
    failureCount: integer("failure_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    urlUnique: uniqueIndex("collector_sources_url_unique").on(table.url),
  }),
);

export const fixtureRecordsTable = pgTable(
  "fixture_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => collectorSourcesTable.id, { onDelete: "cascade" }),
    externalKey: text("external_key").notNull(),
    name: text("name").notNull(),
    fixtureType: text("fixture_type").notNull().default("fixture"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    venue: text("venue"),
    city: text("city"),
    packageName: text("package_name"),
    priceAmount: real("price_amount"),
    priceText: text("price_text"),
    currency: text("currency"),
    availability: text("availability"),
    sourceUrl: text("source_url").notNull(),
    rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull(),
    recordHash: text("record_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sourceExternalKeyUnique: uniqueIndex("fixture_records_source_external_key_unique").on(
      table.sourceId,
      table.externalKey,
    ),
  }),
);

export type CollectorSource = typeof collectorSourcesTable.$inferSelect;
export type FixtureRecord = typeof fixtureRecordsTable.$inferSelect;