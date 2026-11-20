import { SYNTHESIZE_SYSTEM } from "../../../prompts/pipeline/synthesize";
import { callClaude } from "../../llm/claude";
import {
  addUsage,
  emptyUsage,
  themeMapSchema,
  type PipelineUsage,
  type ThemeMap,
  type UnitCard,
} from "./types";

function estimateTokens(payload: unknown): number {
  return Math.ceil(JSON.stringify(payload).length / 4);
}

const BATCH_TOKEN_BUDGET = 60_000;

function chunkCards(cards: UnitCard[]): UnitCard[][] {
  const batches: UnitCard[][] = [];
  let current: UnitCard[] = [];
  let tokens = 0;
  for (const card of cards) {
    const t = estimateTokens(card);
    if (current.length && tokens + t > BATCH_TOKEN_BUDGET) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(card);
    tokens += t;
  }
  if (current.length) batches.push(current);
  return batches;
}

function slimCard(card: UnitCard) {
  return {
    unitId: card.unitId,
    materialId: card.materialId,
    themes: card.themes,
    claims: card.claims.map((c) => c.text).slice(0, 8),
    concepts: card.concepts.slice(0, 12),
    dataPoints: card.dataPoints.slice(0, 8),
    relevance: card.relevance,
  };
}

function systemWithBrief(brief: string): string {
  return SYNTHESIZE_SYSTEM + "\n\nCadrage :\n" + brief.slice(0, 6000);
}

export type SynthesizeRevision = {
  revisionFeedback?: string;
  previousPlan?: { title: string; advice: string }[];
};

async function synthesizeBatch(
  cards: UnitCard[],
  brief: string,
  label: string,
  revision?: SynthesizeRevision,
): Promise<{ map: ThemeMap; usage: PipelineUsage }> {
  const result = await callClaude({
    tier: "smart",
    system: systemWithBrief(brief),
    content: JSON.stringify({
      label,
      fiches: cards.map(slimCard),
      revisionFeedback: revision?.revisionFeedback || "",
      previousPlan: revision?.previousPlan || [],
    }),
    schema: themeMapSchema,
    maxTokens: 4000,
  });
  return { map: result.data, usage: result.usage };
}

/** Réduction hiérarchique : lots de fiches → thèmes → carte transversale. */
export async function synthesizeThemeMap(
  cards: UnitCard[],
  brief: string,
  revision?: SynthesizeRevision,
): Promise<{ map: ThemeMap; usage: PipelineUsage }> {
  let usage = emptyUsage();
  if (!cards.length) {
    return { map: { themes: [] }, usage };
  }

  const batches = chunkCards(cards);
  const partialMaps: ThemeMap[] = [];

  if (batches.length === 1) {
    const one = await synthesizeBatch(batches[0], brief, "lot-unique", revision);
    return { map: one.map, usage: addUsage(usage, one.usage) };
  }

  for (let i = 0; i < batches.length; i++) {
    const part = await synthesizeBatch(
      batches[i],
      brief,
      `lot-${i + 1}`,
      revision,
    );
    usage = addUsage(usage, part.usage);
    partialMaps.push(part.map);
  }

  const byMaterial = new Map<string, UnitCard[]>();
  for (const card of cards) {
    const list = byMaterial.get(card.materialId) || [];
    list.push(card);
    byMaterial.set(card.materialId, list);
  }

  const materialMaps: ThemeMap[] = [];
  if (byMaterial.size > 1 && byMaterial.size <= 40) {
    for (const [materialId, materialCards] of byMaterial) {
      const part = await synthesizeBatch(
        materialCards,
        brief,
        `matériau-${materialId}`,
        revision,
      );
      usage = addUsage(usage, part.usage);
      materialMaps.push(part.map);
    }
  }

  const toMerge =
    materialMaps.length > 1
      ? materialMaps
      : partialMaps;

  const mergePayload = {
    cartesPartielles: toMerge,
  };
  const merged = await callClaude({
    tier: "smart",
    system:
      systemWithBrief(brief) +
      "\n\nFusionnez les cartes partielles en une seule carte transversale sans perdre les unitIds.",
    content: JSON.stringify({
      revisionFeedback: revision?.revisionFeedback || "",
      previousPlan: revision?.previousPlan || [],
      ...mergePayload,
    }),
    schema: themeMapSchema,
    maxTokens: 4500,
  });
  usage = addUsage(usage, merged.usage);

  const known = new Set(cards.map((c) => c.unitId));
  const themes = merged.data.themes
    .map((t, i) => ({
      ...t,
      themeId: t.themeId || `theme-${i + 1}`,
      unitIds: t.unitIds.filter((id) => known.has(id)),
    }))
    .filter((t) => t.unitIds.length > 0);

  return { map: { themes }, usage };
}
