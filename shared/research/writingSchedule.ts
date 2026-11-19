/**
 * Planning de rédaction calé sur le temps disponible et les sections du plan.
 * Adaptation de `buildWorkPlan` vers l’ancienne forme `{ totalDays, label, items }`.
 */

import {
  buildWorkPlan,
  type PhaseRole,
  type WorkPlan,
  type WorkPlanSectionInput,
} from "./workPlan";

export type WritingScheduleItem = {
  title: string;
  sectionIndex?: number;
  dayStart: number;
  dayEnd: number;
  share: string;
  advice: string;
};

export type WritingSchedule = {
  totalDays: number;
  label: string;
  items: WritingScheduleItem[];
};

/** Convertit un WorkPlan vers l’ancienne forme consommée par l’UI / l’export. */
export function workPlanToWritingSchedule(
  plan: WorkPlan,
  label?: string,
): WritingSchedule {
  return {
    totalDays: plan.meta.totalDays,
    label: (label || "").trim() || plan.meta.durationLabel,
    items: plan.phases.map((phase) => ({
      title: phase.title,
      ...(phase.sectionIndex != null
        ? { sectionIndex: phase.sectionIndex }
        : {}),
      dayStart: phase.dayStart,
      dayEnd: phase.dayEnd,
      share: `${phase.sharePct} %`,
      /** Objectif de phase — sans mention des jours (évite le doublon UI). */
      advice: phase.objective,
    })),
  };
}

export function buildWritingSchedule(input: {
  writingTime?: string;
  writingTimeDays?: number;
  writingTimeLabel?: string;
  sections?: { title?: string; role?: PhaseRole; intent?: string }[];
  weeklyTime?: string;
  documentType?: string;
  documentTypeOther?: string;
  startDate?: string;
  endDate?: string;
  method?: string;
  field?: string;
  risks?: string[];
  researchQuestion?: string;
  firstSteps?: string[];
}): WritingSchedule | null {
  const sections = (input.sections || []) as WorkPlanSectionInput[];
  const plan = buildWorkPlan({
    sections,
    writingTime: input.writingTime,
    totalDays: input.writingTimeDays,
    durationLabel: input.writingTimeLabel,
    weeklyTime: input.weeklyTime,
    documentType: input.documentType,
    documentTypeOther: input.documentTypeOther,
    startDate: input.startDate,
    endDate: input.endDate,
    method: input.method,
    field: input.field,
    risks: input.risks,
    researchQuestion: input.researchQuestion,
    firstSteps: input.firstSteps,
  });
  if (!plan) return null;
  return workPlanToWritingSchedule(plan, input.writingTimeLabel);
}
