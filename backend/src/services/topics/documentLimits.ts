import type { TopicDocument } from "../../../../shared/research/topicTypes";
import { clampAtSentence } from "./textLimits";

/**
 * Limites caractères documents — source unique pour JSON Schema (dur)
 * et Zod (souple = 2×, comme les sujets).
 */
export const DOCUMENT_LIMITS = {
  projectType: 40,
  title: 220,
  subtitle: 300,
  sectionId: 80,
  heading: 200,
  paragraph: 4000,
  bullet: 400,
  tableHeader: 80,
  tableCell: 400,
} as const;

/** Soft max Zod / output_config : 2× la limite (détection TOO_LONG ensuite). */
export function documentSoftMax(hard: number): number {
  return Math.max(hard * 2, hard + 80);
}

export type DocumentLengthHit = {
  field: string;
  length: number;
  max: number;
};

/** Champs texte à contrôler pour TOO_LONG (limites dures DOCUMENT_LIMITS). */
export function collectDocumentOverLimitFields(
  doc: TopicDocument,
): DocumentLengthHit[] {
  const hits: DocumentLengthHit[] = [];
  const check = (field: string, value: string | null | undefined, max: number) => {
    const t = (value || "").trim();
    if (t.length > max) hits.push({ field, length: t.length, max });
  };

  check("title", doc.title, DOCUMENT_LIMITS.title);
  if (doc.subtitle != null)
    check("subtitle", doc.subtitle, DOCUMENT_LIMITS.subtitle);
  check("projectType", doc.projectType, DOCUMENT_LIMITS.projectType);

  doc.sections.forEach((section, si) => {
    check(`sections[${si}].id`, section.id, DOCUMENT_LIMITS.sectionId);
    check(`sections[${si}].heading`, section.heading, DOCUMENT_LIMITS.heading);
    section.paragraphs.forEach((p, pi) =>
      check(
        `sections[${si}].paragraphs[${pi}]`,
        p,
        DOCUMENT_LIMITS.paragraph,
      ),
    );
    (section.bullets || []).forEach((b, bi) =>
      check(`sections[${si}].bullets[${bi}]`, b, DOCUMENT_LIMITS.bullet),
    );
    if (section.table) {
      section.table.headers.forEach((h, hi) =>
        check(
          `sections[${si}].table.headers[${hi}]`,
          h,
          DOCUMENT_LIMITS.tableHeader,
        ),
      );
      section.table.rows.forEach((row, ri) =>
        row.forEach((cell, ci) =>
          check(
            `sections[${si}].table.rows[${ri}][${ci}]`,
            cell,
            DOCUMENT_LIMITS.tableCell,
          ),
        ),
      );
    }
  });

  return hits;
}

function applyClamp(
  value: string,
  max: number,
  meta: { field: string; kind: TopicDocument["kind"] },
): string {
  if (value.length <= max) return value;
  const clamped = clampAtSentence(value, max);
  if (clamped !== null) return clamped;
  console.info(
    JSON.stringify({
      event: "topics.document",
      code: "TOO_LONG_KEPT",
      kind: meta.kind,
      field: meta.field,
      length: value.length,
      max,
    }),
  );
  return value;
}

/**
 * Après corrections : coupe à la fin de phrase si encore trop long.
 * Sinon garde le texte et journalise TOO_LONG_KEPT.
 */
export function enforceDocumentLimits(doc: TopicDocument): TopicDocument {
  const kind = doc.kind;
  return {
    ...doc,
    title: applyClamp(doc.title, DOCUMENT_LIMITS.title, {
      kind,
      field: "title",
    }),
    subtitle:
      doc.subtitle != null
        ? applyClamp(doc.subtitle, DOCUMENT_LIMITS.subtitle, {
            kind,
            field: "subtitle",
          })
        : doc.subtitle,
    projectType: applyClamp(doc.projectType, DOCUMENT_LIMITS.projectType, {
      kind,
      field: "projectType",
    }),
    sections: doc.sections.map((section, si) => ({
      ...section,
      id: applyClamp(section.id, DOCUMENT_LIMITS.sectionId, {
        kind,
        field: `sections[${si}].id`,
      }),
      heading: applyClamp(section.heading, DOCUMENT_LIMITS.heading, {
        kind,
        field: `sections[${si}].heading`,
      }),
      paragraphs: section.paragraphs.map((p, pi) =>
        applyClamp(p, DOCUMENT_LIMITS.paragraph, {
          kind,
          field: `sections[${si}].paragraphs[${pi}]`,
        }),
      ),
      bullets: section.bullets
        ? section.bullets.map((b, bi) =>
            applyClamp(b, DOCUMENT_LIMITS.bullet, {
              kind,
              field: `sections[${si}].bullets[${bi}]`,
            }),
          )
        : section.bullets,
      table: section.table
        ? {
            headers: section.table.headers.map((h, hi) =>
              applyClamp(h, DOCUMENT_LIMITS.tableHeader, {
                kind,
                field: `sections[${si}].table.headers[${hi}]`,
              }),
            ),
            rows: section.table.rows.map((row, ri) =>
              row.map((cell, ci) =>
                applyClamp(cell, DOCUMENT_LIMITS.tableCell, {
                  kind,
                  field: `sections[${si}].table.rows[${ri}][${ci}]`,
                }),
              ),
            ),
          }
        : section.table,
    })),
  };
}

export function formatDocumentLengthHitsForCorrection(
  hits: DocumentLengthHit[],
): string {
  return hits
    .map(
      (h) =>
        `[TOO_LONG] ${h.field} : ${h.length} caractères (limite ${h.max}). Raccourcis ce champ sans perdre le sens ; coupe à une fin de phrase.`,
    )
    .join("\n");
}
