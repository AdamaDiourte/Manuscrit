import { z } from "zod";
import type { TopicDocument } from "../../../../shared/research/topicTypes";

const tableSchema = z.object({
  headers: z.array(z.string().trim().min(1).max(80)).min(2).max(8),
  rows: z
    .array(z.array(z.string().trim().min(1).max(400)).min(2).max(8))
    .min(2)
    .max(10),
});

const sectionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  heading: z.string().trim().min(2).max(200),
  paragraphs: z.array(z.string().trim().min(8).max(4000)).min(1).max(12),
  bullets: z.array(z.string().trim().min(2).max(400)).max(12).optional(),
  table: tableSchema.optional(),
});

export const topicDocumentSchema = z.object({
  kind: z.enum(["research_project", "work_plan"]),
  projectType: z.string().trim().min(1).max(40),
  title: z.string().trim().min(3).max(220),
  subtitle: z.string().trim().max(300).optional(),
  sections: z.array(sectionSchema).min(3).max(16),
});

export function parseTopicDocument(raw: string): TopicDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON document invalide.");
    parsed = JSON.parse(match[0]);
  }
  return topicDocumentSchema.parse(parsed);
}

/** Density: long for main document, short/synthetic for work plan. */
export function assertDocumentDensity(doc: TopicDocument) {
  const text = doc.sections
    .flatMap((s) => [
      ...s.paragraphs,
      ...(s.bullets || []),
      ...(s.table
        ? [...s.table.headers, ...s.table.rows.flat()]
        : []),
    ])
    .join(" ");
  const words = text.split(/\s+/).filter(Boolean).length;

  if (doc.kind === "work_plan") {
    const hasScheduleTable = doc.sections.some(
      (s) => s.id === "schedule" && s.table && s.table.rows.length >= 3,
    );
    if (!hasScheduleTable)
      throw Object.assign(
        new Error(
          "Le plan de travail doit inclure un tableau de route (section schedule).",
        ),
        { status: 502 },
      );
    if (words < 220 || words > 1200)
      throw Object.assign(
        new Error(
          "Le plan de travail doit rester synthétique (environ 1 à 2 pages).",
        ),
        { status: 502 },
      );
    return;
  }

  if (words < 1400)
    throw Object.assign(
      new Error("Le document généré est trop court. Relancez la génération."),
      { status: 502 },
    );
}
