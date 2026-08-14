export class RateLimiter {
  private nextAvailableAt = 0;

  public constructor(private readonly requestsPerSecond: number) {}

  public async take(signal: AbortSignal): Promise<void> {
    const intervalMs = 1_000 / this.requestsPerSecond;
    const now = Date.now();
    const waitMs = Math.max(0, this.nextAvailableAt - now);
    this.nextAvailableAt = Math.max(now, this.nextAvailableAt) + intervalMs;

    if (waitMs === 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, waitMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new Error("Rate limiter wait cancelled during shutdown"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}