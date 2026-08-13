const parsePositiveInteger = (
  name: string,
  fallback: number,
  options: { min?: number } = {},
): number => {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);
  const minimum = options.min ?? 1;
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }

  return parsed;
};

export const workerConfig = {
  collectionIntervalMs: parsePositiveInteger("COLLECTION_INTERVAL", 15 * 60 * 1000),
  fixtureSyncIntervalMs: parsePositiveInteger(
    "FIXTURE_SYNC_INTERVAL",
    60 * 60 * 1000,
  ),
  maxConcurrency: parsePositiveInteger("MAX_CONCURRENCY", 2),
  requestRatePerSecond: parsePositiveInteger("REQUEST_RATE", 5),
  aiBatchSize: parsePositiveInteger("AI_BATCH_SIZE", 20),
  jobPollIntervalMs: 1_000,
  schedulerPollIntervalMs: 5_000,
  leaseDurationMs: 30_000,
  jobLockDurationMs: 5 * 60 * 1000,
  shutdownGracePeriodMs: 20_000,
} as const;

export const llmConfigured = Boolean(process.env.LLM_API_KEY);