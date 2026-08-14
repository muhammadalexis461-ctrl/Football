import { and, eq } from "drizzle-orm";
import {
  db,
  fixtureRecordsTable,
  intentSignalsTable,
  type FixtureRecord,
  type IntentSignal,
} from "@workspace/db";

const value = (item: unknown): string | null => {
  if (typeof item === "string") {
    const trimmed = item.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof item === "number" || typeof item === "boolean") {
    return String(item);
  }
  return null;
};

const signalContent = (record: FixtureRecord): string => {
  const raw = record.rawData;
  return [
    `fixture: ${record.name}`,
    `type: ${record.fixtureType}`,
    `startsAt: ${record.startsAt?.toISOString() ?? value(raw["startsAt"]) ?? ""}`,
    `endsAt: ${record.endsAt?.toISOString() ?? value(raw["endsAt"]) ?? ""}`,
    `venue: ${record.venue ?? ""}`,
    `city: ${record.city ?? ""}`,
    `package: ${record.packageName ?? ""}`,
    `price: ${record.priceText ?? record.priceAmount?.toString() ?? ""}`,
    `currency: ${record.currency ?? ""}`,
    `availability: ${record.availability ?? ""}`,
    `source: ${record.sourceUrl}`,
  ].join("\n");
};

export const upsertSignalForFixture = async (
  record: FixtureRecord,
): Promise<IntentSignal> => {
  const signalKey = `fixture-record:${record.id}`;
  const content = signalContent(record);
  const [existing] = await db
    .select()
    .from(intentSignalsTable)
    .where(eq(intentSignalsTable.fixtureRecordId, record.id))
    .limit(1);

  if (existing?.contentHash === record.recordHash) {
    return existing;
  }

  if (existing) {
    const [updated] = await db
      .update(intentSignalsTable)
      .set({
        sourceId: record.sourceId,
        sourceUrl: record.sourceUrl,
        content,
        contentHash: record.recordHash,
        rawData: record.rawData,
        observedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(intentSignalsTable.id, existing.id))
      .returning();
    if (!updated) {
      throw new Error(`Unable to update intent signal ${existing.id}`);
    }
    return updated;
  }

  const [created] = await db
    .insert(intentSignalsTable)
    .values({
      fixtureRecordId: record.id,
      sourceId: record.sourceId,
      signalKey,
      sourceUrl: record.sourceUrl,
      content,
      contentHash: record.recordHash,
      rawData: record.rawData,
    })
    .returning();
  if (!created) {
    throw new Error(`Unable to create intent signal for fixture ${record.id}`);
  }
  return created;
};

export const getFixtureRecordsForSignalBackfill = async (
  limit: number,
): Promise<FixtureRecord[]> =>
  db.select().from(fixtureRecordsTable).limit(limit);