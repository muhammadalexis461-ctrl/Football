import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  isNotNull,
  or,
  type SQL,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  fixtureRecordsTable,
  intentJobsTable,
  intentSignalsTable,
  signalQualificationsTable,
} from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  ListDashboardLeadsQueryParams,
  ListDashboardLeadsResponse,
} from "@workspace/api-zod";
import { getWorkerHealth } from "../worker/job-queue";

const router: IRouter = Router();

const countRows = async (
  table: typeof intentSignalsTable | typeof signalQualificationsTable | typeof fixtureRecordsTable,
  condition?: SQL<unknown>,
): Promise<number> => {
  const query = db.select({ count: count() }).from(table);
  const [row] = condition ? await query.where(condition) : await query;
  return Number(row?.count ?? 0);
};

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [
    worker,
    lastCollectionRows,
    signalsCollected,
    qualifiedLeads,
    highIntentLeads,
    fixtureMatches,
  ] = await Promise.all([
    getWorkerHealth(),
    db
      .select({ finishedAt: intentJobsTable.finishedAt })
      .from(intentJobsTable)
      .where(
        and(
          eq(intentJobsTable.jobType, "fixture_sync"),
          eq(intentJobsTable.status, "succeeded"),
          isNotNull(intentJobsTable.finishedAt),
        ),
      )
      .orderBy(desc(intentJobsTable.finishedAt))
      .limit(1),
    countRows(intentSignalsTable),
    countRows(signalQualificationsTable, gt(signalQualificationsTable.intentScore, 0)),
    countRows(signalQualificationsTable, gte(signalQualificationsTable.intentScore, 70)),
    countRows(fixtureRecordsTable),
  ]);

  const summary = {
    worker,
    lastSuccessfulCollection: lastCollectionRows[0]?.finishedAt ?? null,
    jobsRunning: worker.runningJobs,
    failedJobs: worker.failedJobs,
    signalsCollected,
    qualifiedLeads,
    highIntentLeads,
    fixtureMatches,
  };

  res.json(GetDashboardSummaryResponse.parse(summary));
});

router.get("/dashboard/leads", async (req, res): Promise<void> => {
  const parsed = ListDashboardLeadsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    search,
    ticketIntent,
    urgency,
    minIntentScore,
    sortBy,
    sortOrder,
    limit,
    offset,
  } = parsed.data;
  const filters = [gt(signalQualificationsTable.intentScore, 0)];

  if (ticketIntent) {
    filters.push(eq(signalQualificationsTable.ticketIntent, ticketIntent));
  }
  if (urgency) {
    filters.push(eq(signalQualificationsTable.urgency, urgency));
  }
  if (minIntentScore !== undefined) {
    filters.push(gte(signalQualificationsTable.intentScore, minIntentScore));
  }
  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    const searchFilter = or(
      ilike(signalQualificationsTable.team, term),
      ilike(signalQualificationsTable.fixture, term),
      ilike(signalQualificationsTable.reason, term),
      ilike(intentSignalsTable.content, term),
      ilike(fixtureRecordsTable.name, term),
      ilike(fixtureRecordsTable.venue, term),
      ilike(fixtureRecordsTable.city, term),
    );
    if (searchFilter) {
      filters.push(searchFilter);
    }
  }

  const orderColumn =
    sortBy === "confidence"
      ? signalQualificationsTable.confidence
      : sortBy === "collectedAt"
        ? intentSignalsTable.observedAt
        : signalQualificationsTable.intentScore;
  const orderExpression = sortOrder === "asc" ? asc(orderColumn) : desc(orderColumn);

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: signalQualificationsTable.id,
        signalId: intentSignalsTable.id,
        team: signalQualificationsTable.team,
        fixture: signalQualificationsTable.fixture,
        ticketIntent: signalQualificationsTable.ticketIntent,
        quantity: signalQualificationsTable.quantity,
        groupCorporateIntent: signalQualificationsTable.groupCorporateIntent,
        urgency: signalQualificationsTable.urgency,
        confidence: signalQualificationsTable.confidence,
        intentScore: signalQualificationsTable.intentScore,
        reason: signalQualificationsTable.reason,
        sourceUrl: intentSignalsTable.sourceUrl,
        collectedAt: intentSignalsTable.observedAt,
        qualifiedAt: signalQualificationsTable.updatedAt,
        startsAt: fixtureRecordsTable.startsAt,
        venue: fixtureRecordsTable.venue,
        city: fixtureRecordsTable.city,
        availability: fixtureRecordsTable.availability,
      })
      .from(signalQualificationsTable)
      .innerJoin(
        intentSignalsTable,
        eq(signalQualificationsTable.signalId, intentSignalsTable.id),
      )
      .innerJoin(
        fixtureRecordsTable,
        eq(intentSignalsTable.fixtureRecordId, fixtureRecordsTable.id),
      )
      .where(and(...filters))
      .orderBy(orderExpression, desc(signalQualificationsTable.updatedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(signalQualificationsTable)
      .innerJoin(
        intentSignalsTable,
        eq(signalQualificationsTable.signalId, intentSignalsTable.id),
      )
      .innerJoin(
        fixtureRecordsTable,
        eq(intentSignalsTable.fixtureRecordId, fixtureRecordsTable.id),
      )
      .where(and(...filters)),
  ]);

  res.json(
    ListDashboardLeadsResponse.parse({
      items: rows,
      total: Number(totalRows[0]?.count ?? 0),
      limit,
      offset,
    }),
  );
});

export default router;