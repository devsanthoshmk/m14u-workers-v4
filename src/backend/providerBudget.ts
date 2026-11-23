// Give single calls time to fail while leaving room for an existing fallback.
const PROVIDER_TIMEOUT_MS = 5_000;
const CATALOG_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_LOOKUPS = 3;
export const MAX_BATCH_IDS = 12;
export const MAX_SIMILAR_TRACKS = 15;
export const MAX_PLAYLIST_CONTINUATIONS = 12;

export class ProviderTimeout extends Error {}

export class ProviderBudget {
  private readonly deadline = AbortSignal.timeout(CATALOG_TIMEOUT_MS);
  private degraded = false;

  get cacheable() {
    return !this.degraded;
  }

  markDegraded() {
    this.degraded = true;
  }

  get expired() {
    return this.deadline.aborted;
  }

  checkDeadline() {
    if (this.deadline.aborted) throw new ProviderTimeout();
  }

  readonly fetch: typeof fetch = async (input, init) => {
    this.checkDeadline();
    const timeout = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = AbortSignal.any([this.deadline, timeout, ...(callerSignal ? [callerSignal] : [])]);
    try {
      // Keep the signal on the response stream as well as the initial fetch.
      return await fetch(input, { ...init, signal });
    } catch (err) {
      if (this.deadline.aborted || timeout.aborted) throw new ProviderTimeout();
      throw err;
    }
  };

  async map<T, R>(items: T[], lookup: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(items.length, MAX_CONCURRENT_LOOKUPS) }, async () => {
      while (!this.deadline.aborted && next < items.length) {
        const index = next++;
        results[index] = await lookup(items[index]);
      }
    }));
    this.checkDeadline();
    return results;
  }
}
