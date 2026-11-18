import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  documentKindLabel,
  normalizeProjectType,
  PROJECT_TYPE_LABELS,
} from "../../../../shared/research/documentStructures";
import type { TopicDocument } from "../../../../shared/research/topicTypes";

function bodyParagraph(text: string, after = 160) {
  return new Paragraph({
    spacing: { after, line: 320 },
    children: [
      new TextRun({
        text,
        font: "Times New Roman",
        size: 22,
      }),
    ],
  });
}

function bulletParagraph(text: string) {
  return new Paragraph({
    spacing: { after: 80, line: 300 },
    bullet: { level: 0 },
    children: [
      new TextRun({
        text,
        font: "Times New Roman",
        size: 22,
      }),
    ],
  });
}

function cell(text: string, opts?: { bold?: boolean; width: number }) {
  return new TableCell({
    width: { size: opts?.width ?? 1800, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "CFD5DB" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "CFD5DB" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "CFD5DB" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "CFD5DB" },
    },
    children: [
      new Paragraph({
        spacing: { after: 40, before: 40 },
        children: [
          new TextRun({
            text,
            bold: Boolean(opts?.bold),
            font: "Times New Roman",
            size: 18,
          }),
        ],
      }),
    ],
  });
}

function buildTable(headers: string[], rows: string[][]) {
  const colCount = Math.max(headers.length, 1);
  const width = Math.floor(9000 / colCount);
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: headers.map((h) => cell(h, { bold: true, width })),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: Array.from({ length: colCount }, (_, i) =>
              cell(row[i] || "—", { width }),
            ),
          }),
      ),
    ],
  });
}

export async function buildTopicDocx(doc: TopicDocument): Promise<{
  filename: string;
  mimeType: string;
  buffer: Buffer;
}> {
  const projectType = normalizeProjectType(doc.projectType);
  const kindLabel = documentKindLabel(doc.kind, projectType);
  const compact = doc.kind === "work_plan";
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [
        new TextRun({
          text: doc.title,
          bold: true,
          font: "Times New Roman",
          size: compact ? 28 : 32,
        }),
      ],
    }),
  ];

  if (doc.subtitle) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: compact ? 200 : 360 },
        children: [
          new TextRun({
            text: doc.subtitle,
            italics: true,
            font: "Times New Roman",
            size: 20,
          }),
        ],
      }),
    );
  }

  children.push(
    bodyParagraph(
      compact
        ? `${kindLabel} pour un ${PROJECT_TYPE_LABELS[projectType].toLowerCase()}. Vue synthétique pour organiser le travail selon le temps et les attentes déclarées.`
        : `${kindLabel} adapté à un ${PROJECT_TYPE_LABELS[projectType].toLowerCase()}. Document de travail destiné à guider la suite du projet.`,
      compact ? 120 : 200,
    ),
  );

  for (const section of doc.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: compact ? 220 : 320, after: 120 },
        children: [
          new TextRun({
            text: section.heading,
            bold: true,
            font: "Times New Roman",
            size: compact ? 24 : 28,
          }),
        ],
      }),
    );
    for (const p of section.paragraphs) children.push(bodyParagraph(p, compact ? 100 : 180));
    for (const b of section.bullets || []) children.push(bulletParagraph(b));
    if (section.table?.headers?.length && section.table.rows?.length) {
      children.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      children.push(buildTable(section.table.headers, section.table.rows));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    }
  }

  children.push(
    new Paragraph({
      spacing: { before: compact ? 240 : 400 },
      children: [
        new TextRun({
          text: "Contenu généré avec Manuscrit. À relire et adapter avec votre encadrement.",
          italics: true,
          font: "Times New Roman",
          size: 18,
        }),
      ],
    }),
  );

  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: compact ? 850 : 1134,
              bottom: compact ? 850 : 1134,
              left: compact ? 850 : 1134,
              right: compact ? 850 : 1134,
            },
          },
        },
        children,
      },
    ],
  });

  const buffer = Buffer.from(await Packer.toBuffer(document));
  const safe = `${kindLabel}-${doc.title}`
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
