import { z } from "zod";
import type { TopicDocument } from "../../../../shared/research/topicTypes";
import { phaseRoleSchema } from "../../../../shared/research/workPlan";
import { DOCUMENT_LIMITS, documentSoftMax } from "./documentLimits";

/** Accepte jusqu'à soft max ; TOO_LONG + coupe ensuite. */
const softString = (hard: number, min = 1) =>
  z
    .string()
    .trim()
    .pipe(z.string().min(min).max(documentSoftMax(hard)));

const softStringOpt = (hard: number) =>
  z
    .string()
    .trim()
    .pipe(z.string().max(documentSoftMax(hard)))
    .optional();

const tableSchema = z.object({
  headers: z
    .array(softString(DOCUMENT_LIMITS.tableHeader))
    .min(2)
    .max(8),
  rows: z
    .array(z.array(softString(DOCUMENT_LIMITS.tableCell)).min(2).max(8))
    .min(2)
    .max(10),
});

const sectionSchema = z.object({
  id: softString(DOCUMENT_LIMITS.sectionId),
  heading: softString(DOCUMENT_LIMITS.heading, 2),
  paragraphs: z
    .array(softString(DOCUMENT_LIMITS.paragraph, 8))
    .min(1)
    .max(12),
  bullets: z.array(softString(DOCUMENT_LIMITS.bullet, 2)).max(12).optional(),
  table: tableSchema.optional(),
  /** Optionnel : une réponse IA sans `role` n’est jamais rejetée. */
  role: phaseRoleSchema.optional(),
});

export const topicDocumentSchema = z.object({
  kind: z.enum(["research_project", "work_plan"]),
  projectType: softString(DOCUMENT_LIMITS.projectType),
  title: softString(DOCUMENT_LIMITS.title, 3),
  subtitle: softStringOpt(DOCUMENT_LIMITS.subtitle),
  sections: z.array(sectionSchema).min(3).max(16),
});

/** Schéma plat pour output_config (soft max aligné). */
export const proposeDocumentLlmSchema = z.object({
  kind: z.enum(["research_project", "work_plan"]),
  projectType: softString(DOCUMENT_LIMITS.projectType),
  title: softString(DOCUMENT_LIMITS.title, 3),
  subtitle: softStringOpt(DOCUMENT_LIMITS.subtitle),
  sections: z.array(
    z.object({
      id: softString(DOCUMENT_LIMITS.sectionId),
      heading: softString(DOCUMENT_LIMITS.heading, 2),
      paragraphs: z.array(softString(DOCUMENT_LIMITS.paragraph, 8)),
      bullets: z.array(softString(DOCUMENT_LIMITS.bullet, 2)).optional(),
      table: z
        .object({
          headers: z.array(softString(DOCUMENT_LIMITS.tableHeader)),
          rows: z.array(z.array(softString(DOCUMENT_LIMITS.tableCell))),
        })
        .optional(),
    }),
  ),
});

/** JSON Schema for Anthropic tool input_schema — limites dures. */
export const proposeDocumentInputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["research_project", "work_plan"] },
    projectType: {
      type: "string",
      minLength: 1,
      maxLength: DOCUMENT_LIMITS.projectType,
    },
    title: {
      type: "string",
      minLength: 3,
      maxLength: DOCUMENT_LIMITS.title,
    },
    subtitle: { type: "string", maxLength: DOCUMENT_LIMITS.subtitle },
    sections: {
      type: "array",
      minItems: 3,
      maxItems: 16,
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            minLength: 1,
            maxLength: DOCUMENT_LIMITS.sectionId,
          },
          heading: {
            type: "string",
            minLength: 2,
            maxLength: DOCUMENT_LIMITS.heading,
          },
          paragraphs: {
            type: "array",
            items: {
              type: "string",
              minLength: 8,
              maxLength: DOCUMENT_LIMITS.paragraph,
            },
            minItems: 1,
            maxItems: 12,
          },
          bullets: {
            type: "array",
            items: {
              type: "string",
              minLength: 2,
              maxLength: DOCUMENT_LIMITS.bullet,
            },
            maxItems: 12,
          },
          table: {
            type: "object",
            properties: {
              headers: {
                type: "array",
                items: {
                  type: "string",
                  minLength: 1,
                  maxLength: DOCUMENT_LIMITS.tableHeader,
                },
                minItems: 2,
                maxItems: 8,
              },
              rows: {
                type: "array",
                items: {
                  type: "array",
                  items: {
                    type: "string",
                    minLength: 1,
                    maxLength: DOCUMENT_LIMITS.tableCell,
                  },
                  minItems: 2,
                  maxItems: 8,
                },
                minItems: 2,
                maxItems: 10,
              },
            },
            required: ["headers", "rows"],
          },
        },
        required: ["id", "heading", "paragraphs"],
        additionalProperties: false,
      },
    },
  },
  required: ["kind", "projectType", "title", "sections"],
  additionalProperties: false,
};

/**
 * Nettoyage avant Zod : paragraphs vides (sections bullets-only) et
 * tables incomplètes (headers/rows trop courts) que le modèle laisse parfois.
 */
function sanitizeDocumentInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const doc = input as Record<string, unknown>;
  if (!Array.isArray(doc.sections)) return input;
  return {
    ...doc,
    sections: doc.sections.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const s = { ...(raw as Record<string, unknown>) };
      const paragraphs = Array.isArray(s.paragraphs)
        ? (s.paragraphs as unknown[]).filter(
            (p) => typeof p === "string" && p.trim().length >= 8,
          )
        : [];
      if (paragraphs.length === 0) {
        const bullets = Array.isArray(s.bullets)
          ? (s.bullets as unknown[]).filter(
              (b) => typeof b === "string" && b.trim().length > 0,
            )
          : [];
        const heading =
          typeof s.heading === "string" && s.heading.trim()
            ? s.heading.trim()
            : "Cette section";
        s.paragraphs =
          bullets.length > 0
            ? [`Points clés pour « ${heading} » : voir la liste ci-dessous.`]
            : [`Section « ${heading} » : à compléter avec l'encadrement.`];
      } else {
        s.paragraphs = paragraphs;
      }
      if (s.table && typeof s.table === "object" && !Array.isArray(s.table)) {
        const table = s.table as { headers?: unknown; rows?: unknown };
        const headers = Array.isArray(table.headers) ? table.headers : [];
        const rows = Array.isArray(table.rows) ? table.rows : [];
        const headersOk =
          headers.length >= 2 &&
          headers.every((h) => typeof h === "string" && h.trim().length > 0);
        const rowsOk =
          rows.length >= 2 &&
          rows.every(
            (r) =>
              Array.isArray(r) &&
              r.length >= 2 &&
              r.every((c) => typeof c === "string" && c.trim().length > 0),
          );
        if (!headersOk || !rowsOk) delete s.table;
      }
      return s;
    }),
  };
}

export function parseProposeDocumentToolInput(input: unknown): TopicDocument {
  return topicDocumentSchema.parse(
    sanitizeDocumentInput(input),
  ) as TopicDocument;
}

export function parseTopicDocument(raw: string): TopicDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON document invalide.");
    parsed = JSON.parse(match[0]);
  }
  return topicDocumentSchema.parse(parsed) as TopicDocument;
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
