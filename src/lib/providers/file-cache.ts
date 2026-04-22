import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type FileCacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const CACHE_ROOT = path.join(process.cwd(), "data", "provider-cache");

function safeCacheName(key: string) {
  return `${key.replace(/[^a-z0-9_.-]+/gi, "_").slice(0, 180)}.json`;
}

export async function readFileCache<T>(namespace: string, key: string): Promise<T | null> {
  const filePath = path.join(CACHE_ROOT, namespace, safeCacheName(key));

  try {
    const entry = JSON.parse(await readFile(filePath, "utf8")) as FileCacheEntry<T>;

    if (entry.expiresAt < Date.now()) {
      return null;
    }

    return entry.value;
  } catch {
    return null;
  }
}

export async function writeFileCache<T>(
  namespace: string,
  key: string,
  value: T,
  ttlMs: number,
) {
  const directory = path.join(CACHE_ROOT, namespace);
  const filePath = path.join(directory, safeCacheName(key));
  await mkdir(directory, { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(
      {
        expiresAt: Date.now() + ttlMs,
        value,
      } satisfies FileCacheEntry<T>,
      null,
      2,
    ),
  );
}

export async function rememberFile<T>(
  namespace: string,
  key: string,
  ttlMs: number,
  factory: () => Promise<T>,
): Promise<T> {
  const hit = await readFileCache<T>(namespace, key);

  if (hit !== null) {
    return hit;
  }

  const value = await factory();
  await writeFileCache(namespace, key, value, ttlMs);
  return value;
}
