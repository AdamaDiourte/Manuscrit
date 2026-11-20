import { z } from "zod";
import {
  callClaudeStructured,
  getClaudeSettings,
} from "../llm/claude";
import { truncateAtWord } from "./sourceTypes";

export type RankCandidate = {
  id: string;
  title: string;
  year: number | null;
  venue: string | null;
  abstract: string;
};

export type RankedReading = {
  id: string;
  score: number;
  reason: string;
};

const REASON_MAX = 100;

const rankItemSchema = z.object({
  id: z.string().min(1).max(12),
  score: z.coerce.number().int().min(0).max(3),
  reason: z
    .string()
    .trim()
    .transform((s) => truncateAtWord(s, REASON_MAX)),
});

const rankReadingsLlmSchema = z.object({
  rankings: z.array(rankItemSchema).max(40),
});

/** Schéma plat pour output_config (sans transform). */
const rankReadingsLlmFlatSchema = z.object({
  rankings: z.array(
    z.object({
      id: z.string(),
      score: z.number(),
      reason: z.string(),
    }),
  ),
});

const rankReadingsInputSchema = {
  type: "object",
  properties: {
    rankings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 3 },
          reason: { type: "string", maxLength: REASON_MAX },
        },
        required: ["id", "score", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["rankings"],
  additionalProperties: false,
} as const;

/**
 * Rank scholarly candidates 0–3 for relevance to a topic.
 * Uses AI_MODEL_FAST with low effort. Does not log content.
 */
export async function rankReadings(params: {
  topicTitle: string;
  researchObject: string;
  researchQuestion: string;
  candidates: RankCandidate[];
}): Promise<RankedReading[]> {
  if (!params.candidates.length) return [];

  const { modelFast } = getClaudeSettings();
  const system = [
    "Tu évalues la pertinence de références scientifiques pour un sujet de recherche.",
    "Score 0 = hors sujet, 1 = vague, 2 = pertinent, 3 = très pertinent.",
    "La reason (≤100 caractères) justifie brièvement le score ; phrase complète, jamais coupée au milieu d'un mot.",
    "Ne cite que les id fournis. Ne invente pas de références.",
  ].join(" ");

  const user = [
    "Sujet :",
    params.topicTitle,
    "Objet de recherche :",
    params.researchObject || "(non précisé)",
    "Question :",
    params.researchQuestion,
    "Candidats (JSON) :",
    JSON.stringify(params.candidates),
    "Appelle rank_readings avec un score 0–3 et une reason courte pour chaque candidat pertinent (tu peux omettre les 0).",
  ].join("\n\n");

  const result = await callClaudeStructured<unknown>({
    system,
    user,
    toolName: "rank_readings",
    inputSchema: rankReadingsInputSchema as unknown as Record<string, unknown>,
    zodSchema: rankReadingsLlmFlatSchema,
    model: modelFast,
    maxTokens: 2000,
    effort: "low",
    toolDescription:
      "Classe les lectures candidates par pertinence (score 0–3).",
  });

  const parsed = rankReadingsLlmSchema.parse(result.data);
  const allowed = new Set(params.candidates.map((c) => c.id));
  return parsed.rankings
    .filter((r) => allowed.has(r.id))
    .map((r) => ({
      id: r.id,
      score: r.score,
      reason: truncateAtWord(r.reason.trim(), REASON_MAX),
    }));
}
