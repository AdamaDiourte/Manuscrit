import {
  topicQuestions,
  SKIP_LABEL,
} from "../../../../shared/research/topicQuestions";
import { SKIP_VALUE } from "../../../../shared/research/topicTypes";

function optionLabel(questionId: string, value: string) {
  const q = topicQuestions.find((x) => x.id === questionId);
  return q?.options?.find((o) => o.value === value)?.label || value;
}

/** Human-readable summary of one answer for the review screen. */
export function formatAnswer(questionId: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (value === SKIP_VALUE) return SKIP_LABEL;

  const q = topicQuestions.find((x) => x.id === questionId);
  if (!q) return String(value);

  if (q.type === "single" && typeof value === "string")
    return optionLabel(questionId, value);

  if (q.type === "multi" && Array.isArray(value))
    return value.map((v) => optionLabel(questionId, String(v))).join(", ");

  if (q.type === "multi_scale" && value && typeof value === "object") {
    return Object.entries(value as Record<string, number>)
      .map(([k, n]) => {
        const level = n === 0 ? "aucune" : String(n);
        return optionLabel(questionId, k) + " : " + level;
      })
      .join(", ");
  }

  if (q.type === "repeatable_group" && Array.isArray(value)) {
    return value
      .map((row, i) => {
        const parts = (q.fields || []).map((f) => {
          const raw = (row as Record<string, string>)[f.id];
          if (!raw) return null;
          const label =
            f.type === "single"
              ? f.options?.find((o) => o.value === raw)?.label || raw
              : raw;
          return f.label + " : " + label;
        });
        return "Travail " + (i + 1) + " — " + parts.filter(Boolean).join(" · ");
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
