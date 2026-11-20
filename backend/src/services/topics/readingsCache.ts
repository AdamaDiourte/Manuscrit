import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GeneratedTopic,
  LiteratureDensity,
  VerifiedReading,
} from "../../../../shared/research/topicTypes";
import type { SourcesStatusMap } from "../scholarly/sourceTypes";

const TTL_MS = 24 * 60 * 60 * 1000;

export type ReadingsCacheEntry = {
  readings: VerifiedReading[];
  sources_status?: SourcesStatusMap;
  literature_density?: LiteratureDensity;
  expiresAt: number;
};

const memory = new Map<string, ReadingsCacheEntry>();

function cacheDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // backend/src/services/topics → backend/.data/readings-cache
  return join(here, "../../../.data/readings-cache");
}

function cachePath(fp: string): string {
  return join(cacheDir(), `${fp}.json`);
}

/** Fingerprint topic by axis+title+research_object+keywords (no PII). */
export function topicFingerprint(topic: GeneratedTopic): string {
  const payload = [
    topic.axis,
    topic.title.trim(),
    (topic.research_object || "").trim(),
    [...(topic.keywords_fr || [])].map((k) => k.trim()).sort().join("|"),
    [...(topic.keywords_en || [])].map((k) => k.trim()).sort().join("|"),
  ].join("\n");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Memory first, then optional filesystem under backend/.data/readings-cache/. */
export async function getCachedReadings(
  fp: string,
): Promise<ReadingsCacheEntry | null> {
  const now = Date.now();
  const mem = memory.get(fp);
  if (mem) {
    if (mem.expiresAt > now) return mem;
    memory.delete(fp);
  }
  try {
    const raw = await readFile(cachePath(fp), "utf8");
    const parsed = JSON.parse(raw) as ReadingsCacheEntry & {
      readings?: VerifiedReading[];
    };
    // Compat anciens caches : tableau brut ou { readings, expiresAt }
    if (Array.isArray(parsed)) {
      return null;
    }
    if (
      !parsed ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= now ||
      !Array.isArray(parsed.readings)
    ) {
      return null;
    }
    memory.set(fp, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function setCachedReadings(
  fp: string,
  readings: VerifiedReading[],
  meta?: {
    sources_status?: SourcesStatusMap;
    literature_density?: LiteratureDensity;
  },
): void {
  const entry: ReadingsCacheEntry = {
    readings,
    sources_status: meta?.sources_status,
    literature_density: meta?.literature_density,
    expiresAt: Date.now() + TTL_MS,
  };
  memory.set(fp, entry);
  void persistCache(fp, entry);
}

async function persistCache(
  fp: string,
  entry: ReadingsCacheEntry,
): Promise<void> {
  try {
    const dir = cacheDir();
    await mkdir(dir, { recursive: true });
    await writeFile(cachePath(fp), JSON.stringify(entry), "utf8");
  } catch {
    // Disk cache is best-effort.
  }
}
