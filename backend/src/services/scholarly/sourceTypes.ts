import type { VerifiedReading } from "../../../../shared/research/topicTypes";

export type SourceName = "openalex" | "hal";

export type SourceStatus = "ok" | "empty" | "error";

export type SourceSearchMeta = {
  source: SourceName;
  status: SourceStatus;
  http_status: number | null;
  error_code: string | null;
  raw_count: number;
  latency_ms: number;
  cached?: boolean;
};

export type SourceCandidate = VerifiedReading & { abstract?: string };

export type SourceSearchResult = SourceSearchMeta & {
  candidates: SourceCandidate[];
};

export type SourcesStatusMap = {
  openalex: SourceStatus;
  hal: SourceStatus;
};

/** Agrège plusieurs requêtes d'une même source (ok > error > empty). */
export function mergeSourceStatus(
  metas: Array<Pick<SourceSearchMeta, "status">>,
): SourceStatus {
  if (!metas.length) return "empty";
  if (metas.some((m) => m.status === "ok")) return "ok";
  if (metas.some((m) => m.status === "error")) return "error";
  return "empty";
}

export function logReadingsSource(
  meta: SourceSearchMeta & { axis?: string },
): void {
  console.info(
    JSON.stringify({
      event: "readings.source",
      source: meta.source,
      axis: meta.axis ?? null,
      http_status: meta.http_status,
      error_code: meta.error_code,
      raw_count: meta.raw_count,
      latency_ms: meta.latency_ms,
      status: meta.status,
      cached: meta.cached ?? false,
    }),
  );
}

/** Coupe à max caractères à la fin d'un mot (jamais au milieu). */
export function truncateAtWord(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= Math.floor(max * 0.6)) return slice.slice(0, lastSpace).trimEnd();
  return slice.trimEnd();
}
