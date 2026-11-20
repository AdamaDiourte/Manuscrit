import type { VerifiedReading } from "../../../../shared/research/topicTypes";
import { getCachedSource, setCachedSource, sourceCacheKey } from "./sourceCache";
import type { SourceSearchResult } from "./sourceTypes";

const TIMEOUT_MS = 8_000;
const BASE = "https://api.openalex.org/works";

type OpenAlexWork = {
  id?: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: {
    source?: { display_name?: string | null } | null;
    landing_page_url?: string | null;
  } | null;
  authorships?: Array<{
    author?: { display_name?: string | null } | null;
  }> | null;
};

export type OpenAlexSearchOptions = {
  fieldIds?: number[];
  axis?: string;
};

function reconstructAbstract(
  index: Record<string, number[]> | null | undefined,
): string {
  if (!index) return "";
  const positions: Array<{ word: string; pos: number }> = [];
  for (const [word, idxs] of Object.entries(index)) {
    for (const pos of idxs) positions.push({ word, pos });
  }
  positions.sort((a, b) => a.pos - b.pos);
  return positions.map((p) => p.word).join(" ");
}

function mailtoParam(): string {
  return String(process.env.OPENALEX_MAILTO || "").trim();
}

function apiKeyParam(): string {
  return String(process.env.OPENALEX_API_KEY || "").trim();
}

function mapWorks(
  results: OpenAlexWork[],
): Array<VerifiedReading & { abstract?: string }> {
  return results
    .map((w) => {
      const title = String(w.display_name || w.title || "").trim();
      const authors = (w.authorships || [])
        .map((a) => a.author?.display_name || "")
        .filter(Boolean)
        .slice(0, 3);
      const doi = w.doi
        ? String(w.doi).replace(/^https?:\/\/doi\.org\//i, "")
        : null;
      const urlOut =
        w.primary_location?.landing_page_url ||
        (doi ? `https://doi.org/${doi}` : w.id || "");
      return {
        source: "openalex" as const,
        title,
        authors,
        year: w.publication_year ?? null,
        venue: w.primary_location?.source?.display_name || null,
        doi,
        url: urlOut,
        abstract: reconstructAbstract(w.abstract_inverted_index),
      };
    })
    .filter((r) => r.title && r.url);
}

function buildUrl(query: string, fieldIds: number[]): URL {
  const url = new URL(BASE);
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", "10");

  const filters = ["type:article|book|book-chapter|dissertation"];
  if (fieldIds.length) {
    filters.push(`primary_topic.field.id:${fieldIds.join("|")}`);
  }
  url.searchParams.set("filter", filters.join(","));

  const mailto = mailtoParam();
  if (mailto) url.searchParams.set("mailto", mailto);
  const apiKey = apiKeyParam();
  if (apiKey) url.searchParams.set("api_key", apiKey);
  return url;
}

function cacheKeyFor(query: string, fieldIds: number[]): string {
  const apiKey = apiKeyParam();
  const mailto = mailtoParam();
  // Ne pas inclure la clé en clair : présence seulement.
  return sourceCacheKey(
    "openalex",
    [
      query.trim().toLowerCase(),
      fieldIds.slice().sort((a, b) => a - b).join("|"),
      mailto ? "mailto:1" : "mailto:0",
      apiKey ? "key:1" : "key:0",
    ].join("\n"),
  );
}

async function fetchOnce(
  url: string,
  signal: AbortSignal,
): Promise<{ ok: true; status: number; body: unknown } | { ok: false; status: number | null; error_code: string }> {
  try {
    const res = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error_code:
          res.status === 429
            ? "rate_limited"
            : res.status >= 500
              ? "server_error"
              : "client_error",
      };
    }
    try {
      const body = await res.json();
      return { ok: true, status: res.status, body };
    } catch {
      return { ok: false, status: res.status, error_code: "invalid_json" };
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return {
      ok: false,
      status: null,
      error_code: name === "AbortError" ? "timeout" : "network_error",
    };
  }
}

/** OpenAlex works search — returns status metadata (never throws). */
export async function searchOpenAlex(
  query: string,
  options?: OpenAlexSearchOptions,
): Promise<SourceSearchResult> {
  const q = query.trim();
  const t0 = Date.now();
  if (!q) {
    return {
      source: "openalex",
      status: "empty",
      http_status: null,
      error_code: null,
      raw_count: 0,
      latency_ms: 0,
      candidates: [],
    };
  }

  const fieldIds = (options?.fieldIds || []).filter(
    (id) => Number.isFinite(id) && id > 0,
  );
  const key = cacheKeyFor(q, fieldIds);
  const cached = await getCachedSource<{
    candidates: Array<VerifiedReading & { abstract?: string }>;
    raw_count: number;
  }>(key);
  if (cached) {
    return {
      source: "openalex",
      status: cached.candidates.length ? "ok" : "empty",
      http_status: 200,
      error_code: null,
      raw_count: cached.raw_count,
      latency_ms: Date.now() - t0,
      cached: true,
      candidates: cached.candidates,
    };
  }

  const url = buildUrl(q, fieldIds);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let result = await fetchOnce(url.toString(), controller.signal);

    if (!result.ok && result.status === 429) {
      await new Promise((r) => setTimeout(r, 1000));
      result = await fetchOnce(url.toString(), controller.signal);
    }

    if (!result.ok) {
      return {
        source: "openalex",
        status: "error",
        http_status: result.status,
        error_code: result.error_code,
        raw_count: 0,
        latency_ms: Date.now() - t0,
        candidates: [],
      };
    }

    const data = result.body as { results?: OpenAlexWork[]; meta?: { count?: number } };
    const results = data.results || [];
    const candidates = mapWorks(results);
    const raw_count =
      typeof data.meta?.count === "number" ? data.meta.count : results.length;

    setCachedSource(key, { candidates, raw_count });

    return {
      source: "openalex",
      status: candidates.length ? "ok" : "empty",
      http_status: result.status,
      error_code: null,
      raw_count,
      latency_ms: Date.now() - t0,
      candidates,
    };
  } finally {
    clearTimeout(timer);
  }
}
