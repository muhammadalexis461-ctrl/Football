import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  collectorSourcesTable,
  db,
  fixtureRecordsTable,
  type CollectorSource,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { workerConfig } from "./config";
import { RateLimiter } from "./rate-limiter";
import type { JobCheckpoint } from "./job-types";

const USER_AGENT = "GoOfficial-Intent-Engine/1.0 (+public-fixture-collector)";
const ROBOTS_CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_RETRIES = 3;
const DEFAULT_CRAWL_DELAY_MS = 1_000;
const httpRateLimiter = new RateLimiter(workerConfig.requestRatePerSecond);

type JsonObject = Record<string, unknown>;

interface ExtractedFixture {
  externalKey: string;
  name: string;
  fixtureType: string;
  startsAt: Date | null;
  endsAt: Date | null;
  venue: string | null;
  city: string | null;
  packageName: string | null;
  priceAmount: number | null;
  priceText: string | null;
  currency: string | null;
  availability: string | null;
  sourceUrl: string;
  rawData: JsonObject;
}

interface RobotsPolicy {
  allowed: boolean;
  crawlDelayMs: number;
}

interface FetchResult {
  status: number;
  body: string | null;
  etag: string | null;
  lastModified: string | null;
}

interface SyncResult {
  sources: number;
  fetched: number;
  unchangedPages: number;
  changedPages: number;
  insertedRecords: number;
  updatedRecords: number;
  skippedRobots: number;
  errors: number;
}

const configuredSourceUrls = (): string[] =>
  (process.env["GOOFFICIAL_FIXTURE_SOURCES"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);

const parseHttpUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    url.hash = "";
    return url;
  } catch {
    return null;
  }
};

const sleep = (durationMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Fixture collection cancelled during shutdown"));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("Fixture collection cancelled during shutdown"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

const retryAfterMs = (value: string | null): number => {
  if (!value) {
    return 0;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.min(60_000, seconds * 1_000));
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.max(0, Math.min(60_000, date - Date.now()));
};

const fetchWithRetries = async (
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await httpRateLimiter.take(signal);
    try {
      const response = await fetch(url, { ...init, signal });
      if (
        response.ok ||
        response.status === 304 ||
        (response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 429)
      ) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status} from ${url}`);
      if (attempt === MAX_RETRIES) {
        break;
      }
      await sleep(
        Math.max(1_000 * 2 ** attempt, retryAfterMs(response.headers.get("retry-after"))),
        signal,
      );
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) {
        break;
      }
      await sleep(1_000 * 2 ** attempt, signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Unable to fetch ${url}`);
};

const parseRobotsRules = (body: string, targetPath: string): RobotsPolicy => {
  const blocks: Array<{ agents: string[]; rules: Array<{ allow: boolean; value: string }> }> =
    [];
  let current: { agents: string[]; rules: Array<{ allow: boolean; value: string }> } | null =
    null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    if (!line) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }
    const directive = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (directive === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        blocks.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (directive === "allow" || directive === "disallow") {
      current ??= { agents: ["*"], rules: [] };
      if (!blocks.includes(current)) {
        blocks.push(current);
      }
      current.rules.push({ allow: directive === "allow", value });
    }
  }

  const matching = blocks.filter((block) =>
    block.agents.some(
      (agent) =>
        agent === "*" ||
        USER_AGENT.toLowerCase().startsWith(agent) ||
        agent.startsWith(USER_AGENT.split("/")[0].toLowerCase()),
    ),
  );
  const rules = matching.flatMap((block) => block.rules).filter((rule) => rule.value.length > 0);
  const matchingRules = rules
    .map((rule) => ({
      ...rule,
      length: robotsRuleMatches(rule.value, targetPath) ? rule.value.replace(/\*+/g, "").length : -1,
    }))
    .filter((rule) => rule.length >= 0)
    .sort((a, b) => b.length - a.length);

  return {
    allowed: matchingRules[0]?.allow ?? true,
    crawlDelayMs: parseCrawlDelay(body),
  };
};

const robotsRuleMatches = (rule: string, targetPath: string): boolean => {
  const endAnchored = rule.endsWith("$");
  const ruleBody = endAnchored ? rule.slice(0, -1) : rule;
  const pattern = ruleBody.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try {
    return new RegExp(`^${pattern}${endAnchored ? "$" : ""}`).test(targetPath);
  } catch {
    return false;
  }
};

const parseCrawlDelay = (body: string): number => {
  for (const rawLine of body.split(/\r?\n/)) {
    const match = rawLine.split("#", 1)[0].match(/^\s*crawl-delay\s*:\s*(\d+(?:\.\d+)?)\s*$/i);
    if (match) {
      return Math.min(
        60_000,
        Math.max(DEFAULT_CRAWL_DELAY_MS, Math.round(Number(match[1]) * 1_000)),
      );
    }
  }
  return DEFAULT_CRAWL_DELAY_MS;
};

const getRobotsPolicy = async (
  source: CollectorSource,
  signal: AbortSignal,
): Promise<RobotsPolicy> => {
  const now = Date.now();
  if (
    source.robotsCheckedAt &&
    now - source.robotsCheckedAt.getTime() < ROBOTS_CACHE_MS
  ) {
    return {
      allowed: source.robotsAllowed,
      crawlDelayMs: source.crawlDelayMs,
    };
  }

  const sourceUrl = new URL(source.url);
  const robotsUrl = new URL("/robots.txt", sourceUrl);
  try {
    const response = await fetchWithRetries(
      robotsUrl.toString(),
      { headers: { "user-agent": USER_AGENT, accept: "text/plain" } },
      signal,
    );
    const policy =
      response.status === 404
        ? { allowed: true, crawlDelayMs: DEFAULT_CRAWL_DELAY_MS }
        : parseRobotsRules(await response.text(), sourceUrl.pathname);
    await db
      .update(collectorSourcesTable)
      .set({
        robotsCheckedAt: new Date(),
        robotsAllowed: policy.allowed,
        crawlDelayMs: policy.crawlDelayMs,
        updatedAt: new Date(),
      })
      .where(eq(collectorSourcesTable.id, source.id));
    return policy;
  } catch (error) {
    await db
      .update(collectorSourcesTable)
      .set({
        robotsCheckedAt: new Date(),
        robotsAllowed: false,
        lastError: "robots.txt could not be read; source skipped",
        updatedAt: new Date(),
      })
      .where(eq(collectorSourcesTable.id, source.id));
    logger.warn({ err: error, url: source.url }, "Fixture source blocked because robots.txt could not be read");
    return { allowed: false, crawlDelayMs: DEFAULT_CRAWL_DELAY_MS };
  }
};

const readResponseBody = async (response: Response): Promise<string> => {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`Fixture source response exceeds ${MAX_SOURCE_BYTES} bytes`);
  }
  return buffer.toString("utf8");
};

const sourceFetch = async (
  source: CollectorSource,
  policy: RobotsPolicy,
  signal: AbortSignal,
): Promise<FetchResult> => {
  if (source.nextRequestAt && source.nextRequestAt.getTime() > Date.now()) {
    await sleep(source.nextRequestAt.getTime() - Date.now(), signal);
  }

  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "text/html,application/xhtml+xml,application/json;q=0.9",
  };
  if (source.etag) {
    headers["if-none-match"] = source.etag;
  }
  if (source.lastModified) {
    headers["if-modified-since"] = source.lastModified;
  }

  try {
    const response = await fetchWithRetries(source.url, { headers }, signal);
    const result: FetchResult = {
      status: response.status,
      body: response.status === 304 ? null : await readResponseBody(response),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
    await db
      .update(collectorSourcesTable)
      .set({
        etag: result.etag ?? source.etag,
        lastModified: result.lastModified ?? source.lastModified,
        lastFetchedAt: new Date(),
        nextRequestAt: new Date(Date.now() + policy.crawlDelayMs),
        failureCount: 0,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(collectorSourcesTable.id, source.id));
    return result;
  } catch (error) {
    await db
      .update(collectorSourcesTable)
      .set({
        failureCount: source.failureCount + 1,
        lastError: String(error).slice(0, 4_000),
        nextRequestAt: new Date(Date.now() + policy.crawlDelayMs),
        updatedAt: new Date(),
      })
      .where(eq(collectorSourcesTable.id, source.id));
    throw error;
  }
};

const stripHtml = (value: string): string =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

const stringValue = (value: unknown): string | null => {
  if (typeof value === "string") {
    const cleaned = stripHtml(value);
    return cleaned || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
};

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    const result = stringValue(value);
    if (result) {
      return result;
    }
  }
  return null;
};

const objectValue = (value: unknown): JsonObject | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;

const dateValue = (value: unknown): Date | null => {
  const text = stringValue(value);
  if (!text) {
    return null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const numberValue = (value: unknown): number | null => {
  const text = stringValue(value);
  if (!text) {
    return null;
  }
  const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  const object = objectValue(value);
  if (!object) {
    return value;
  }
  return Object.keys(object)
    .sort()
    .reduce<JsonObject>((result, key) => {
      result[key] = stableValue(object[key]);
      return result;
    }, {});
};

const hashValue = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");

const jsonLdObjects = (html: string): JsonObject[] => {
  const records: JsonObject[] = [];
  const scriptPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    try {
      const parsed = JSON.parse(match[1].trim()) as unknown;
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        const object = objectValue(value);
        if (!object) {
          return;
        }
        if (object["@graph"]) {
          visit(object["@graph"]);
        }
        if (object["@type"] || object.name || object.offers || object.startDate) {
          records.push(object);
        }
        Object.values(object).forEach((child) => {
          if (Array.isArray(child) || objectValue(child)) {
            visit(child);
          }
        });
      };
      visit(parsed);
    } catch {
      logger.debug("Ignored invalid JSON-LD fixture source block");
    }
  }
  return records;
};

const typeName = (value: unknown): string =>
  Array.isArray(value) ? firstString(...value) ?? "fixture" : firstString(value) ?? "fixture";

const canonicalRecord = (record: JsonObject, sourceUrl: string): ExtractedFixture | null => {
  const offers = Array.isArray(record.offers)
    ? objectValue(record.offers[0])
    : objectValue(record.offers);
  const location = objectValue(record.location);
  const address = objectValue(location?.address) ?? objectValue(record.address);
  const name = firstString(record.name, record.title, record.eventName);
  if (!name) {
    return null;
  }

  const url = parseHttpUrl(firstString(record.url, sourceUrl) ?? sourceUrl)?.toString() ?? sourceUrl;
  const priceText = firstString(
    offers?.price,
    offers?.lowPrice,
    record.price,
    record.priceText,
  );
  const currency = firstString(
    offers?.priceCurrency,
    record.priceCurrency,
    priceText?.match(/[A-Z]{3}/)?.[0],
  );
  const availability = firstString(offers?.availability, record.availability);
  const startsAt = dateValue(record.startDate ?? record.startTime ?? record.date);
  const endsAt = dateValue(record.endDate ?? record.endTime);
  const fixtureType = typeName(record["@type"]).replace(/Event$/i, "") || "fixture";
  const identity = firstString(record["@id"], record.identifier, record.sku, url) ?? url;
  const rawData = {
    sourceUrl: url,
    type: fixtureType,
    name,
    startsAt: startsAt?.toISOString() ?? null,
    endsAt: endsAt?.toISOString() ?? null,
    venue: firstString(location?.name, location?.address),
    city: firstString(address?.addressLocality, record.city),
    packageName: firstString(record.packageName, record.package, record.bundleName),
    priceAmount: numberValue(priceText),
    priceText,
    currency,
    availability,
    identity,
  };

  return {
    externalKey: hashValue(`${url}|${identity}|${startsAt?.toISOString() ?? ""}`),
    name,
    fixtureType,
    startsAt,
    endsAt,
    venue: rawData.venue,
    city: rawData.city,
    packageName: rawData.packageName,
    priceAmount: rawData.priceAmount,
    priceText,
    currency,
    availability,
    sourceUrl: url,
    rawData,
  };
};

const extractFixtures = (body: string, sourceUrl: string): ExtractedFixture[] => {
  const byKey = new Map<string, ExtractedFixture>();
  for (const candidate of jsonLdObjects(body)) {
    const record = canonicalRecord(candidate, sourceUrl);
    if (record) {
      byKey.set(record.externalKey, record);
    }
  }
  return [...byKey.values()];
};

const getOrCreateSource = async (url: URL): Promise<CollectorSource> => {
  await db
    .insert(collectorSourcesTable)
    .values({ url: url.toString(), host: url.host })
    .onConflictDoNothing();
  const [source] = await db
    .select()
    .from(collectorSourcesTable)
    .where(eq(collectorSourcesTable.url, url.toString()))
    .limit(1);
  if (!source) {
    throw new Error(`Unable to load collector source ${url.toString()}`);
  }
  return source;
};

const saveChangedRecords = async (
  source: CollectorSource,
  records: ExtractedFixture[],
): Promise<{ inserted: number; updated: number }> => {
  let inserted = 0;
  let updated = 0;
  for (const record of records) {
    const recordHash = hashValue(record.rawData);
    const [existing] = await db
      .select()
      .from(fixtureRecordsTable)
      .where(
        and(
          eq(fixtureRecordsTable.sourceId, source.id),
          eq(fixtureRecordsTable.externalKey, record.externalKey),
        ),
      )
      .limit(1);

    if (!existing) {
      await db.insert(fixtureRecordsTable).values({
        sourceId: source.id,
        externalKey: record.externalKey,
        name: record.name,
        fixtureType: record.fixtureType,
        startsAt: record.startsAt,
        endsAt: record.endsAt,
        venue: record.venue,
        city: record.city,
        packageName: record.packageName,
        priceAmount: record.priceAmount,
        priceText: record.priceText,
        currency: record.currency,
        availability: record.availability,
        sourceUrl: record.sourceUrl,
        rawData: record.rawData,
        recordHash,
      });
      inserted += 1;
      continue;
    }

    if (existing.recordHash === recordHash) {
      continue;
    }

    await db
      .update(fixtureRecordsTable)
      .set({
        name: record.name,
        fixtureType: record.fixtureType,
        startsAt: record.startsAt,
        endsAt: record.endsAt,
        venue: record.venue,
        city: record.city,
        packageName: record.packageName,
        priceAmount: record.priceAmount,
        priceText: record.priceText,
        currency: record.currency,
        availability: record.availability,
        sourceUrl: record.sourceUrl,
        rawData: record.rawData,
        recordHash,
        lastChangedAt: new Date(),
      })
      .where(eq(fixtureRecordsTable.id, existing.id));
    updated += 1;
  }
  return { inserted, updated };
};

const syncSource = async (
  source: CollectorSource,
  signal: AbortSignal,
): Promise<{
  fetched: boolean;
  unchanged: boolean;
  changed: boolean;
  inserted: number;
  updated: number;
  skippedRobots: boolean;
}> => {
  const policy = await getRobotsPolicy(source, signal);
  if (!policy.allowed) {
    return { fetched: false, unchanged: false, changed: false, inserted: 0, updated: 0, skippedRobots: true };
  }

  const result = await sourceFetch(source, policy, signal);
  if (result.status === 304 || !result.body) {
    return { fetched: true, unchanged: true, changed: false, inserted: 0, updated: 0, skippedRobots: false };
  }

  const contentHash = hashValue(result.body);
  if (source.contentHash === contentHash) {
    await db
      .update(collectorSourcesTable)
      .set({ contentHash, updatedAt: new Date() })
      .where(eq(collectorSourcesTable.id, source.id));
    return { fetched: true, unchanged: true, changed: false, inserted: 0, updated: 0, skippedRobots: false };
  }

  const records = extractFixtures(result.body, source.url);
  const changed = await saveChangedRecords(source, records);
  await db
    .update(collectorSourcesTable)
    .set({
      contentHash,
      lastChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(collectorSourcesTable.id, source.id));

  return {
    fetched: true,
    unchanged: false,
    changed: true,
    inserted: changed.inserted,
    updated: changed.updated,
    skippedRobots: false,
  };
};

export const collectGoOfficialFixtures = async (
  signal: AbortSignal,
): Promise<JobCheckpoint> => {
  const configuredUrls = configuredSourceUrls();
  const result: SyncResult = {
    sources: configuredUrls.length,
    fetched: 0,
    unchangedPages: 0,
    changedPages: 0,
    insertedRecords: 0,
    updatedRecords: 0,
    skippedRobots: 0,
    errors: 0,
  };

  if (configuredUrls.length === 0) {
    logger.warn(
      "Fixture sync skipped: GOOFFICIAL_FIXTURE_SOURCES has no configured public URLs",
    );
    return {
      stage: "fixture-sync",
      ...result,
      completedAt: new Date().toISOString(),
    };
  }

  for (const configuredUrl of configuredUrls) {
    if (signal.aborted) {
      throw new Error("Fixture collection cancelled during shutdown");
    }
    const url = parseHttpUrl(configuredUrl);
    if (!url) {
      result.errors += 1;
      logger.warn({ url: configuredUrl }, "Ignored invalid fixture source URL");
      continue;
    }

    const source = await getOrCreateSource(url);
    if (!source.enabled) {
      logger.info({ url: source.url }, "Fixture source is disabled; skipped");
      continue;
    }
    try {
      const synced = await syncSource(source, signal);
      if (synced.fetched) {
        result.fetched += 1;
      }
      if (synced.unchanged) {
        result.unchangedPages += 1;
      }
      if (synced.changed) {
        result.changedPages += 1;
      }
      result.insertedRecords += synced.inserted;
      result.updatedRecords += synced.updated;
      if (synced.skippedRobots) {
        result.skippedRobots += 1;
      }
    } catch (error) {
      result.errors += 1;
      logger.error({ err: error, url: source.url }, "Fixture source sync failed");
    }
  }

  logger.info(result, "GoOfficial fixture sync completed");
  return {
    stage: "fixture-sync",
    ...result,
    completedAt: new Date().toISOString(),
  };
};