import { genreProfileFor } from "../../../../../shared/research/genreProfiles";
import type { WritingStructureHint } from "../engine";
import { PLAN_SYSTEM } from "../../../prompts/pipeline/plan";
import { callClaude } from "../../llm/claude";
import {
  addUsage,
  emptyUsage,
  planSectionsSchema,
  type PipelineUsage,
  type PlanSections,
  type ThemeMap,
} from "./types";

function systemWithBrief(brief: string): string {
  return (
    PLAN_SYSTEM +
    "\n\nCadrage du projet :\n" +
    brief.slice(0, 8000)
  );
}

export async function planSections(
  themeMap: ThemeMap,
  brief: string,
  format: string,
  writingStructure: WritingStructureHint[] | undefined,
  revisionFeedback?: string,
  previousPlan?: { title: string; advice: string }[],
  documentType?: string,
): Promise<{ plan: PlanSections; usage: PipelineUsage }> {
  let usage = emptyUsage();
  const profile = genreProfileFor(documentType);
  const result = await callClaude({
    tier: "smart",
    system: systemWithBrief(brief),
    content: JSON.stringify({
      format,
      writingStructure: writingStructure || [],
      themeMap,
      revisionFeedback: revisionFeedback || "",
      previousPlan: previousPlan || [],
      genreBounds: {
        sections: profile.sections,
        sousParties: profile.sousParties,
        preuvesParSection: profile.preuvesParSection,
      },
      reminder:
        `Respectez les bornes du support : ${profile.sections.min} à ${profile.sections.max} sections` +
        (profile.sousParties.active
          ? `, sous-parties ${profile.sousParties.min} à ${profile.sousParties.max} par section`
          : ", sans sous-parties") +
        ". Ne rédigez pas le manuscrit. Appuyez-vous sur themeIds existants. Les consignes spécifiques et le volume déclaré priment sur le profil.",
    }),
    schema: planSectionsSchema,
    maxTokens: 4500,
  });
  usage = addUsage(usage, result.usage);

  const knownThemes = new Set(themeMap.themes.map((t) => t.themeId));
  const sections = result.data.sections.map((s) => ({
    ...s,
    title: s.title.slice(0, 220),
    advice: s.advice.slice(0, 4000),
    themeIds: s.themeIds.filter((id) => knownThemes.has(id)),
    subsections: s.subsections?.map((sub) => ({
      ...sub,
      title: sub.title.slice(0, 220),
      advice: (sub.advice || "").slice(0, 4000),
      themeIds: (sub.themeIds || []).filter((id) => knownThemes.has(id)),
    })),
  }));

  if (
    sections.length < profile.sections.min ||
    sections.length > profile.sections.max
  )
    throw new Error(
      `La planification doit produire entre ${profile.sections.min} et ${profile.sections.max} sections pour ce support.`,
    );

  if (profile.sousParties.active && profile.sousParties.min > 0) {
    for (const s of sections) {
      const n = s.subsections?.length || 0;
      if (n < profile.sousParties.min || n > profile.sousParties.max)
        throw new Error(
          `Chaque section doit avoir entre ${profile.sousParties.min} et ${profile.sousParties.max} sous-parties pour ce support.`,
        );
    }
  }

  if (!sections.length)
    throw new Error("La planification n’a produit aucune section.");

  return { plan: { sections }, usage };
}
