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
import type { TopicDocument } from "../../../../shared/research/topicTypes";
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

async function packBuffer(
  document: Document,
  kindLabel: string,
  title: string,
) {
  const buffer = Buffer.from(await Packer.toBuffer(document));
  const safe = `${kindLabel}-${title}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
  return {
    filename: `${safe || "document-manuscrit"}.docx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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

export async function buildTopicDocx(doc: TopicDocument): Promise<{
  filename: string;
  mimeType: string;
  buffer: Buffer;
}> {
  const projectType = normalizeProjectType(doc.projectType);
  const kindLabel = documentKindLabel(doc.kind, projectType);

  if (doc.kind === "work_plan" && isUsableWorkPlan(doc.workPlan)) {
    return buildWorkPlanDocument({
      plan: doc.workPlan,
      projectTitle: doc.title,
      documentLabel: kindLabel,
      title: doc.title || "Plan de travail",
      filenameBase: kindLabel,
    });
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

  return packBuffer(document, kindLabel, doc.title);
}
