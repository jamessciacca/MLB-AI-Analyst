import { fetchWithRetry, remember } from "@/lib/cache";

type JsonGuard<T> = (value: unknown) => T;

type ProviderJsonOptions<T> = {
  source: string;
  ttlMs: number;
  timeoutMs?: number;
  retries?: number;
  headers?: HeadersInit;
  guard?: JsonGuard<T>;
};

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export function logProviderEvent(
  source: string,
  event: "success" | "failure" | "cache" | "partial",
  detail: string,
) {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  console.info(`[provider:${source}] ${event} ${detail}`);
}

export async function fetchProviderJson<T>(
  url: URL | string,
  options: ProviderJsonOptions<T>,
): Promise<T> {
  const cacheKey = `${options.source}:${url.toString()}`;

  return remember(cacheKey, options.ttlMs, async () => {
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          Accept: "application/json",
          ...options.headers,
        },
        cache: "no-store",
      },
      {
        retries: options.retries ?? 2,
        timeoutMs: options.timeoutMs ?? 8000,
      },
    );

    if (!response.ok) {
      throw new ProviderError(
        `Provider request failed with ${response.status}`,
        options.source,
        response.status,
      );
    }

    const json = (await response.json()) as unknown;
    const parsed = options.guard ? options.guard(json) : (json as T);
    logProviderEvent(options.source, "success", url.toString());
    return parsed;
  });
}
