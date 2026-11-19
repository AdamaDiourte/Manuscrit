/**
 * Conventions d’affichage partagées (écran + Word) pour le planning compact.
 */

import type { WorkPlan, WorkPlanPhase } from "./workPlan";

export type GanttGranularity = "week" | "month" | "quarter";

export type GanttColumn = {
  index: number;
  label: string;
  dayStart: number;
  dayEnd: number;
};

export type GanttRow = {
  phase: WorkPlanPhase;
  shortTitle: string;
  /** Indices de colonnes couvertes (inclusifs). */
  colStart: number;
  colEnd: number;
  /** Colonne du point d’encadrement (losange). */
  checkpointCol: number;
  /** Pourcentage cumulé à la fin de la phase. */
  progressPct: number;
};

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MONTHS_SHORT = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

/** Date courte FR : « 19 nov. 2026 ». */
export function formatShortDateFr(iso: string): string {
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getUTCDate();
  const month = MONTHS_SHORT[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

/** Heures arrondies à la demi-heure : « 3 h », « 2 h 30 ». */
export function formatHoursFr(hours: number): string {
  const rounded = Math.round(hours * 2) / 2;
  const whole = Math.floor(rounded);
  const half = rounded - whole >= 0.5;
  if (half) return `${whole} h 30`;
  return `${whole} h`;
}

/** Semaines entières approximatives : « ≈ 6 semaines ». */
export function formatWeeksApprox(totalDays: number): string {
  const weeks = Math.max(1, Math.round(totalDays / 7));
  return weeks === 1 ? "≈ 1 semaine" : `≈ ${weeks} semaines`;
}

/** « semaine 3 » ou « semaines 3–5 ». */
export function formatWeekSpan(weekStart: number, weekEnd: number): string {
  if (weekStart === weekEnd) return `semaine ${weekStart}`;
  return `semaines ${weekStart}–${weekEnd}`;
}

export function shortPhaseTitle(title: string, max = 40): string {
  const t = String(title || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Une seule phrase, ponctuée, longueur bornée. */
export function clampSentence(text: string, maxChars: number): string {
  let t = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?…]+$/u, "");
  if (!t) return "";
  if (t.length > maxChars) {
    const cut = t.slice(0, maxChars);
    const breakAt = Math.max(
      cut.lastIndexOf(" "),
      cut.lastIndexOf(","),
      Math.floor(maxChars * 0.7),
    );
    t = cut.slice(0, breakAt).trimEnd();
  }
  return `${t}.`;
}

export function clampWords(text: string, maxWords: number): string {
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?…]+$/u, "")
    .split(" ")
    .filter(Boolean);
  const sliced = words.slice(0, maxWords).join(" ");
  if (!sliced) return "";
  return `${sliced}.`;
}

function dayToCol(day: number, columns: GanttColumn[]): number {
  for (let i = 0; i < columns.length; i += 1) {
    if (day >= columns[i].dayStart && day <= columns[i].dayEnd) return i;
  }
  if (day < columns[0].dayStart) return 0;
  return columns.length - 1;
}

/**
 * Granularité auto pour ≤ 16 colonnes :
 * ≤ 16 semaines → semaines ; ≤ 16 mois → mois ; sinon trimestres.
 */
export function buildGanttColumns(plan: WorkPlan): {
  granularity: GanttGranularity;
  columns: GanttColumn[];
} {
  const totalDays = Math.max(1, plan.meta.totalDays);
  const weeks = totalDays / 7;
  const months = totalDays / 30.44;

  if (weeks <= 16) {
    const n = Math.min(16, Math.max(1, Math.ceil(weeks)));
    const span = totalDays / n;
    const columns: GanttColumn[] = [];
    for (let i = 0; i < n; i += 1) {
      const dayStart = Math.floor(i * span) + 1;
      const dayEnd = i === n - 1 ? totalDays : Math.floor((i + 1) * span);
      columns.push({
        index: i,
        label: `S${i + 1}`,
        dayStart,
        dayEnd: Math.max(dayStart, dayEnd),
      });
    }
    return { granularity: "week", columns };
  }

  if (months <= 16) {
    const start = parseISO(plan.meta.startDate);
    const end = parseISO(plan.meta.endDate);
    const columns: GanttColumn[] = [];
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth();
    while (columns.length < 16) {
      const colStartDate = new Date(Date.UTC(y, m, 1));
      const next = new Date(Date.UTC(y, m + 1, 1));
      const dayStart = Math.max(
        1,
        Math.floor((colStartDate.getTime() - start.getTime()) / 86_400_000) + 1,
      );
      const dayEnd = Math.min(
        totalDays,
        Math.floor((next.getTime() - 1 - start.getTime()) / 86_400_000) + 1,
      );
      if (dayEnd >= 1 && dayStart <= totalDays) {
        columns.push({
          index: columns.length,
          label: MONTHS_SHORT[m],
          dayStart: Math.max(1, dayStart),
          dayEnd: Math.max(1, dayEnd),
        });
      }
      if (colStartDate > end && columns.length) break;
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      if (dayStart > totalDays) break;
    }
    if (!columns.length) {
      columns.push({
        index: 0,
        label: MONTHS_SHORT[start.getUTCMonth()],
        dayStart: 1,
        dayEnd: totalDays,
      });
    }
    return { granularity: "month", columns };
  }

  // Trimestres
  const start = parseISO(plan.meta.startDate);
  const columns: GanttColumn[] = [];
  let cursor = 1;
  let y = start.getUTCFullYear();
  let q = Math.floor(start.getUTCMonth() / 3);
  while (cursor <= totalDays && columns.length < 16) {
    const qStartMonth = q * 3;
    const qStart = new Date(Date.UTC(y, qStartMonth, 1));
    const qEnd = new Date(Date.UTC(y, qStartMonth + 3, 0));
    const dayStart = Math.max(
      1,
      Math.floor((qStart.getTime() - start.getTime()) / 86_400_000) + 1,
    );
    const dayEnd = Math.min(
      totalDays,
      Math.floor((qEnd.getTime() - start.getTime()) / 86_400_000) + 1,
    );
    if (dayEnd >= cursor) {
      columns.push({
        index: columns.length,
        label: `T${q + 1} ${y}`,
        dayStart: Math.max(cursor, dayStart),
        dayEnd: Math.max(cursor, dayEnd),
      });
      cursor = columns[columns.length - 1].dayEnd + 1;
    }
    q += 1;
    if (q > 3) {
      q = 0;
      y += 1;
    }
  }
  if (!columns.length) {
    columns.push({
      index: 0,
      label: `T1 ${start.getUTCFullYear()}`,
      dayStart: 1,
      dayEnd: totalDays,
    });
  }
  return { granularity: "quarter", columns };
}

export function buildGanttRows(
  plan: WorkPlan,
  columns: GanttColumn[],
): GanttRow[] {
  let cumulative = 0;
  return plan.phases.map((phase) => {
    cumulative += phase.sharePct;
    const colStart = dayToCol(phase.dayStart, columns);
    const colEnd = dayToCol(phase.dayEnd, columns);
    const checkpointCol = colEnd;
    return {
      phase,
      shortTitle: shortPhaseTitle(phase.title, 40),
      colStart,
      colEnd: Math.max(colStart, colEnd),
      checkpointCol,
      progressPct: Math.min(100, cumulative),
    };
  });
}

function todayUtcMs(): number {
  return Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
}

/** Jour 1-based du planning pour « aujourd’hui », ou null si hors plage. */
export function todayPlanDay(plan: WorkPlan): number | null {
  const start = parseISO(plan.meta.startDate).getTime();
  const end = parseISO(plan.meta.endDate).getTime();
  const today = todayUtcMs();
  if (today < start || today > end) return null;
  return Math.floor((today - start) / 86_400_000) + 1;
}

/** Position % du repère « aujourd’hui » sur la frise / Gantt (null si hors plage). */
export function todayMarkerPct(plan: WorkPlan): number | null {
  const start = parseISO(plan.meta.startDate).getTime();
  const end = parseISO(plan.meta.endDate).getTime();
  const today = todayUtcMs();
  if (today < start || today > end) return null;
  return ((today - start) / Math.max(1, end - start)) * 100;
}

/** Index de colonne Gantt contenant un jour 1-based. */
export function planDayToCol(day: number, columns: GanttColumn[]): number {
  return dayToCol(day, columns);
}

export function periodLabel(phase: WorkPlanPhase): string {
  return `${formatShortDateFr(phase.startDate)} → ${formatShortDateFr(phase.endDate)}`;
}

/** Réexport utile pour libellés de période hors phase. */
export { addDays };
