/**
 * Charte Word commune Manuscrit — Georgia / Calibri / couleurs marque.
 * Tailles en half-points (docx) : 20 pt → 40, 11 pt → 22, etc.
 */

import {
  AlignmentType,
  BorderStyle,
  Footer,
  Header,
  HeadingLevel,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from "docx";

export const DOC_COLORS = {
  brand: "1E4D63",
  progress: "B07A2E", // aplats ambre uniquement
  progressInk: "8A5A1C", // texte ambre (WCAG AA sur blanc)
  soft: "F5EBD8",
  softBlue: "DDE7EE",
  border: "CFD5DB",
  borderMonth: "B8C1CA", // séparateurs de mois un peu plus marqués
  slate: "5A6570", // gris mini (jamais plus clair)
  white: "FFFFFF",
  ink: "15202B",
} as const;

/** Tailles half-points — source unique pour tous les exports. */
export const DOC_SIZES = {
  title: 40, // Georgia 20 pt
  heading: 28, // Georgia 14 pt
  body: 22, // Calibri 11 pt
  table: 22, // Calibri 11 pt
  tableHeader: 20, // Calibri 10 pt gras (en-têtes Gantt / tableaux)
  progress: 24, // Calibri 12 pt gras
  metricValue: 28, // Calibri 14 pt gras (bandeau durée / charge)
  metricLabel: 20, // Calibri 10 pt
  legend: 20, // Calibri 10 pt
  meta: 20, // Calibri 10 pt
  headerFooter: 20, // Calibri 10 pt gris (WCAG / pied)
  source: 20, // Calibri 10 pt mini
  hint: 20, // Calibri 10 pt gris (semaines…)
} as const;

export const DOC_CAUTION =
  "Document généré avec Manuscrit. À relire et adapter avec votre encadrement.";

/** Marges compactes (~1,27 cm). */
export const DOC_MARGINS = {
  default: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
  compact: { top: 720, bottom: 720, left: 720, right: 720 },
} as const;

/**
 * Dimensions logiques A4.
 * Note : `docx` createPageSize **inverse** w/h si orient=landscape.
 * Utiliser `landscapePageSizeAttrs()` pour l’émission XML correcte.
 */
export const DOC_PAGE = {
  /** Zone utile paysage : largeur 297 mm ≈ 16838 DXA. */
  landscape: { width: 16838, height: 11906 },
  portrait: { width: 11906, height: 16838 },
} as const;

/**
 * La lib docx inverse width/height quand orientation = LANDSCAPE : on passe donc
 * volontairement les dimensions portrait. Ne pas modifier. Vérifier le pgSz du
 * .docx (w=16838, h=11906).
 */
export function landscapePageSizeAttrs() {
  return {
    orientation: PageOrientation.LANDSCAPE,
    width: DOC_PAGE.portrait.width,
    height: DOC_PAGE.portrait.height,
  };
}

export function portraitPageSizeAttrs() {
  return {
    orientation: PageOrientation.PORTRAIT,
    width: DOC_PAGE.portrait.width,
    height: DOC_PAGE.portrait.height,
  };
}

export function contentWidthDx(
  orientation: "landscape" | "portrait" = "landscape",
  margins = DOC_MARGINS.compact,
): number {
  const page =
    orientation === "landscape" ? DOC_PAGE.landscape : DOC_PAGE.portrait;
  return page.width - margins.left - margins.right;
}

export const thinBorder = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: DOC_COLORS.border,
};

/** Séparateur de mois (un cran plus marqué). */
export const monthSepBorder = {
  style: BorderStyle.SINGLE,
  size: 8,
  color: DOC_COLORS.borderMonth,
};

export const noBorder = {
  style: BorderStyle.NONE,
  size: 0,
  color: DOC_COLORS.white,
};

/** Marges internes cellules : 80–120 DXA. */
export const CELL_PAD = { before: 100, after: 100 } as const;

export function runCalibri(
  text: string,
  opts?: {
    bold?: boolean;
    italics?: boolean;
    size?: number;
    color?: string;
  },
) {
  return new TextRun({
    text,
    font: "Calibri",
    size: opts?.size ?? DOC_SIZES.body,
    bold: opts?.bold,
    italics: opts?.italics,
    color: opts?.color,
  });
}

export function runGeorgia(
  text: string,
  opts?: { bold?: boolean; size?: number; color?: string },
) {
  return new TextRun({
    text,
    font: "Georgia",
    size: opts?.size ?? DOC_SIZES.heading,
    bold: opts?.bold ?? true,
    color: opts?.color ?? DOC_COLORS.brand,
  });
}

export function docTitle(text: string) {
  return new Paragraph({
    heading: HeadingLevel.TITLE,
    spacing: { after: 80 },
    children: [runGeorgia(text, { size: DOC_SIZES.title, bold: true })],
  });
}

export function docHeading(text: string, before = 160) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before, after: 60 },
    children: [runGeorgia(text, { size: DOC_SIZES.heading, bold: true })],
  });
}

export function docBody(text: string, after = 100) {
  return new Paragraph({
    spacing: { after, line: 276 },
    children: [runCalibri(text, { size: DOC_SIZES.body })],
  });
}

export function docItalic(text: string, after = 80) {
  return new Paragraph({
    spacing: { after, line: 276 },
    children: [
      runCalibri(text, {
        italics: true,
        size: DOC_SIZES.meta,
        color: DOC_COLORS.slate,
      }),
    ],
  });
}

export function docBullet(text: string) {
  return new Paragraph({
    spacing: { after: 40, line: 276 },
    bullet: { level: 0 },
    children: [runCalibri(text, { size: DOC_SIZES.body })],
  });
}

/** Citation en retrait avec filet gauche marque. */
export function docQuote(quote: string) {
  return new Paragraph({
    spacing: { after: 40, line: 276 },
    indent: { left: 288 },
    border: {
      left: {
        style: BorderStyle.SINGLE,
        size: 24,
        color: DOC_COLORS.brand,
        space: 8,
      },
    },
    children: [
      runCalibri(`« ${quote} »`, {
        italics: true,
        size: DOC_SIZES.body,
        color: DOC_COLORS.ink,
      }),
    ],
  });
}

export function docSourceLine(ref: string) {
  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: 288 },
    children: [
      runCalibri(`Source : ${ref}`, {
        size: DOC_SIZES.source,
        color: DOC_COLORS.slate,
      }),
    ],
  });
}

export function docHeader(projectTitle?: string) {
  const label = (projectTitle || "").trim() || "Manuscrit";
  return new Header({
    children: [
      new Paragraph({
        children: [
          runCalibri(`Manuscrit · ${label}`, {
            italics: true,
            size: DOC_SIZES.headerFooter,
            color: DOC_COLORS.brand,
          }),
        ],
      }),
    ],
  });
}

export function docFooter(caution = DOC_CAUTION) {
  return new Footer({
    children: [
      new Paragraph({
        children: [
          runCalibri("Page ", {
            size: DOC_SIZES.headerFooter,
            color: DOC_COLORS.slate,
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            font: "Calibri",
            size: DOC_SIZES.headerFooter,
            color: DOC_COLORS.slate,
          }),
          runCalibri(` · ${caution}`, {
            italics: true,
            size: DOC_SIZES.headerFooter,
            color: DOC_COLORS.slate,
          }),
        ],
      }),
    ],
  });
}

/** Répartit des pourcentages en largeurs DXA (somme = tableWidth). */
export function widthsFromPercents(
  percents: number[],
  tableWidth: number,
): number[] {
  const raw = percents.map((p) => Math.floor((p / 100) * tableWidth));
  const drift = tableWidth - raw.reduce((a, b) => a + b, 0);
  if (raw.length) raw[raw.length - 1] += drift;
  return raw;
}

export function simpleTable(
  headers: string[],
  rows: string[][],
  opts?: {
    headerBrand?: boolean;
    zebra?: boolean;
    fontSize?: number;
    tableWidth?: number;
    columnPercents?: number[];
  },
) {
  const colCount = Math.max(headers.length, 1);
  const tableWidth = opts?.tableWidth ?? contentWidthDx("portrait");
  const widths =
    opts?.columnPercents && opts.columnPercents.length === colCount
      ? widthsFromPercents(opts.columnPercents, tableWidth)
      : widthsFromPercents(
          Array.from({ length: colCount }, () => 100 / colCount),
          tableWidth,
        );
  const fontSize = opts?.fontSize ?? DOC_SIZES.table;
  const headerBrand = opts?.headerBrand !== false;
  const zebra = opts?.zebra !== false;

  const headerCell = (text: string, width: number) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      verticalAlign: VerticalAlignTable.CENTER,
      shading: headerBrand
        ? {
            type: ShadingType.CLEAR,
            fill: DOC_COLORS.brand,
            color: DOC_COLORS.brand,
          }
        : undefined,
      borders: {
        top: thinBorder,
        bottom: thinBorder,
        left: thinBorder,
        right: thinBorder,
      },
      children: [
        new Paragraph({
          spacing: CELL_PAD,
          children: [
            runCalibri(text, {
              bold: true,
              size: DOC_SIZES.tableHeader,
              color: headerBrand ? DOC_COLORS.white : DOC_COLORS.brand,
            }),
          ],
        }),
      ],
    });

  const bodyCell = (text: string, rowIndex: number, width: number) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      verticalAlign: VerticalAlignTable.CENTER,
      shading:
        zebra && rowIndex % 2 === 1
          ? {
              type: ShadingType.CLEAR,
              fill: DOC_COLORS.softBlue,
              color: DOC_COLORS.softBlue,
            }
          : undefined,
      borders: {
        top: thinBorder,
        bottom: thinBorder,
        left: thinBorder,
        right: thinBorder,
      },
      children: [
        new Paragraph({
          spacing: CELL_PAD,
          children: [runCalibri(text || "—", { size: fontSize })],
        }),
      ],
    });

  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: headers.map((h, i) => headerCell(h, widths[i])),
      }),
      ...rows.map(
        (row, ri) =>
          new TableRow({
            children: Array.from({ length: colCount }, (_, i) =>
              bodyCell(row[i] || "—", ri, widths[i]),
            ),
          }),
      ),
    ],
  });
}

export function sectionChrome(projectTitle?: string) {
  return {
    headers: { default: docHeader(projectTitle) },
    footers: { default: docFooter() },
  };
}

export const DOC_ALIGN = AlignmentType;
