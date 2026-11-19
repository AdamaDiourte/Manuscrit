/**
 * Planning compact Word : 2 pages paysage (Gantt + pilotage), pleine largeur.
 */

import {
  AlignmentType,
  Document,
  HeightRule,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from "docx";
import type { WorkPlan } from "../../../../shared/research/workPlan";
import {
  buildGanttColumns,
  buildGanttRows,
  formatHoursFr,
  formatShortDateFr,
  formatWeekSpan,
  formatWeeksApprox,
  periodLabel,
  planDayToCol,
  shortPhaseTitle,
  todayPlanDay,
} from "../../../../shared/research/planDisplay";
import {
  contentWidthDx,
  DOC_CAUTION,
  DOC_COLORS,
  DOC_MARGINS,
  DOC_PAGE,
  DOC_SIZES,
  docBullet,
  docHeading,
  landscapePageSizeAttrs,
  monthSepBorder,
  noBorder,
  runCalibri,
  sectionChrome,
  thinBorder,
  widthsFromPercents,
} from "../docxTheme";

export const WP_BRAND = DOC_COLORS.brand;
export const WP_PROGRESS = DOC_COLORS.progress;
export { DOC_CAUTION as WP_CAUTION };

export {
  docHeading as wpHeading,
  docBullet as wpBullet,
  docTitle as wpTitle,
  docBody as wpBody,
  docItalic as wpItalic,
} from "../docxTheme";

export {
  docHeader as workPlanDocHeader,
  docFooter as workPlanDocFooter,
} from "../docxTheme";

const TABLE_W = contentWidthDx("landscape", DOC_MARGINS.compact);
/** Padding serré dans les cellules Gantt (plancher 80 DXA). */
const GANTT_PAD = { before: 80, after: 80 } as const;
/** Bordure droite épaisse — colonne Fin (date de rendu). */
const finRightBorder = {
  style: thinBorder.style,
  size: 24,
  color: DOC_COLORS.progress,
} as const;
/** Bordure gauche épaisse — colonne Aujourd’hui. */
const todayLeftBorder = {
  style: thinBorder.style,
  size: 24,
  color: DOC_COLORS.ink,
} as const;

function endPeriodColIndex(
  columns: { dayStart: number; dayEnd: number }[],
  totalDays: number,
): number {
  const hit = columns.findIndex(
    (c) => c.dayStart <= totalDays && c.dayEnd >= totalDays,
  );
  return hit >= 0 ? hit : Math.max(0, columns.length - 1);
}

/** Hauteur de ligne Gantt (twips) : 0,7 cm–1,35 cm — pour tenir sur 1 page paysage. */
function ganttRowHeightTwip(phaseCount: number): number {
  const pageH = DOC_PAGE.landscape.height;
  const margins = DOC_MARGINS.compact.top + DOC_MARGINS.compact.bottom;
  const chromeApprox = 1000; // en-tête + pied
  const bannerApprox = 2100; // section + métriques + légende
  const headerRow = 320;
  const available = Math.max(
    1600,
    pageH - margins - chromeApprox - bannerApprox - headerRow,
  );
  const per = Math.floor(available / Math.max(1, phaseCount));
  const min = 397; // 0,7 cm
  const max = 765; // 1,35 cm
  return Math.max(min, Math.min(max, per));
}

function metricsBanner(plan: WorkPlan) {
  const widths = widthsFromPercents([25, 25, 25, 25], TABLE_W);
  const cell = (value: string, label: string, hint: string, width: number) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      verticalAlign: VerticalAlignTable.CENTER,
      borders: {
        top: thinBorder,
        bottom: thinBorder,
        left: thinBorder,
        right: thinBorder,
      },
      shading: {
        type: ShadingType.CLEAR,
        fill: DOC_COLORS.softBlue,
        color: DOC_COLORS.softBlue,
      },
      children: [
        new Paragraph({
          spacing: { before: 100, after: 20 },
          alignment: AlignmentType.CENTER,
          children: [
            runCalibri(value, {
              bold: true,
              size: DOC_SIZES.metricValue,
              color: DOC_COLORS.brand,
            }),
          ],
        }),
        new Paragraph({
          spacing: { after: 10 },
          alignment: AlignmentType.CENTER,
          children: [
            runCalibri(label, {
              bold: true,
              size: DOC_SIZES.metricLabel,
            }),
          ],
        }),
        new Paragraph({
          spacing: { after: 100 },
          alignment: AlignmentType.CENTER,
          children: [
            runCalibri(hint, {
              size: DOC_SIZES.metricLabel,
              color: DOC_COLORS.slate,
            }),
          ],
        }),
      ],
    });

  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          cell(
            plan.meta.durationLabel,
            "Durée",
            formatWeeksApprox(plan.meta.totalDays),
            widths[0],
          ),
          cell(
            formatHoursFr(plan.meta.hoursPerWeek),
            "Charge par semaine",
            plan.meta.weeklyLabel,
            widths[1],
          ),
          cell(
            formatHoursFr(plan.meta.totalHours),
            "Heures totales",
            "Estimation indicative",
            widths[2],
          ),
          cell(
            formatShortDateFr(plan.meta.endDate),
            "Date de rendu",
            `Début ${formatShortDateFr(plan.meta.startDate)}`,
            widths[3],
          ),
        ],
      }),
    ],
  });
}

function periodHeaderLabel(
  label: string,
  isToday: boolean,
  isFin: boolean,
): string {
  if (isToday && isFin) return `${label} · Auj. · Fin`;
  if (isToday) return `${label} · Auj.`;
  if (isFin) return `${label} · Fin`;
  return label;
}

function ganttTable(plan: WorkPlan) {
  const { columns } = buildGanttColumns(plan);
  const rows = buildGanttRows(plan, columns);
  const n = Math.max(1, columns.length);
  const periodShare = (100 - 22 - 10) / n;
  const percents = [22, ...Array.from({ length: n }, () => periodShare), 10];
  const widths = widthsFromPercents(percents, TABLE_W);
  const rowH = ganttRowHeightTwip(rows.length);
  const finCol = endPeriodColIndex(columns, plan.meta.totalDays);
  const todayDay = todayPlanDay(plan);
  const todayCol =
    todayDay == null ? null : planDayToCol(todayDay, columns);

  const headerCells = [
    new TableCell({
      width: { size: widths[0], type: WidthType.DXA },
      verticalAlign: VerticalAlignTable.CENTER,
      shading: {
        type: ShadingType.CLEAR,
        fill: DOC_COLORS.brand,
        color: DOC_COLORS.brand,
      },
      borders: {
        top: thinBorder,
        bottom: thinBorder,
        left: thinBorder,
        right: thinBorder,
      },
      children: [
        new Paragraph({
          spacing: GANTT_PAD,
          children: [
            runCalibri("Phase", {
              bold: true,
              size: DOC_SIZES.tableHeader,
              color: DOC_COLORS.white,
            }),
          ],
        }),
      ],
    }),
    ...columns.map((c, i) => {
      const isFin = i === finCol;
      const isToday = todayCol === i;
      return new TableCell({
        width: { size: widths[i + 1], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: {
          type: ShadingType.CLEAR,
          fill: DOC_COLORS.brand,
          color: DOC_COLORS.brand,
        },
        borders: {
          top: thinBorder,
          bottom: thinBorder,
          left: isToday ? todayLeftBorder : thinBorder,
          right: isFin ? finRightBorder : monthSepBorder,
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: GANTT_PAD,
            children: [
              runCalibri(periodHeaderLabel(c.label, isToday, isFin), {
                bold: true,
                size: DOC_SIZES.tableHeader,
                color: DOC_COLORS.white,
              }),
            ],
          }),
        ],
      });
    }),
    new TableCell({
      width: { size: widths[widths.length - 1], type: WidthType.DXA },
      verticalAlign: VerticalAlignTable.CENTER,
      shading: {
        type: ShadingType.CLEAR,
        fill: DOC_COLORS.brand,
        color: DOC_COLORS.brand,
      },
      borders: {
        top: thinBorder,
        bottom: thinBorder,
        left: thinBorder,
        right: thinBorder,
      },
      children: [
        new Paragraph({
          spacing: GANTT_PAD,
          alignment: AlignmentType.CENTER,
          children: [
            runCalibri("Avancement", {
              bold: true,
              size: DOC_SIZES.tableHeader,
              color: DOC_COLORS.white,
            }),
          ],
        }),
      ],
    }),
  ];

  const bodyRows = rows.map((row) => {
    const fill =
      row.phase.role === "revision" ? DOC_COLORS.progress : DOC_COLORS.brand;
    const periodCells = columns.map((_col, ci) => {
      const active = ci >= row.colStart && ci <= row.colEnd;
      const diamond = active && ci === row.checkpointCol;
      const isFin = ci === finCol;
      const isToday = todayCol === ci;
      const diamondColor =
        fill === DOC_COLORS.progress ? DOC_COLORS.ink : DOC_COLORS.white;
      return new TableCell({
        width: { size: widths[ci + 1], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: active
          ? { type: ShadingType.CLEAR, fill, color: fill }
          : undefined,
        borders: {
          top: thinBorder,
          bottom: thinBorder,
          left: isToday ? todayLeftBorder : thinBorder,
          right: isFin ? finRightBorder : monthSepBorder,
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: GANTT_PAD,
            children: diamond
              ? [
                  new TextRun({
                    text: "◆",
                    font: "Calibri",
                    size: DOC_SIZES.table,
                    color: diamondColor,
                  }),
                ]
              : [runCalibri(" ", { size: DOC_SIZES.table })],
          }),
        ],
      });
    });

    return new TableRow({
      height: { value: rowH, rule: HeightRule.ATLEAST },
      children: [
        new TableCell({
          width: { size: widths[0], type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          borders: {
            top: thinBorder,
            bottom: thinBorder,
            left: thinBorder,
            right: thinBorder,
          },
          children: [
            new Paragraph({
              spacing: GANTT_PAD,
              children: [
                runCalibri(
                  `${row.phase.index + 1}. ${shortPhaseTitle(row.shortTitle, 40)}`,
                  { size: DOC_SIZES.table },
                ),
              ],
            }),
          ],
        }),
        ...periodCells,
        new TableCell({
          width: { size: widths[widths.length - 1], type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          borders: {
            top: thinBorder,
            bottom: thinBorder,
            left: thinBorder,
            right: thinBorder,
          },
          children: [
            new Paragraph({
              spacing: GANTT_PAD,
              alignment: AlignmentType.CENTER,
              children: [
                runCalibri(`${row.progressPct} %`, {
                  bold: true,
                  size: DOC_SIZES.progress,
                  color: DOC_COLORS.brand,
                }),
              ],
            }),
          ],
        }),
      ],
    });
  });

  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA },
    rows: [new TableRow({ children: headerCells }), ...bodyRows],
  });
}

function legendParagraph() {
  return new Paragraph({
    spacing: { before: 60, after: 40 },
    children: [
      runCalibri("■ ", {
        color: DOC_COLORS.brand,
        size: DOC_SIZES.legend,
      }),
      runCalibri("Rédaction   ", { size: DOC_SIZES.legend }),
      runCalibri("■ ", {
        color: DOC_COLORS.progress,
        size: DOC_SIZES.legend,
      }),
      runCalibri("Relecture   ", { size: DOC_SIZES.legend }),
      runCalibri("◆ ", {
        color: DOC_COLORS.brand,
        size: DOC_SIZES.legend,
      }),
      runCalibri("Point d’encadrement   ", { size: DOC_SIZES.legend }),
      runCalibri("│ ", {
        color: DOC_COLORS.ink,
        size: DOC_SIZES.legend,
      }),
      runCalibri("Aujourd’hui   ", {
        size: DOC_SIZES.legend,
        color: DOC_COLORS.ink,
      }),
      runCalibri("│ ", {
        color: DOC_COLORS.progressInk,
        size: DOC_SIZES.legend,
      }),
      runCalibri("Fin (date de rendu)", {
        size: DOC_SIZES.legend,
        color: DOC_COLORS.progressInk,
      }),
    ],
  });
}

function pilotageTable(plan: WorkPlan) {
  const percents = [17, 16, 23, 17, 19, 8];
  const widths = widthsFromPercents(percents, TABLE_W);
  const headers = [
    "Phase",
    "Période",
    "Objectif",
    "Livrable",
    "Point d’encadrement",
    "Charge",
  ];

  const headerRow = new TableRow({
    children: headers.map(
      (h, i) =>
        new TableCell({
          width: { size: widths[i], type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          shading: {
            type: ShadingType.CLEAR,
            fill: DOC_COLORS.brand,
            color: DOC_COLORS.brand,
          },
          borders: {
            top: thinBorder,
            bottom: thinBorder,
            left: thinBorder,
            right: thinBorder,
          },
          children: [
            new Paragraph({
              spacing: { before: 80, after: 80 },
              children: [
                runCalibri(h, {
                  bold: true,
                  size: DOC_SIZES.tableHeader,
                  color: DOC_COLORS.white,
                }),
              ],
            }),
          ],
        }),
    ),
  });

  const bodyRows = plan.phases.map((p, ri) => {
    const zebra = ri % 2 === 1;
    const shade = zebra
      ? {
          type: ShadingType.CLEAR,
          fill: DOC_COLORS.softBlue,
          color: DOC_COLORS.softBlue,
        }
      : undefined;
    const cell = (children: Paragraph[], width: number) =>
      new TableCell({
        width: { size: width, type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: shade,
        borders: {
          top: thinBorder,
          bottom: thinBorder,
          left: thinBorder,
          right: thinBorder,
        },
        children,
      });
    const textCell = (text: string, width: number) =>
      cell(
        [
          new Paragraph({
            spacing: { before: 80, after: 80 },
            children: [runCalibri(text || "—", { size: DOC_SIZES.table })],
          }),
        ],
        width,
      );

    return new TableRow({
      children: [
        textCell(
          `${p.index + 1}. ${shortPhaseTitle(p.title, 40)}`,
          widths[0],
        ),
        cell(
          [
            new Paragraph({
              spacing: { before: 80, after: 20 },
              children: [
                runCalibri(periodLabel(p), { size: DOC_SIZES.table }),
              ],
            }),
            new Paragraph({
              spacing: { after: 80 },
              children: [
                runCalibri(formatWeekSpan(p.weekStart, p.weekEnd), {
                  size: DOC_SIZES.hint,
                  color: DOC_COLORS.slate,
                }),
              ],
            }),
          ],
          widths[1],
        ),
        textCell(p.objective, widths[2]),
        textCell(p.deliverable, widths[3]),
        textCell(p.checkpoint, widths[4]),
        textCell(formatHoursFr(p.hours), widths[5]),
      ],
    });
  });

  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA },
    rows: [headerRow, ...bodyRows],
  });
}

export function planningIntroLine(durationLabel: string): string {
  return `Diagramme indicatif pour ${durationLabel}, à ajuster avec votre encadrement.`;
}

export function planningSubtitle(input: {
  projectTitle?: string;
  typeLabel?: string;
  generatedAt?: string;
}): string {
  const dateIso = (input.generatedAt || new Date().toISOString()).slice(0, 10);
  const date = formatShortDateFr(dateIso);
  return [
    (input.projectTitle || "").trim() || "Projet",
    (input.typeLabel || "").trim() || "Document",
    `Généré le ${date}`,
  ].join(" · ");
}

/** Contenu page 1 : titre → chiffres clés → Gantt → légende. */
export function buildWorkPlanGanttChildren(
  plan: WorkPlan,
  _opts?: { title?: string; lead?: string; subtitle?: string },
): (Paragraph | Table)[] {
  return [
    docHeading("Diagramme de progression", 0),
    metricsBanner(plan),
    new Paragraph({ spacing: { after: 40 }, children: [] }),
    ganttTable(plan),
    legendParagraph(),
  ];
}

/** Contenu page 2 (pilotage). */
export function buildWorkPlanPilotageChildren(
  plan: WorkPlan,
): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [
    docHeading("Tableau de pilotage", 40),
    pilotageTable(plan),
  ];
  if (plan.rhythm.length) {
    children.push(docHeading("Rythme conseillé", 120));
    for (const line of plan.rhythm.slice(0, 3)) children.push(docBullet(line));
  }
  if (plan.warnings.length) {
    children.push(docHeading("Points d’attention", 100));
    for (const w of plan.warnings) children.push(docBullet(w));
  }
  return children;
}

export function buildWorkPlanContent(
  plan: WorkPlan,
  opts?: { title?: string; lead?: string; subtitle?: string },
): (Paragraph | Table)[] {
  return [
    ...buildWorkPlanGanttChildren(plan, opts),
    ...buildWorkPlanPilotageChildren(plan),
  ];
}

export function isUsableWorkPlan(value: unknown): value is WorkPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as WorkPlan;
  return Boolean(plan.meta && Array.isArray(plan.phases) && plan.phases.length);
}

function landscapeSection(
  children: (Paragraph | Table)[],
  projectTitle?: string,
) {
  return {
    properties: {
      page: {
        // docx inverse w↔h si orient=landscape : passer dims portrait
        // pour obtenir w:w="16838" w:h="11906" dans le XML.
        size: landscapePageSizeAttrs(),
        margin: DOC_MARGINS.compact,
      },
    },
    ...sectionChrome(projectTitle),
    children,
  };
}

/** Document Word compact : 2 sections paysage (Gantt puis pilotage). */
export async function buildWorkPlanDocument(input: {
  plan: WorkPlan;
  projectTitle?: string;
  documentLabel?: string;
  title?: string;
  lead?: string;
  generatedAt?: string;
  filenameBase?: string;
}): Promise<{ filename: string; mimeType: string; buffer: Buffer }> {
  const document = new Document({
    sections: [
      landscapeSection(
        buildWorkPlanGanttChildren(input.plan),
        input.projectTitle,
      ),
      landscapeSection(
        buildWorkPlanPilotageChildren(input.plan),
        input.projectTitle,
      ),
    ],
  });

  const buffer = Buffer.from(await Packer.toBuffer(document));
  const safe = `${input.filenameBase || input.title || "feuille-de-route"}-${
    input.projectTitle || "manuscrit"
  }`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);

  return {
    filename: `${safe || "feuille-de-route"}.docx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
  };
}
