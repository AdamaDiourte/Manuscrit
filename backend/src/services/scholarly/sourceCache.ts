import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TTL_MS = 24 * 60 * 60 * 1000;

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const memory = new Map<string, CacheEntry<unknown>>();

function cacheDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // backend/src/services/scholarly → repo/.data/scholarly-cache
  return join(here, "../../../../.data/scholarly-cache");
}

function cachePath(key: string): string {
  return join(cacheDir(), `${key}.json`);
}

/** Clé stable pour une requête source (URL normalisée ou payload). */
export function sourceCacheKey(source: string, normalized: string): string {
  return createHash("sha256")
    .update(`${source}\n${normalized}`, "utf8")
    .digest("hex");
}

export async function getCachedSource<T>(
  key: string,
): Promise<T | null> {
  const now = Date.now();
  const mem = memory.get(key);
  if (mem) {
    if (mem.expiresAt > now) return mem.data as T;
    memory.delete(key);
  }
  try {
    const raw = await readFile(cachePath(key), "utf8");
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (
      !parsed ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= now
    ) {
      return null;
    }
    memory.set(key, parsed);
    return parsed.data;
  } catch {
    return null;
  }
}

export function setCachedSource<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = {
    data,
    expiresAt: Date.now() + TTL_MS,
  };
  memory.set(key, entry);
  void persist(key, entry);
}

async function persist<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  try {
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(cachePath(key), JSON.stringify(entry), "utf8");
  } catch {
    // Best-effort disk cache.
  }
}
