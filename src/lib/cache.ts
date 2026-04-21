type CacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

const memoryCache = new Map<string, CacheEntry<unknown>>();

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
