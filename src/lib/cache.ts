type CacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

const memoryCache = new Map<string, CacheEntry<unknown>>();

type FetchRetryOptions = {
  retries?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function remember<T>(
  key: string,
  ttlMs: number,
  factory: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = memoryCache.get(key);

  if (hit && hit.expiresAt > now) {
    return hit.value as Promise<T>;
  }

  const value = factory().catch((error) => {
    memoryCache.delete(key);
    throw error;
  });

  memoryCache.set(key, {
    expiresAt: now + ttlMs,
    value,
  });

  return value;
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchRetryOptions = {},
): Promise<Response> {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 8000;
  const retryDelayMs = options.retryDelayMs ?? 250;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });

      if (response.ok || response.status < 500 || attempt === retries) {
        return response;
      }

      lastError = new Error(`Upstream returned ${response.status}`);
    } catch (error) {
      lastError = error;

      if (attempt === retries) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    await sleep(retryDelayMs * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error("Upstream request failed.");
}
