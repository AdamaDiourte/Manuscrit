export type AxisWeight = { M: number; A: number; D: number; F: number };

export type Condition = {
  field: string;
  equals?: string | string[];
  notEquals?: string | string[];
};

export type QuestionOption = { value: string; label: string };

/** Optional visual grouping for single/multi choice lists (stacked sections). */
export type QuestionOptionGroup = {
  label: string;
  options: QuestionOption[];
};

export type QuestionType =
  | "single"
  | "multi"
  | "text_short"
  | "scale"
  | "bipolar_slider"
  | "repeatable_group"
  | "multi_scale";

export type Question = {
  id: string;
  block: number;
  label: string;
  help?: string;
  type: QuestionType;
  options?: QuestionOption[];
  /** When set, render options in stacked labeled groups (still mirrored in `options`). */
  optionGroups?: QuestionOptionGroup[];
  /** Sub-fields for repeatable_group */
  fields?: {
    id: string;
    label: string;
    type: "single" | "text_short" | "scale";
    options?: QuestionOption[];
    maxLength?: number;
  }[];
  required: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  /**
   * Human-readable labels for multi_scale values from min to max (inclusive).
   * Index 0 corresponds to `min`. Prefer words over bare numbers for the LLM.
   */
  scaleLabels?: string[];
  showIf?: Condition;
  weights: AxisWeight;
  sensitiveRisk: "none" | "low" | "medium";
  sentToLLM: boolean;
  /** Prefer-not-to-answer option for optional questions */
  allowSkip?: boolean;
};

export type ConsentRecord = {
  value: boolean;
  at: string;
  noticeVersion: string;
};

export type TopicConsents = {
  ageOver15: ConsentRecord;
  noticeAccepted: ConsentRecord;
  retainProfile: ConsentRecord;
  serviceImprovement: ConsentRecord;
};

export type TopicAxis = "mastery" | "ambition" | "discovery";

export type GeneratedTopic = {
  axis: TopicAxis;
  title: string;
  /** Brève mise en contexte (actualité, histoire, débat…) avant la question. */
  context: string;
  research_question: string;
  hypotheses: string[];
  field_or_corpus: string;
  method: string;
  feasibility: {
    level: "high" | "medium" | "low";
    risks: string[];
    first_steps: string[];
  };
  rationale: string;
  keywords_fr: string[];
  keywords_en: string[];
  ethical_notes: string | null;
};

export type TopicsOutput = { topics: GeneratedTopic[] };

export type RegenReason =
  | "too_far"
  | "too_ambitious"
  | "too_banal"
  | "already_done";

export const REGEN_REASON_LABELS: Record<RegenReason, string> = {
  too_far: "Trop éloigné de mon profil",
  too_ambitious: "Trop ambitieux",
  too_banal: "Trop banal",
  already_done: "Sujet déjà traité",
};

export type { DocumentKind } from "./documentStructures";
import type { DocumentKind as DocKind } from "./documentStructures";

export type DocumentTable = {
  headers: string[];
  rows: string[][];
};

export type DocumentSection = {
  id: string;
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  /** Tableau de route (surtout pour le plan de travail). */
  table?: DocumentTable;
  /** Rôle de phase (planning) — optionnel, absent des documents déjà générés. */
  role?: import("./workPlan").PhaseRole;
};

export type TopicDocument = {
  kind: DocKind;
  projectType: string;
  title: string;
  subtitle?: string;
  sections: DocumentSection[];
  /** Planning unifié — optionnel (documents déjà générés sans ce champ). */
  workPlan?: import("./workPlan").WorkPlan | null;
};

export const SKIP_VALUE = "__skip__";

export function isQuestionVisible(
  question: Question,
  answers: Record<string, unknown>,
): boolean {
  const cond = question.showIf;
  if (!cond) return true;
  const raw = answers[cond.field];
  const value = Array.isArray(raw) ? raw : raw;
  if (cond.equals !== undefined) {
    const expected = Array.isArray(cond.equals) ? cond.equals : [cond.equals];
    if (Array.isArray(value))
      return value.some((v) => expected.includes(String(v)));
    return expected.includes(String(value ?? ""));
  }
  if (cond.notEquals !== undefined) {
    const banned = Array.isArray(cond.notEquals)
      ? cond.notEquals
      : [cond.notEquals];
    if (Array.isArray(value))
      return !value.some((v) => banned.includes(String(v)));
    return !banned.includes(String(value ?? ""));
  }
  return true;
}
