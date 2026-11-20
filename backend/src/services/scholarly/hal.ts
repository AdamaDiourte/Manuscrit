import type { VerifiedReading } from "../../../../shared/research/topicTypes";
import { getCachedSource, setCachedSource, sourceCacheKey } from "./sourceCache";
import type { SourceSearchResult } from "./sourceTypes";

const TIMEOUT_MS = 8_000;
const BASE = "https://api.archives-ouvertes.fr/search/";

type HalDoc = {
  title_s?: string | string[];
  authFullName_s?: string | string[];
  producedDateY_i?: number | string;
  uri_s?: string;
  doiId_s?: string | string[];
  journalTitle_s?: string | string[];
  docType_s?: string | string[];
  abstract_s?: string | string[];
};

export type HalSearchOptions = {
  /** Filtre SHS via level0_domain_s:shs (codes domain_s = « 0.shs », pas « shs* »). */
  shsDomain?: boolean;
  axis?: string;
};

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function first(v: string | string[] | undefined): string | null {
  const arr = asArray(v);
  return arr[0] || null;
}

function mapDocs(
  docs: HalDoc[],
): Array<VerifiedReading & { abstract?: string }> {
  return docs
    .map((d) => {
      const title = first(d.title_s) || "";
      const authors = asArray(d.authFullName_s).slice(0, 3);
      const doi = first(d.doiId_s);
      const yearRaw = d.producedDateY_i;
      const year =
        typeof yearRaw === "number"
          ? yearRaw
          : yearRaw
            ? Number(yearRaw)
            : null;
      const urlOut = d.uri_s || (doi ? `https://doi.org/${doi}` : "");
      const abstractParts = asArray(d.abstract_s);
      return {
        source: "hal" as const,
        title,
        authors,
        year: Number.isFinite(year) ? (year as number) : null,
        venue: first(d.journalTitle_s),
        doi,
        url: urlOut,
        abstract: abstractParts.join(" ").trim(),
      };
    })
    .filter((r) => r.title && r.url);
}

function buildUrl(query: string, shsDomain: boolean): URL {
  const url = new URL(BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("rows", "10");
  url.searchParams.set("wt", "json");
  url.searchParams.set(
    "fl",
    "title_s,authFullName_s,producedDateY_i,uri_s,doiId_s,journalTitle_s,docType_s,abstract_s",
  );
  // Doc HAL : domain_s porte des codes type « 0.shs » / « 1.shs.scipo ».
  // Le filtre correct pour les SHS est level0_domain_s:shs (pas domain_s:shs*).
  if (shsDomain) {
    url.searchParams.set("fq", "level0_domain_s:shs");
  }
  return url;
}

/** HAL search — returns status metadata (never throws). */
export async function searchHal(
  query: string,
  options?: HalSearchOptions,
): Promise<SourceSearchResult> {
  const q = query.trim();
  const t0 = Date.now();
  if (!q) {
    return {
      source: "hal",
      status: "empty",
      http_status: null,
      error_code: null,
      raw_count: 0,
      latency_ms: 0,
      candidates: [],
    };
  }

  const shsDomain = Boolean(options?.shsDomain);
  const key = sourceCacheKey(
    "hal",
    [q.trim().toLowerCase(), shsDomain ? "shs:1" : "shs:0"].join("\n"),
  );
  const cached = await getCachedSource<{
    candidates: Array<VerifiedReading & { abstract?: string }>;
    raw_count: number;
  }>(key);
  if (cached) {
    return {
      source: "hal",
      status: cached.candidates.length ? "ok" : "empty",
      http_status: 200,
      error_code: null,
      raw_count: cached.raw_count,
      latency_ms: Date.now() - t0,
      cached: true,
      candidates: cached.candidates,
    };
  }

  const url = buildUrl(q, shsDomain);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      return {
        source: "hal",
        status: "error",
        http_status: null,
        error_code: name === "AbortError" ? "timeout" : "network_error",
        raw_count: 0,
        latency_ms: Date.now() - t0,
        candidates: [],
      };
    }

    if (!res.ok) {
      return {
        source: "hal",
        status: "error",
        http_status: res.status,
        error_code:
          res.status === 429
            ? "rate_limited"
            : res.status >= 500
              ? "server_error"
              : "client_error",
        raw_count: 0,
        latency_ms: Date.now() - t0,
        candidates: [],
      };
    }

    let data: {
      response?: { docs?: HalDoc[]; numFound?: number };
    };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      return {
        source: "hal",
        status: "error",
        http_status: res.status,
        error_code: "invalid_json",
        raw_count: 0,
        latency_ms: Date.now() - t0,
        candidates: [],
      };
    }

    const docs = data.response?.docs || [];
    const candidates = mapDocs(docs);
    const raw_count =
      typeof data.response?.numFound === "number"
        ? data.response.numFound
        : docs.length;

    setCachedSource(key, { candidates, raw_count });

    return {
      source: "hal",
      status: candidates.length ? "ok" : "empty",
      http_status: res.status,
      error_code: null,
      raw_count,
      latency_ms: Date.now() - t0,
      candidates,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** URL publique (sans clé) pour tests manuels / rapport. */
export function buildHalSearchUrl(query: string, shsDomain = true): string {
  return buildUrl(query, shsDomain).toString();
}
