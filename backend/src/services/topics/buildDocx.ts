import {
  Document,
  Packer,
  Paragraph,
  Table,
} from "docx";
import {
  documentKindLabel,
  normalizeProjectType,
  PROJECT_TYPE_LABELS,
} from "../../../../shared/research/documentStructures";
import { buildDocxFilename } from "../../../../shared/research/docxFilename";
import type {
  TopicDocument,
  VerifiedReading,
} from "../../../../shared/research/topicTypes";
import {
  DOC_CAUTION,
  DOC_MARGINS,
  DOC_SIZES,
  docBody,
  docBullet,
  docHeading,
  docItalic,
  docTitle,
  portraitPageSizeAttrs,
  sectionChrome,
  simpleTable,
} from "../docxTheme";
import {
  buildWorkPlanDocument,
  isUsableWorkPlan,
  planningSubtitle,
} from "../research/buildWorkPlanDocxParts";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Buffer DOCX valide : signature ZIP PK et taille > 2 Ko. */
export function assertValidDocxBuffer(buffer: Buffer): void {
  const ok =
    buffer.length > 2048 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (ok) return;
  console.info(
    JSON.stringify({
      event: "docx.build_failed",
      size: buffer.length,
      hasPk: buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b,
      at: new Date().toISOString(),
    }),
  );
  const err = new Error(
    "Le document Word n’a pas pu être préparé correctement.",
  ) as Error & { status: number; code: string };
  err.status = 502;
  err.code = "docx.build_failed";
  throw err;
}

async function packBuffer(
  document: Document,
  kind: TopicDocument["kind"],
  title: string,
  projectType: string,
) {
  const buffer = Buffer.from(await Packer.toBuffer(document));
  assertValidDocxBuffer(buffer);
  return {
    filename: buildDocxFilename(kind, title, projectType),
    mimeType: DOCX_MIME,
    buffer,
  };
}

function sectionBlocks(
  section: TopicDocument["sections"][number],
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [docHeading(section.heading)];
  for (const p of section.paragraphs) out.push(docBody(p, 100));
  for (const b of section.bullets || []) out.push(docBullet(b));
  if (section.table?.headers?.length && section.table.rows?.length) {
    out.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
    out.push(
      simpleTable(section.table.headers, section.table.rows, {
        fontSize: DOC_SIZES.table,
      }),
    );
    out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
  }
  return out;
}

function formatReadingLine(r: VerifiedReading, withReason: boolean): string {
  const authors =
    r.authors.length > 0 ? r.authors.join(", ") : "Auteur inconnu";
  const year = r.year ?? "s. d.";
  const venue = r.venue ? ` ${r.venue}.` : "";
  const doi = r.doi ? ` DOI: ${r.doi}.` : "";
  const url = r.url ? ` URL: ${r.url}` : "";
  const reason =
    withReason && r.relevance_reason
      ? ` — ${r.relevance_reason}`
      : "";
  return `${authors} (${year}). ${r.title}.${venue}${doi}${url}${reason}`;
}

function bibliographyBlocks(bibliography?: {
  cited: VerifiedReading[];
  other: VerifiedReading[];
}): (Paragraph | Table)[] {
  if (!bibliography) return [];
  const { cited, other } = bibliography;
  if (!cited.length && !other.length) return [];
  const out: (Paragraph | Table)[] = [];
  if (cited.length) {
    out.push(docHeading("Références citées"));
    for (const r of cited) {
      out.push(docBody(formatReadingLine(r, false), 80));
    }
  }
  if (other.length) {
    out.push(docHeading("Autres pistes de lecture"));
    for (const r of other) {
      out.push(docBody(formatReadingLine(r, true), 80));
    }
  }
  return out;
}

export async function buildTopicDocx(
  doc: TopicDocument,
  options?: {
    readings?: VerifiedReading[];
    bibliography?: { cited: VerifiedReading[]; other: VerifiedReading[] };
  },
): Promise<{
  filename: string;
  mimeType: string;
  buffer: Buffer;
}> {
  const projectType = normalizeProjectType(doc.projectType);
  const kindLabel = documentKindLabel(doc.kind, projectType);

  if (doc.kind === "work_plan" && isUsableWorkPlan(doc.workPlan)) {
    const file = await buildWorkPlanDocument({
      plan: doc.workPlan,
      projectTitle: doc.title,
      documentLabel: kindLabel,
      title: doc.title || "Plan de travail",
      filenameKind: "work_plan",
      projectType,
    });
    assertValidDocxBuffer(file.buffer);
    return file;
  }

  const children: (Paragraph | Table)[] = [docTitle(doc.title)];

  children.push(
    docItalic(
      planningSubtitle({
        projectTitle: doc.title,
        typeLabel: kindLabel,
      }),
      140,
    ),
  );

  children.push(
    docBody(
      doc.kind === "work_plan"
        ? `${kindLabel} pour un ${PROJECT_TYPE_LABELS[projectType].toLowerCase()}. Vue synthétique pour organiser le travail selon le temps et les attentes déclarées.`
        : `${kindLabel} adapté à un ${PROJECT_TYPE_LABELS[projectType].toLowerCase()}. Document de travail destiné à guider la suite du projet.`,
      140,
    ),
  );

  for (const section of doc.sections) {
    children.push(...sectionBlocks(section));
  }

  if (doc.kind === "research_project") {
    const bibliography =
      options?.bibliography ||
      (options?.readings?.length
        ? { cited: options.readings, other: [] as VerifiedReading[] }
        : undefined);
    children.push(...bibliographyBlocks(bibliography));
  }

  children.push(
    docItalic(
      DOC_CAUTION.replace("Document généré", "Contenu généré"),
      40,
    ),
  );

  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            size: portraitPageSizeAttrs(),
            margin:
              doc.kind === "work_plan"
                ? DOC_MARGINS.compact
                : DOC_MARGINS.default,
          },
        },
        ...sectionChrome(doc.title),
        children,
      },
    ],
  });

  return packBuffer(document, doc.kind, doc.title, projectType);
}
