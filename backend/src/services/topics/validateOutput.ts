import { z } from "zod";
import type { TopicsOutput } from "../../../../shared/research/topicTypes";

const topicSchema = z.object({
  axis: z.enum(["mastery", "ambition", "discovery"]),
  title: z.string().trim().min(3).max(220),
  context: z
    .string()
    .trim()
    .max(320)
    .optional()
    .transform((v) => v || ""),
  research_question: z.string().trim().min(8).max(600),
  hypotheses: z.array(z.string().trim().min(3).max(400)).min(1).max(5),
  field_or_corpus: z.string().trim().min(3).max(500),
  method: z.string().trim().min(3).max(500),
  feasibility: z.object({
    level: z.enum(["high", "medium", "low"]),
    risks: z.array(z.string().trim().min(2).max(300)).max(6),
    first_steps: z.array(z.string().trim().min(2).max(300)).min(1).max(6),
  }),
  rationale: z.string().trim().min(8).max(800),
  keywords_fr: z.array(z.string().trim().min(1).max(80)).min(2).max(12),
  keywords_en: z.array(z.string().trim().min(1).max(80)).min(2).max(12),
  ethical_notes: z.string().trim().max(800).nullable(),
});

export const topicsOutputSchema = z.object({
  topics: z
    .array(topicSchema)
    .length(3)
    .refine(
      (topics) => {
        const axes = new Set(topics.map((t) => t.axis));
        return (
          axes.has("mastery") &&
          axes.has("ambition") &&
          axes.has("discovery")
        );
      },
      { message: "Les trois axes mastery, ambition et discovery sont requis." },
    ),
});

export function parseTopicsOutput(raw: string): TopicsOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Some models wrap JSON in fences
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON invalide.");
    parsed = JSON.parse(match[0]);
  }
  return topicsOutputSchema.parse(parsed);
}
