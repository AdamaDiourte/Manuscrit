import { ASSIGN_SYSTEM } from "../../../prompts/pipeline/assign";
import { callClaude } from "../../llm/claude";
import { mapPool } from "./concurrency";
import { getClaudeSettings } from "../../llm/claude";
import {
  addUsage,
  assignBatchSchema,
  emptyUsage,
  type PipelineUsage,
  type PlanSections,
  type UnitCard,
} from "./types";

export type Assignment = {
  unitId: string;
  materialId: string;
  sectionIndex?: number;
  subsectionIndex?: number;
  unused: boolean;
  unusedReason?: string;
  quotes: string[];
};

export type AssignRevision = {
  revisionFeedback?: string;
  previousPlan?: { title: string; advice: string }[];
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function verifiedQuotes(card: UnitCard, requested: string[] | undefined): string[] {
  const allowed = new Set(card.claims.map((c) => c.quote).filter(Boolean));
  const picks: string[] = [];
  for (const q of requested || []) {
    if (allowed.has(q) && q.length >= 3 && !picks.includes(q)) picks.push(q);
    if (picks.length >= 3) break;
  }
  if (!picks.length) {
    for (const c of card.claims) {
      if (c.quote && c.quote.length >= 3) picks.push(c.quote);
      if (picks.length >= 2) break;
    }
  }
  return picks;
}

export async function assignCardsToSections(
  cards: UnitCard[],
  plan: PlanSections,
  brief: string,
  revision?: AssignRevision,
): Promise<{ assignments: Assignment[]; unused: Assignment[]; usage: PipelineUsage }> {
  let usage = emptyUsage();
  const eligible = cards.filter((c) => c.relevance >= 1);
  const skippedLow = cards
    .filter((c) => c.relevance < 1)
    .map((c) => ({
      unitId: c.unitId,
      materialId: c.materialId,
      unused: true as const,
      unusedReason: "Pertinence trop faible (relevance < 1).",
      quotes: [] as string[],
    }));

  if (!eligible.length)
    return { assignments: [], unused: skippedLow, usage };

  const sectionSummary = plan.sections.map((s, i) => ({
    sectionIndex: i,
    title: s.title,
    role: s.role,
    themeIds: s.themeIds,
    subsections: (s.subsections || []).map((sub, j) => ({
      subsectionIndex: j,
      title: sub.title,
      themeIds: sub.themeIds || [],
    })),
  }));

  const batches = chunk(eligible, 25);
  const concurrency = Math.min(2, getClaudeSettings().concurrency);
  const partial = await mapPool(batches, concurrency, async (batch) => {
    const result = await callClaude({
      tier: "smart",
      system: ASSIGN_SYSTEM + "\n\nCadrage :\n" + brief.slice(0, 4000),
      content: JSON.stringify({
        sections: sectionSummary,
        fiches: batch.map((c) => ({
          unitId: c.unitId,
          materialId: c.materialId,
          relevance: c.relevance,
          themes: c.themes,
          claims: c.claims.slice(0, 10),
        })),
        revisionFeedback: revision?.revisionFeedback || "",
        previousPlan: revision?.previousPlan || [],
      }),
      schema: assignBatchSchema,
      maxTokens: 3500,
    });
    return { assignments: result.data.assignments, usage: result.usage };
  });
  for (const part of partial) usage = addUsage(usage, part.usage);

  const byUnit = new Map(eligible.map((c) => [c.unitId, c]));
  const assignments: Assignment[] = [];
  const unused: Assignment[] = [...skippedLow];
  const seen = new Set<string>();

  for (const row of partial.flatMap((p) => p.assignments)) {
    const card = byUnit.get(row.unitId);
    if (!card || seen.has(row.unitId)) continue;
    seen.add(row.unitId);
    const quotes = verifiedQuotes(card, row.quotes);
    if (
      row.unused ||
      row.sectionIndex === undefined ||
      row.sectionIndex < 0 ||
      row.sectionIndex >= plan.sections.length
    ) {
      unused.push({
        unitId: card.unitId,
        materialId: card.materialId,
        unused: true,
        unusedReason: row.unusedReason || "Non rattachée à une section.",
        quotes,
      });
      continue;
    }
    const subCount = plan.sections[row.sectionIndex]?.subsections?.length || 0;
    const subsectionIndex =
      typeof row.subsectionIndex === "number" &&
      row.subsectionIndex >= 0 &&
      row.subsectionIndex < subCount
        ? row.subsectionIndex
        : undefined;
    assignments.push({
      unitId: card.unitId,
      materialId: card.materialId,
      sectionIndex: row.sectionIndex,
      ...(subsectionIndex !== undefined ? { subsectionIndex } : {}),
      unused: false,
      quotes,
    });
  }

  for (const card of eligible) {
    if (seen.has(card.unitId)) continue;
    unused.push({
      unitId: card.unitId,
      materialId: card.materialId,
      unused: true,
      unusedReason: "Fiche absente de la réponse d’affectation.",
      quotes: verifiedQuotes(card, undefined),
    });
  }

  return { assignments, unused, usage };
}
