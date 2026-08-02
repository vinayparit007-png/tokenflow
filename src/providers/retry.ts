/** Options for {@link withRetry}. Timers and randomness are injectable so the
 * backoff schedule is deterministically testable. */
export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  /** Injectable sleep; must reject if the signal aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable RNG in [0, 1). */
  random?: () => number;
}

/** An abort-aware sleep: clears its timer and rejects immediately on abort so a
 * Ctrl-C during backoff doesn't wait out the delay. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Retry `fn` with exponential backoff and full jitter.
 *
 * Why full jitter (delay uniformly in `[0, expBackoff]`) rather than fixed
 * backoff: when a provider rate-limits many callers at once, fixed delays make
 * them all retry in lockstep and re-collide. Randomising across the whole window
 * spreads the retries out. Only failures that `isRetryable` accepts (429/5xx and
 * transient network errors) are retried; anything else — a 400, a bad key —
 * throws immediately, because retrying it just wastes the user's time.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const base = options.baseDelayMs ?? 500;
  const max = options.maxDelayMs ?? 8000;
  const sleep = options.sleep ?? abortableSleep;
  const random = options.random ?? Math.random;

  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (attempt >= retries || !isRetryable(error)) throw error;
      const window = Math.min(max, base * 2 ** attempt);
      await sleep(random() * window, options.signal);
      attempt += 1;
    }
  }
}
