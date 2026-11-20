import { z } from "zod";
import {
  GENRE_SECTIONS_ABS_MAX,
  GENRE_SUBSECTIONS_ABS_MAX,
} from "../../../../../shared/research/genreProfiles";
import { PHASE_ROLES } from "../../../../../shared/research/workPlan";

export const STATEMENT_TYPES = [
  "fait_rapporte",
  "pratique_decrite",
  "representation_opinion",
  "donnee_chiffree",
  "discours_institutionnel",
  "description_visuelle",
] as const;

export const STANCE_TYPES = [
  "soutient",
  "contredit",
  "nuance",
  "sans_lien",
] as const;

export const UNUSED_REASONS = [
  "hors_sujet",
  "contexte_seulement",
  "hors_perimetre_du_plan",
  "a_discuter_hors_plan",
] as const;

export const extractCardSchema = z.object({
  themes: z.array(z.string()).max(24),
  claims: z
    .array(
      z.object({
        text: z.string(),
        quote: z.string(),
        /** Optionnel à la lecture des anciens plans / caches. */
        statementType: z.enum(STATEMENT_TYPES).optional(),
        stance: z.enum(STANCE_TYPES).optional(),
        hypothesisIndex: z.number().int().nullable().optional(),
      }),
    )
    .max(24),
  concepts: z.array(z.string()).max(24),
  dataPoints: z.array(z.string()).max(24),
  relevance: z.number().min(0).max(3),
  relevanceReason: z.string(),
  emergent: z.boolean().optional(),
  /** Champs vision (images / scans) — optionnels. */
  transcription: z.string().optional(),
  description: z.string().optional(),
  visualType: z
    .enum(["photo", "graphique", "carte", "tableau", "document"])
    .optional(),
  elementsCles: z.array(z.string()).max(24).optional(),
});

export type ExtractCardBody = z.infer<typeof extractCardSchema>;

export type UnitCard = ExtractCardBody & {
  unitId: string;
  materialId: string;
};

export const themeMapSchema = z.object({
  themes: z
    .array(
      z.object({
        themeId: z.string(),
        label: z.string(),
        description: z.string(),
        unitIds: z.array(z.string()),
        weight: z.number().min(1).max(5),
        materialCount: z.number().int().optional(),
        convergences: z.string().optional(),
        divergences: z.string().optional(),
        stanceSummary: z.string().optional(),
        emergent: z.boolean().optional(),
        fragile: z.boolean().optional(),
      }),
    )
    .max(40),
});

export type ThemeMap = z.infer<typeof themeMapSchema>;

const planEvidenceSchema = z.object({
  id: z.string(),
  quote: z.string(),
  stance: z.enum(STANCE_TYPES).optional(),
});

const planSubsectionSchema = z.object({
  title: z.string(),
  thesis: z.string().optional(),
  advice: z.string(),
  themeIds: z.array(z.string()).max(20).optional(),
  hypothesisIndexes: z.array(z.number().int()).max(10).optional(),
  evidence: z.array(planEvidenceSchema).max(24).optional(),
});

export const planSectionsSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string(),
        role: z.enum(PHASE_ROLES).optional(),
        thesis: z.string().optional(),
        advice: z.string(),
        themeIds: z.array(z.string()).max(20),
        hypothesisIndexes: z.array(z.number().int()).max(10).optional(),
        evidence: z.array(planEvidenceSchema).max(24).optional(),
        /** Ajout rétrocompatible — présent si le profil du support le prévoit. */
        subsections: z
          .array(planSubsectionSchema)
          .max(GENRE_SUBSECTIONS_ABS_MAX)
          .optional(),
      }),
    )
    .min(1)
    .max(GENRE_SECTIONS_ABS_MAX),
});

export type PlanSections = z.infer<typeof planSectionsSchema>;

export const assignBatchSchema = z.object({
  assignments: z.array(
    z.object({
      unitId: z.string(),
      sectionIndex: z.number().int().optional(),
      subsectionIndex: z.number().int().optional(),
      unused: z.boolean().optional(),
      /** Enum conseillé ; string libre pour rétrocompat / messages legacy. */
      unusedReason: z.string().optional(),
      quotes: z.array(z.string()).max(5).optional(),
      supportCount: z.number().int().optional(),
      materialCount: z.number().int().optional(),
    }),
  ),
});

export type AssignBatch = z.infer<typeof assignBatchSchema>;

export type PipelineUsage = {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export function emptyUsage(): PipelineUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

export function addUsage(
  a: PipelineUsage,
  b: {
    inputTokens?: number;
    outputTokens?: number;
    thinkingTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  },
): PipelineUsage {
  return {
    inputTokens: a.inputTokens + (b.inputTokens || 0),
    outputTokens: a.outputTokens + (b.outputTokens || 0),
    thinkingTokens: a.thinkingTokens + (b.thinkingTokens || 0),
    cacheCreationInputTokens:
      a.cacheCreationInputTokens + (b.cacheCreationInputTokens || 0),
    cacheReadInputTokens:
      a.cacheReadInputTokens + (b.cacheReadInputTokens || 0),
  };
}
