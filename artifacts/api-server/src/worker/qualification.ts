import { and, eq } from "drizzle-orm";
import {
  db,
  intentSignalsTable,
  qualificationLlmCacheTable,
  signalQualificationsTable,
  type IntentSignal,
  type SignalQualification,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { workerConfig } from "./config";
import {
  getFixtureRecordsForSignalBackfill,
  upsertSignalForFixture,
} from "./signal-store";
import type { JobCheckpoint } from "./job-types";

const OPENAI_MODEL = process.env["OPENAI_MODEL"] ?? "gpt-5-mini";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const MAX_SIGNAL_BATCH = workerConfig.aiBatchSize * 4;
const LLM_TIMEOUT_MS = 45_000;

type TicketIntent = "tickets" | "hospitality" | "unknown";
type Urgency = "low" | "medium" | "high" | "unknown";

interface QualificationFields {
  team: string | null;
  fixture: string | null;
  ticketIntent: TicketIntent;
  quantity: number | null;
  groupCorporateIntent: boolean;
  urgency: Urgency;
  confidence: number;
  intentScore: number;
  reason: string;
}

interface QualificationCandidate {
  signal: IntentSignal;
  result: SignalQualification;
  deterministic: QualificationFields;
}

interface QualificationCheckpoint extends JobCheckpoint {
  stage: "signal-qualification";
  scanned: number;
  deterministicSaved: number;
  llmEligible: number;
  llmCompleted: number;
  unchanged: number;
  llmCalls: number;
}

const asText = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
};

const rawObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const firstText = (...values: unknown[]): string | null => {
  for (const value of values) {
    const text = asText(value);
    if (text) {
      return text;
    }
  }
  return null;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const parseQuantity = (content: string): number | null => {
  const match = content.match(
    /\b(\d{1,4})\s*(?:tickets?|seats?|guests?|people|persons|pax|attendees?)\b/i,
  );
  if (!match) {
    const multiplier = content.match(/\b(?:x|qty(?:uantity)?)\s*[:=]?\s*(\d{1,4})\b/i);
    return multiplier ? Number(multiplier[1]) : null;
  }
  return Number(match[1]);
};

const extractTeam = (signal: IntentSignal): string | null => {
  const raw = signal.rawData;
  const teams = Array.isArray(raw["teams"])
    ? raw["teams"].map(asText).filter((item): item is string => Boolean(item))
    : [];
  const home = firstText(raw["homeTeam"], raw["home_team"]);
  const away = firstText(raw["awayTeam"], raw["away_team"]);
  return firstText(raw["team"], raw["teamName"], teams.join(" vs "), home && away ? `${home} vs ${away}` : null);
};

const extractFixture = (signal: IntentSignal): string | null =>
  firstText(signal.rawData["fixture"], signal.rawData["name"], signal.content.split("\n")[0]);

const parseStartsAt = (signal: IntentSignal): Date | null => {
  const raw = signal.rawData;
  const candidate = firstText(raw["startsAt"], raw["startDate"], raw["date"]);
  if (!candidate) {
    return null;
  }
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date;
};

const deterministicQualification = (signal: IntentSignal): QualificationFields => {
  const content = signal.content.toLowerCase();
  const raw = signal.rawData;
  const hospitality =
    /\b(hospitality|suite|box|lounge|vip|premium|corporate dining|executive)\b/i.test(content);
  const ticket =
    /\b(ticket|tickets|seat|seats|admission|matchday|fixture|entry|package)\b/i.test(content);
  const quantity = parseQuantity(signal.content);
  const groupCorporate =
    /\b(corporate|company|client|clients|delegate|delegates|employees?|staff|group|team outing)\b/i.test(
      content,
    ) || (quantity !== null && quantity >= 6);
  const availability = firstText(raw["availability"], raw["inventory"]);
  const startsAt = parseStartsAt(signal);
  const daysUntil = startsAt
    ? (startsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1_000)
    : null;
  const explicitUrgency = /\b(urgent|asap|immediately|today|tomorrow|last minute)\b/i.test(content);
  const urgency: Urgency =
    explicitUrgency || (daysUntil !== null && daysUntil <= 7)
      ? "high"
      : daysUntil !== null && daysUntil <= 30
        ? "medium"
        : startsAt
          ? "low"
          : "unknown";
  const ticketIntent: TicketIntent = hospitality
    ? "hospitality"
    : ticket
      ? "tickets"
      : "unknown";
  const intentSignals = [
    ticketIntent !== "unknown",
    groupCorporate,
    quantity !== null,
    Boolean(availability),
    urgency !== "unknown",
  ].filter(Boolean).length;
  const confidence = clamp(
    0.45 +
      intentSignals * 0.1 +
      (ticketIntent !== "unknown" && Boolean(availability) ? 0.08 : 0),
    0.35,
    0.92,
  );
  const intentScore = clamp(
    (ticketIntent === "hospitality" ? 45 : ticketIntent === "tickets" ? 35 : 0) +
      (groupCorporate ? 20 : 0) +
      (quantity !== null ? Math.min(20, quantity >= 10 ? 20 : 10) : 0) +
      (availability ? 10 : 0) +
      (urgency === "high" ? 10 : urgency === "medium" ? 5 : 0),
    0,
    100,
  );
  const reasons = [
    ticketIntent !== "unknown" ? `${ticketIntent} language detected` : "no clear ticket language",
    groupCorporate ? "group or corporate cues detected" : null,
    quantity !== null ? `quantity signal: ${quantity}` : null,
    availability ? `availability: ${availability}` : null,
    urgency !== "unknown" ? `urgency: ${urgency}` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    team: extractTeam(signal),
    fixture: extractFixture(signal),
    ticketIntent,
    quantity,
    groupCorporateIntent: groupCorporate,
    urgency,
    confidence,
    intentScore,
    reason: reasons.join("; "),
  };
};

const shouldEscalate = (qualification: QualificationFields): boolean =>
  qualification.ticketIntent === "hospitality" ||
  qualification.groupCorporateIntent ||
  qualification.intentScore >= 60 ||
  (qualification.ticketIntent !== "unknown" && qualification.confidence < 0.75);

const insertDeterministicResult = async (
  signal: IntentSignal,
  qualification: QualificationFields,
  llmEligible: boolean,
): Promise<SignalQualification> => {
  const [created] = await db
    .insert(signalQualificationsTable)
    .values({
      signalId: signal.id,
      contentHash: signal.contentHash,
      ...qualification,
      classifier: "deterministic",
      llmEligible,
      llmCompleted: false,
    })
    .returning();
  if (!created) {
    throw new Error(`Unable to persist qualification for signal ${signal.id}`);
  }
  return created;
};

const updateWithLlmResult = async (
  resultId: string,
  qualification: QualificationFields,
): Promise<void> => {
  await db
    .update(signalQualificationsTable)
    .set({
      ...qualification,
      classifier: "llm",
      llmCompleted: true,
      model: OPENAI_MODEL,
      updatedAt: new Date(),
    })
    .where(eq(signalQualificationsTable.id, resultId));
};

const normalizeLlmResult = (
  value: unknown,
  fallback: QualificationFields,
): QualificationFields => {
  const object = rawObject(value) ?? {};
  const ticketIntent = firstText(object["ticketIntent"], object["ticket_intent"]);
  const urgency = firstText(object["urgency"]);
  const rawConfidence = Number(object["confidence"]);
  const rawScore = Number(object["intentScore"] ?? object["intent_score"]);
  return {
    team: firstText(object["team"]) ?? fallback.team,
    fixture: firstText(object["fixture"]) ?? fallback.fixture,
    ticketIntent:
      ticketIntent === "hospitality" || ticketIntent === "tickets"
        ? ticketIntent
        : fallback.ticketIntent,
    quantity:
      Number.isInteger(Number(object["quantity"])) && Number(object["quantity"]) > 0
        ? Number(object["quantity"])
        : fallback.quantity,
    groupCorporateIntent:
      typeof object["groupCorporateIntent"] === "boolean"
        ? object["groupCorporateIntent"]
        : typeof object["group_corporate_intent"] === "boolean"
          ? object["group_corporate_intent"]
          : fallback.groupCorporateIntent,
    urgency:
      urgency === "low" || urgency === "medium" || urgency === "high"
        ? urgency
        : fallback.urgency,
    confidence: clamp(
      Number.isFinite(rawConfidence)
        ? rawConfidence > 1
          ? rawConfidence / 100
          : rawConfidence
        : fallback.confidence,
      0,
      1,
    ),
    intentScore: clamp(
      Number.isFinite(rawScore)
        ? rawScore <= 1
          ? rawScore * 100
          : rawScore
        : fallback.intentScore,
      0,
      100,
    ),
    reason: firstText(object["reason"]) ?? fallback.reason,
  };
};

const requestLlmBatch = async (
  candidates: QualificationCandidate[],
  signal: AbortSignal,
): Promise<Map<string, QualificationFields>> => {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey || candidates.length === 0) {
    return new Map();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const abort = (): void => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_completion_tokens: 4_096,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Qualify public sports fixture purchase signals. Return only JSON with a results array. Preserve the supplied id exactly. Do not invent facts; use null or unknown when absent. Fields: id, team, fixture, ticketIntent (tickets|hospitality|unknown), quantity (integer|null), groupCorporateIntent (boolean), urgency (low|medium|high|unknown), confidence (0..1), intentScore (0..100), reason.",
          },
          {
            role: "user",
            content: JSON.stringify(
              candidates.map(({ signal, deterministic }) => ({
                id: signal.id,
                signal: signal.content,
                deterministic,
              })),
            ),
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Qualification LLM returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Qualification LLM returned an empty response");
    }
    const parsed = JSON.parse(content) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : rawObject(parsed)?.["results"];
    if (!Array.isArray(items)) {
      throw new Error("Qualification LLM response did not contain a results array");
    }
    const byId = new Map(candidates.map((candidate) => [candidate.signal.id, candidate]));
    const normalized = new Map<string, QualificationFields>();
    for (const item of items) {
      const object = rawObject(item);
      const id = object ? asText(object["id"]) : null;
      const candidate = id ? byId.get(id) : undefined;
      if (candidate) {
        normalized.set(candidate.signal.id, normalizeLlmResult(item, candidate.deterministic));
      }
    }
    return normalized;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
};

const readCachedLlmResult = async (contentHash: string) => {
  const [cached] = await db
    .select()
    .from(qualificationLlmCacheTable)
    .where(eq(qualificationLlmCacheTable.contentHash, contentHash))
    .limit(1);
  return cached;
};

const saveLlmCache = async (
  contentHash: string,
  qualification: QualificationFields,
): Promise<void> => {
  await db
    .insert(qualificationLlmCacheTable)
    .values({
      contentHash,
      ...qualification,
      model: OPENAI_MODEL,
    })
    .onConflictDoNothing();
};

const applyCachedResult = async (
  candidate: QualificationCandidate,
  cached: {
    team: string | null;
    fixture: string | null;
    ticketIntent: string;
    quantity: number | null;
    groupCorporateIntent: boolean;
    urgency: string;
    confidence: number;
    intentScore: number;
    reason: string;
    model: string;
  },
): Promise<void> => {
  await db
    .update(signalQualificationsTable)
    .set({
      team: cached.team,
      fixture: cached.fixture,
      ticketIntent: cached.ticketIntent,
      quantity: cached.quantity,
      groupCorporateIntent: cached.groupCorporateIntent,
      urgency: cached.urgency,
      confidence: cached.confidence,
      intentScore: cached.intentScore,
      reason: cached.reason,
      classifier: "llm-cache",
      llmCompleted: true,
      model: cached.model,
      updatedAt: new Date(),
    })
    .where(eq(signalQualificationsTable.id, candidate.result.id));
};

export const qualifyIntentSignals = async (
  signal: AbortSignal,
): Promise<QualificationCheckpoint> => {
  const records = await getFixtureRecordsForSignalBackfill(MAX_SIGNAL_BATCH);
  for (const record of records) {
    if (signal.aborted) {
      throw new Error("Qualification cancelled during shutdown");
    }
    await upsertSignalForFixture(record);
  }

  const signals = await db.select().from(intentSignalsTable).limit(MAX_SIGNAL_BATCH);
  const candidates: QualificationCandidate[] = [];
  let deterministicSaved = 0;
  let unchanged = 0;

  for (const intentSignal of signals) {
    const deterministic = deterministicQualification(intentSignal);
    const llmEligible = shouldEscalate(deterministic);
    const [existing] = await db
      .select()
      .from(signalQualificationsTable)
      .where(
        and(
          eq(signalQualificationsTable.signalId, intentSignal.id),
          eq(signalQualificationsTable.contentHash, intentSignal.contentHash),
        ),
      )
      .limit(1);

    if (!existing) {
      const result = await insertDeterministicResult(intentSignal, deterministic, llmEligible);
      deterministicSaved += 1;
      if (llmEligible) {
        candidates.push({ signal: intentSignal, result, deterministic });
      }
      continue;
    }

    if (!existing.llmEligible || existing.llmCompleted) {
      unchanged += 1;
      continue;
    }

    candidates.push({ signal: intentSignal, result: existing, deterministic });
  }

  let llmCalls = 0;
  let llmCompleted = 0;
  const withoutCache: QualificationCandidate[] = [];
  for (const candidate of candidates) {
    const cached = await readCachedLlmResult(candidate.signal.contentHash);
    if (cached) {
      await applyCachedResult(candidate, cached);
      llmCompleted += 1;
    } else {
      withoutCache.push(candidate);
    }
  }

  for (let start = 0; start < withoutCache.length; start += workerConfig.aiBatchSize) {
    const batch = withoutCache.slice(start, start + workerConfig.aiBatchSize);
    const results = await requestLlmBatch(batch, signal);
    llmCalls += 1;
    for (const candidate of batch) {
      const qualification = results.get(candidate.signal.id);
      if (!qualification) {
        continue;
      }
      await saveLlmCache(candidate.signal.contentHash, qualification);
      await updateWithLlmResult(candidate.result.id, qualification);
      llmCompleted += 1;
    }
  }

  const checkpoint: QualificationCheckpoint = {
    stage: "signal-qualification",
    scanned: signals.length,
    deterministicSaved,
    llmEligible: candidates.length,
    llmCompleted,
    unchanged,
    llmCalls,
    completedAt: new Date().toISOString(),
  };
  logger.info(checkpoint, "Intent signal qualification completed");
  return checkpoint;
};