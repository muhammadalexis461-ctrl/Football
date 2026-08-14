import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetDashboardOverviewResponse,
  GetFixturesResponse,
  GetLeadsQueryParams,
  GetLeadsResponse,
} from "@workspace/api-zod";
import {
  dashboardMetricsTable,
  db,
  fixturesTable,
  leadsTable,
} from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/overview", async (req, res): Promise<void> => {
  const [metrics] = await db
    .select()
    .from(dashboardMetricsTable)
    .orderBy(asc(dashboardMetricsTable.id))
    .limit(1);

  if (!metrics) {
    req.log.warn("Dashboard metrics have not been configured");
    res.status(503).json({ error: "Dashboard metrics are not available" });
    return;
  }

  const [qualified, highIntent, fixtures] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leadsTable)
      .where(eq(leadsTable.status, "qualified")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leadsTable)
      .where(eq(leadsTable.intent, "HIGH")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(fixturesTable),
  ]);

  const response = {
    worker: {
      state: metrics.workerState,
      lastHeartbeat: metrics.lastHeartbeat,
      activeWorkers: metrics.activeWorkers,
      totalWorkers: metrics.totalWorkers,
    },
    lastSuccessfulCollection: metrics.lastSuccessfulCollection,
    jobsRunning: metrics.jobsRunning,
    failedJobs: metrics.failedJobs,
    signalsCollected: metrics.signalsCollected,
    qualifiedLeads: qualified[0]?.count ?? 0,
    highIntentLeads: highIntent[0]?.count ?? 0,
    fixtureMatches: fixtures[0]?.count ?? 0,
  };

  res.json(GetDashboardOverviewResponse.parse(response));
});

router.get("/leads", async (req, res): Promise<void> => {
  const parsed = GetLeadsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { search, intent, status, sort, order } = parsed.data;
  const filters: SQL[] = [];

  if (search) {
    const term = `%${search}%`;
    filters.push(
      or(
        ilike(leadsTable.name, term),
        ilike(leadsTable.company, term),
        ilike(leadsTable.email, term),
        ilike(leadsTable.signal, term),
      )!,
    );
  }
  if (intent !== "all") filters.push(eq(leadsTable.intent, intent));
  if (status !== "all") filters.push(eq(leadsTable.status, status));

  const orderBy =
    sort === "name"
      ? order === "asc"
        ? asc(leadsTable.name)
        : desc(leadsTable.name)
      : sort === "createdAt"
        ? order === "asc"
          ? asc(leadsTable.createdAt)
          : desc(leadsTable.createdAt)
        : order === "asc"
          ? asc(leadsTable.score)
          : desc(leadsTable.score);

  const leads = await db
    .select()
    .from(leadsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(orderBy);

  res.json(GetLeadsResponse.parse(leads));
});

router.get("/fixtures", async (_req, res): Promise<void> => {
  const fixtures = await db
    .select()
    .from(fixturesTable)
    .orderBy(asc(fixturesTable.kickoffAt));

  res.json(GetFixturesResponse.parse(fixtures));
});

export default router;