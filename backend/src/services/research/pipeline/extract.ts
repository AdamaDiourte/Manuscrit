import { z } from "zod";
import type { ResearchUnit } from "../../../../../shared/research/units";
import { EXTRACT_PROMPT_VERSION, EXTRACT_SYSTEM } from "../../../prompts/pipeline/extract";
import {
  callClaude,
  getClaudeSettings,
  parseClaudeOutput,
  providerCapabilities,
  submitBatch,
  type ClaudeUsage,
} from "../../llm/claude";
import type { ObjectStore } from "../../../storage/types";
import {
  recountCoverage,
  updateJob,
  type CoverageRegistry,
} from "../jobs";
import { extractCacheKey, readExtractCache, writeExtractCache } from "./cache";
import { mapPool } from "./concurrency";
import { buildUnitContent } from "./media";
import {
  addUsage,
  emptyUsage,
  extractCardSchema,
  type PipelineUsage,
  type UnitCard,
} from "./types";

function filterQuotes(
  card: z.infer<typeof extractCardSchema>,
  unitText: string,
  transcription?: string,
) {
  const haystack = [unitText, transcription || ""].filter(Boolean).join("\n\n");
  const claims = (card.claims || []).filter(
    (c) =>
      typeof c.quote === "string" &&
      c.quote.length >= 3 &&
      haystack.includes(c.quote),
  );
  return { ...card, claims };
}

function systemWithBrief(brief: string): string {
  return (
    EXTRACT_SYSTEM +
    "\n\nCadrage du projet (identique pour toutes les unités) :\n" +
    brief.slice(0, 8000)
  );
}

function unitMeta(unit: ResearchUnit): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (unit.collectionMode) meta.collectionMode = unit.collectionMode;
  if (unit.interviewerMarker) {
    meta.interviewerMarker = unit.interviewerMarker;
    meta.interviewerNote =
      "Les tours de parole de l’enquêteur commencent par ce marqueur ; n’en tirez aucune quote. Seules les paroles de l’enquêté fondent un claim.";
  }
  return meta;
}

export async function extractUnitCard(
  unit: ResearchUnit,
  brief: string,
  bucket: ObjectStore,
  ownerPrefix: string,
  sendUnit: ResearchUnit = unit,
  relevanceHash = "",
): Promise<{ card: UnitCard; usage: PipelineUsage; cached: boolean }> {
  const model = getClaudeSettings().modelFast;
  const cacheHash = extractCacheKey(
    unit.id,
    sendUnit.text,
    EXTRACT_PROMPT_VERSION,
    model,
    relevanceHash,
    sendUnit.interviewerMarker || unit.interviewerMarker || "",
  );
  const cached = await readExtractCache(bucket, ownerPrefix, cacheHash);
  if (cached)
    return { card: cached, usage: emptyUsage(), cached: true };

  const content = await buildUnitContent(
    sendUnit,
    unitMeta(sendUnit),
    bucket,
    ownerPrefix,
  );
  const result = await callClaude({
    tier: "fast",
    system: systemWithBrief(brief),
    content,
    schema: extractCardSchema,
    maxTokens: 2500,
  });

  const body = filterQuotes(
    result.data,
    sendUnit.text,
    result.data.transcription,
  );
  const card: UnitCard = {
    ...body,
    unitId: unit.id,
    materialId: unit.materialId,
  };
  await writeExtractCache(bucket, ownerPrefix, cacheHash, card);
  return { card, usage: result.usage, cached: false };
}

export async function extractRealtime(
  units: ResearchUnit[],
  brief: string,
  bucket: ObjectStore,
  ownerPrefix: string,
  jobId: string,
  coverage: CoverageRegistry,
  onProgress?: (done: number, total: number) => Promise<void>,
  prepareUnit?: (unit: ResearchUnit) => ResearchUnit | Promise<ResearchUnit>,
  relevanceHash = "",
): Promise<{ cards: UnitCard[]; usage: PipelineUsage; coverage: CoverageRegistry }> {
  const concurrency = getClaudeSettings().concurrency;
  let usage = emptyUsage();
  const registry = {
    ...coverage,
    units: { ...coverage.units },
  };
  let done = registry.totals.done;

  const canVision = providerCapabilities().vision;
  const cards = await mapPool(units, concurrency, async (unit) => {
    const entry = registry.units[unit.id];
    if (entry?.status === "done") {
      const model = getClaudeSettings().modelFast;
      const cacheHash = extractCacheKey(
        unit.id,
        unit.text,
        EXTRACT_PROMPT_VERSION,
        model,
        relevanceHash,
        unit.interviewerMarker || "",
      );
      const cached = await readExtractCache(bucket, ownerPrefix, cacheHash);
      if (cached) return cached;
    }
    if (entry?.status === "skipped") return null;

    if (!canVision && (unit.kind === "image" || unit.scanned)) {
      registry.units[unit.id] = {
        status: "skipped",
        materialId: unit.materialId,
        reason: "description manuelle requise",
      };
      if (onProgress) await onProgress(done, units.length);
      return null;
    }

    try {
      const sendUnit = prepareUnit ? await prepareUnit(unit) : unit;
      const { card, usage: u } = await extractUnitCard(
        unit,
        brief,
        bucket,
        ownerPrefix,
        sendUnit,
        relevanceHash,
      );
      usage = addUsage(usage, u);
      registry.units[unit.id] = {
        status: "done",
        materialId: unit.materialId,
      };
      done += 1;
      if (onProgress) await onProgress(done, units.length);
      return card;
    } catch (err) {
      registry.units[unit.id] = {
        status: "failed",
        materialId: unit.materialId,
        reason:
          err instanceof Error ? err.message : "Échec d’extraction de l’unité.",
      };
      if (onProgress) await onProgress(done, units.length);
      return null;
    }
  });

  const recounted = recountCoverage({ ...registry, units: registry.units });
  await updateJob(bucket, ownerPrefix, jobId, (job) => ({
    ...job,
    step: "extract",
    progress: {
      done: recounted.totals.done + recounted.totals.failed + recounted.totals.skipped,
      total: recounted.totals.total,
    },
    coverage: recounted,
    usage: usage as ClaudeUsage,
  }));

  return {
    cards: cards.filter((c): c is UnitCard => Boolean(c)),
    usage,
    coverage: recounted,
  };
}

/** Prépare et soumet un lot Message Batches pour les unités non cachées. */
export async function submitExtractBatch(
  units: ResearchUnit[],
  brief: string,
  bucket: ObjectStore,
  ownerPrefix: string,
  relevanceHash = "",
): Promise<{
  batchId: string | null;
  cachedCards: UnitCard[];
  pendingUnitIds: string[];
  usage: PipelineUsage;
}> {
  const model = getClaudeSettings().modelFast;
  const system = systemWithBrief(brief);
  const cachedCards: UnitCard[] = [];
  const requests = [];
  const pendingUnitIds: string[] = [];
  let usage = emptyUsage();

  for (const unit of units) {
    const cacheHash = extractCacheKey(
      unit.id,
      unit.text,
      EXTRACT_PROMPT_VERSION,
      model,
      relevanceHash,
      unit.interviewerMarker || "",
    );
    const cached = await readExtractCache(bucket, ownerPrefix, cacheHash);
    if (cached) {
      cachedCards.push(cached);
      continue;
    }
    pendingUnitIds.push(unit.id);
    const content = await buildUnitContent(
      unit,
      unitMeta(unit),
      bucket,
      ownerPrefix,
    );
    requests.push({
      customId: unit.id,
      tier: "fast" as const,
      system,
      content,
      schema: extractCardSchema,
      maxTokens: 2500,
    });
  }

  if (!requests.length)
    return { batchId: null, cachedCards, pendingUnitIds: [], usage };

  const { id } = await submitBatch(requests);
  return { batchId: id, cachedCards, pendingUnitIds, usage };
}

export async function ingestBatchExtractResults(
  units: ResearchUnit[],
  results: Array<{
    customId: string;
    status: string;
    text?: string;
    usage?: ClaudeUsage;
    error?: string;
  }>,
  bucket: ObjectStore,
  ownerPrefix: string,
  cachedCards: UnitCard[],
  relevanceHash = "",
): Promise<{ cards: UnitCard[]; usage: PipelineUsage; coveragePatch: CoverageRegistry["units"] }> {
  const byId = new Map(units.map((u) => [u.id, u]));
  const model = getClaudeSettings().modelFast;
  const cards: UnitCard[] = [...cachedCards];
  let usage = emptyUsage();
  const coveragePatch: CoverageRegistry["units"] = {};

  for (const card of cachedCards) {
    coveragePatch[card.unitId] = {
      status: "done",
      materialId: card.materialId,
    };
  }

  for (const row of results) {
    const unit = byId.get(row.customId);
    if (!unit) continue;
    if (row.status !== "succeeded" || !row.text) {
      coveragePatch[unit.id] = {
        status: "failed",
        materialId: unit.materialId,
        reason: row.error || "Échec lot d’extraction.",
      };
      continue;
    }
    try {
      const raw = parseClaudeOutput(extractCardSchema, row.text);
      const parsed = filterQuotes(raw, unit.text, raw.transcription);
      const card: UnitCard = {
        ...parsed,
        unitId: unit.id,
        materialId: unit.materialId,
      };
      const cacheHash = extractCacheKey(
        unit.id,
        unit.text,
        EXTRACT_PROMPT_VERSION,
        model,
        relevanceHash,
        unit.interviewerMarker || "",
      );
      await writeExtractCache(bucket, ownerPrefix, cacheHash, card);
      cards.push(card);
      coveragePatch[unit.id] = {
        status: "done",
        materialId: unit.materialId,
      };
      if (row.usage) usage = addUsage(usage, row.usage);
    } catch (err) {
      coveragePatch[unit.id] = {
        status: "failed",
        materialId: unit.materialId,
        reason:
          err instanceof Error ? err.message : "Fiche d’extraction invalide.",
      };
    }
  }

  return { cards, usage, coveragePatch };
}
