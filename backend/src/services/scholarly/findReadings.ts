import {
  isShsDiscipline,
  openAlexFieldsForDiscipline,
  type OpenAlexFieldId,
} from "../../../../shared/research/openalexFields";
import type {
  GeneratedTopic,
  LiteratureDensity,
  VerifiedReading,
} from "../../../../shared/research/topicTypes";
import { searchHal } from "./hal";
import { searchOpenAlex } from "./openalex";
import { rankReadings } from "./rankReadings";
import {
  logReadingsSource,
  mergeSourceStatus,
  truncateAtWord,
  type SourceSearchMeta,
  type SourcesStatusMap,
} from "./sourceTypes";

type Candidate = VerifiedReading & { abstract?: string; candId: string };

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeKey(c: Candidate): string {
  if (c.doi) return `doi:${c.doi.toLowerCase()}`;
  return `title:${normalizeTitle(c.title)}`;
}

const QUERY_STOPWORDS = new Set([
  "les",
  "des",
  "une",
  "uns",
  "aux",
  "par",
  "pour",
  "dans",
  "avec",
  "sans",
  "sur",
  "sous",
  "chez",
  "entre",
  "vers",
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "usages",
  "usage",
  "pratique",
  "pratiques",
  "etude",
  "etudes",
  "analyse",
  "cas",
]);

function tokenizePhrase(text: string): string[] {
  return text
    .split(/[\s,;:/|()]+/)
    .map((t) => t.trim())
    .filter((t) => {
      if (t.length < 3) return false;
      const n = normalizeTitle(t);
      return n.length >= 3 && !QUERY_STOPWORDS.has(n);
    });
}

function uniqueTerms(terms: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of terms) {
    const n = normalizeTitle(t);
    if (n.length < 3 || seen.has(n) || QUERY_STOPWORDS.has(n)) continue;
    seen.add(n);
    out.push(t.trim());
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Build short queries from research_object + keywords.
 * FR (HAL) : 2–3 termes max — HAL AND-implique les termes et tombe à 0 sinon.
 * EN (OpenAlex) : jusqu'à 4 termes.
 */
function buildShortQueries(topic: GeneratedTopic): {
  fr: string[];
  en: string[];
} {
  const objectTerms = uniqueTerms(
    tokenizePhrase(topic.research_object || topic.title || ""),
    6,
  );
  const kwFr = uniqueTerms(topic.keywords_fr || [], 8);
  const kwEn = uniqueTerms(topic.keywords_en || [], 8);

  const fr: string[] = [];
  const en: string[] = [];

  const pushQuery = (list: string[], terms: string[], maxTerms: number) => {
    const q = uniqueTerms(terms, maxTerms).slice(0, maxTerms);
    if (q.length >= 2) list.push(q.join(" "));
  };

  // HAL : privilégier les mots-clés FR (2–3 termes).
  if (kwFr.length >= 2) {
    pushQuery(fr, kwFr.slice(0, 3), 3);
  }
  if (objectTerms.length >= 2) {
    pushQuery(fr, objectTerms.slice(0, 3), 3);
  }
  if (objectTerms.length && kwFr.length) {
    pushQuery(fr, [...kwFr.slice(0, 2), ...objectTerms.slice(0, 1)], 3);
  }

  if (kwEn.length >= 2) {
    pushQuery(en, kwEn.slice(0, 4), 4);
  }
  if (objectTerms.length && kwEn.length) {
    pushQuery(en, [...kwEn.slice(0, 2), ...objectTerms.slice(0, 2)], 4);
  }
  if (kwEn.length >= 3) {
    pushQuery(en, kwEn.slice(1, 5), 4);
  }

  return {
    fr: [...new Set(fr)].slice(0, 2),
    en: [...new Set(en)].slice(0, 2),
  };
}

function fieldIdsForTopic(
  topic: GeneratedTopic,
  answers: Record<string, unknown>,
): OpenAlexFieldId[] {
  const ids = new Set<OpenAlexFieldId>(
    openAlexFieldsForDiscipline(answers.discipline_main),
  );
  if (topic.axis === "discovery") {
    const curious = answers.curious_discipline;
    const list = Array.isArray(curious)
      ? curious
      : curious
        ? [curious]
        : [];
    for (const d of list) {
      for (const id of openAlexFieldsForDiscipline(d)) ids.add(id);
    }
  }
  return [...ids];
}

function truncateAbstract(text: string, max = 600): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

export function computeLiteratureDensity(
  readings: VerifiedReading[],
  sourcesStatus: SourcesStatusMap,
): LiteratureDensity {
  if (sourcesStatus.openalex === "error" && sourcesStatus.hal === "error") {
    return "unknown";
  }
  if (sourcesStatus.openalex === "error" || sourcesStatus.hal === "error") {
    // Une source en erreur + peu de lectures → unknown si < 4 scores 3
    const high = readings.filter((r) => (r.relevance_score ?? 0) === 3).length;
    if (high >= 4) return "high";
    return "unknown";
  }
  const high = readings.filter((r) => (r.relevance_score ?? 0) === 3).length;
  return high >= 4 ? "high" : "normal";
}

/**
 * Search + AI rank verified readings for a topic.
 * FR queries → HAL only; EN queries → OpenAlex only.
 */
export async function findReadingsForTopic(
  topic: GeneratedTopic,
  answers: Record<string, unknown> = {},
): Promise<{
  readings: VerifiedReading[];
  rejectedCount: number;
  /** false si échec réseau/modèle — ne pas mettre en cache. */
  cacheable: boolean;
  sources_status: SourcesStatusMap;
  literature_density: LiteratureDensity;
}> {
  const axis = topic.axis;
  const queries = buildShortQueries(topic);
  const fieldIds = fieldIdsForTopic(topic, answers);
  const shsDomain = isShsDiscipline(answers.discipline_main);

  const emptyStatus: SourcesStatusMap = { openalex: "empty", hal: "empty" };

  if (!queries.fr.length && !queries.en.length) {
    return {
      readings: [],
      rejectedCount: 0,
      cacheable: true,
      sources_status: emptyStatus,
      literature_density: "normal",
    };
  }

  const halMetas: SourceSearchMeta[] = [];
  const oaMetas: SourceSearchMeta[] = [];
  const batches: Array<VerifiedReading & { abstract?: string }>[] = [];

  const jobs: Array<Promise<void>> = [];

  for (const q of queries.fr) {
    jobs.push(
      (async () => {
        const result = await searchHal(q, { shsDomain, axis });
        const meta: SourceSearchMeta = {
          source: "hal",
          status: result.status,
          http_status: result.http_status,
          error_code: result.error_code,
          raw_count: result.raw_count,
          latency_ms: result.latency_ms,
          cached: result.cached,
        };
        halMetas.push(meta);
        logReadingsSource({ ...meta, axis });
        batches.push(result.candidates);
      })(),
    );
  }

  for (const q of queries.en) {
    jobs.push(
      (async () => {
        const result = await searchOpenAlex(q, { fieldIds, axis });
        const meta: SourceSearchMeta = {
          source: "openalex",
          status: result.status,
          http_status: result.http_status,
          error_code: result.error_code,
          raw_count: result.raw_count,
          latency_ms: result.latency_ms,
          cached: result.cached,
        };
        oaMetas.push(meta);
        logReadingsSource({ ...meta, axis });
        batches.push(result.candidates);
      })(),
    );
  }

  await Promise.all(jobs);

  const sources_status: SourcesStatusMap = {
    hal: queries.fr.length ? mergeSourceStatus(halMetas) : "empty",
    openalex: queries.en.length ? mergeSourceStatus(oaMetas) : "empty",
  };

  const searchFailed =
    sources_status.hal === "error" && sources_status.openalex === "error";

  if (searchFailed) {
    return {
      readings: [],
      rejectedCount: 0,
      cacheable: false,
      sources_status,
      literature_density: "unknown",
    };
  }

  const byKey = new Map<string, Candidate>();
  let candN = 0;
  for (const batch of batches) {
    for (const raw of batch) {
      const cand: Candidate = {
        ...raw,
        candId: "",
        abstract: truncateAbstract(raw.abstract || ""),
      };
      const key = dedupeKey(cand);
      if (byKey.has(key)) continue;
      candN += 1;
      cand.candId = `c${candN}`;
      byKey.set(key, cand);
      if (byKey.size >= 30) break;
    }
    if (byKey.size >= 30) break;
  }

  const candidates = [...byKey.values()];
  if (!candidates.length) {
    return {
      readings: [],
      rejectedCount: 0,
      cacheable: true,
      sources_status,
      literature_density: computeLiteratureDensity([], sources_status),
    };
  }

  let rankings: Array<{ id: string; score: number; reason: string }>;
  try {
    rankings = await rankReadings({
      topicTitle: topic.title,
      researchObject: topic.research_object || "",
      researchQuestion: topic.research_question,
      candidates: candidates.map((c) => ({
        id: c.candId,
        title: c.title,
        year: c.year,
        venue: c.venue,
        abstract: c.abstract || "",
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.info(
      JSON.stringify({
        event: "readings.rank_failed",
        at: new Date().toISOString(),
        code: msg.slice(0, 120).replace(/\s+/g, " "),
      }),
    );
    return {
      readings: [],
      rejectedCount: candidates.length,
      cacheable: false,
      sources_status,
      literature_density: "unknown",
    };
  }

  const byId = new Map(candidates.map((c) => [c.candId, c]));
  const scored: Array<VerifiedReading & { relevance_score: number }> = [];
  for (const r of rankings) {
    if (r.score < 2) continue;
    const c = byId.get(r.id);
    if (!c) continue;
    const { candId: _id, ...reading } = c;
    scored.push({
      ...reading,
      authors: reading.authors.slice(0, 3),
      abstract: reading.abstract || undefined,
      relevance_score: r.score,
      relevance_reason: truncateAtWord(r.reason, 100),
    });
  }

  scored.sort((a, b) => {
    const sa = a.relevance_score ?? 0;
    const sb = b.relevance_score ?? 0;
    if (sb !== sa) return sb - sa;
    return (b.year || 0) - (a.year || 0);
  });

  const kept = scored.slice(0, 5);
  const rejectedCount = Math.max(0, candidates.length - kept.length);
  const literature_density = computeLiteratureDensity(kept, sources_status);
  return {
    readings: kept,
    rejectedCount,
    cacheable: true,
    sources_status,
    literature_density,
  };
}

/** @deprecated Prefer deferred /api/topics/readings — kept unused for callers. */
export async function attachReadingsToTopics(
  topics: GeneratedTopic[],
  answers: Record<string, unknown> = {},
): Promise<GeneratedTopic[]> {
  const readingsList = await Promise.all(
    topics.map(async (t) => {
      const { readings, literature_density } = await findReadingsForTopic(
        t,
        answers,
      );
      return { readings, literature_density };
    }),
  );
  return topics.map((t, i) => ({
    ...t,
    readings: readingsList[i]?.readings || [],
    literature_density: readingsList[i]?.literature_density,
  }));
}
