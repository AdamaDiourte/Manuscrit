import { topicQuestions } from "./topicQuestions";
import { SKIP_VALUE } from "./topicTypes";

export type CompletenessLevel = "low" | "medium" | "high";

/** Champs qui améliorent le plus la personnalisation des sujets. */
export const COMPLETENESS_FIELDS = [
  "specialty",
  "imposed_theme",
  "lab_themes",
  "interest_objects",
  "favorite_courses",
  "inspiring_concept",
  "past_works",
  "continue_or_avoid_detail",
  "methods_skills",
  "method_to_learn",
  "field_access",
] as const;

export type CompletenessFieldId = (typeof COMPLETENESS_FIELDS)[number];

function isFilled(value: unknown): boolean {
  if (value === undefined || value === null || value === "" || value === SKIP_VALUE)
    return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export type ProfileCompleteness = {
  level: CompletenessLevel;
  score: number;
  missing: { id: CompletenessFieldId; label: string }[];
};

export function computeProfileCompleteness(
  answers: Record<string, unknown>,
): ProfileCompleteness {
  const missing: { id: CompletenessFieldId; label: string }[] = [];
  let filled = 0;
  for (const id of COMPLETENESS_FIELDS) {
    const q = topicQuestions.find((x) => x.id === id);
    const label = q?.label ?? id;
    if (isFilled(answers[id])) filled += 1;
    else missing.push({ id, label });
  }
  const score = filled / COMPLETENESS_FIELDS.length;
  const level: CompletenessLevel =
    score < 0.34 ? "low" : score < 0.67 ? "medium" : "high";
  return { level, score, missing };
}
