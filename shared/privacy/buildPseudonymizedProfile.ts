import { topicQuestions } from "../research/topicQuestions";
import { SKIP_VALUE } from "../research/topicTypes";
import { containsContactLeak, filterFreeText } from "./sensitiveFilter";

/** Whitelist of answer keys allowed in the LLM payload (never spread the user object). */
export const LLM_FIELD_WHITELIST = new Set(
  topicQuestions.filter((q) => q.sentToLLM).map((q) => q.id),
);

const FORBIDDEN_KEYS = new Set([
  "id",
  "userId",
  "uid",
  "email",
  "name",
  "nom",
  "prenom",
  "ip",
  "session",
  "sessionId",
  "establishment",
  "etablissement",
  "university",
  "universite",
]);

type AxisBucket = "M" | "A" | "D" | "F";

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value === SKIP_VALUE) return undefined;
    return filterFreeText(value).text;
  }
  if (Array.isArray(value)) {
    return value
      .map(scrubValue)
      .filter((v) => v !== undefined && v !== "" && v !== SKIP_VALUE);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      const next = scrubValue(v);
      if (next !== undefined && next !== "") out[k] = next;
    }
    return out;
  }
  return value;
}

/**
 * Builds the object sent to the LLM from a whitelist of fields only.
 * Free-text values are masked; identifiers and non-whitelisted keys are dropped.
 */
export function buildPseudonymizedProfile(
  answers: Record<string, unknown>,
): {
  axes: Record<AxisBucket, Record<string, unknown>>;
  fields: Record<string, unknown>;
} {
  const fields: Record<string, unknown> = {};
  const axes: Record<AxisBucket, Record<string, unknown>> = {
    M: {},
    A: {},
    D: {},
    F: {},
  };

  for (const question of topicQuestions) {
    if (!question.sentToLLM) continue;
    if (!LLM_FIELD_WHITELIST.has(question.id)) continue;
    if (!(question.id in answers)) continue;
    const raw = answers[question.id];
    if (raw === undefined || raw === null || raw === "" || raw === SKIP_VALUE)
      continue;
    let cleaned = scrubValue(raw);
    if (
      cleaned === undefined ||
      cleaned === "" ||
      (Array.isArray(cleaned) && !cleaned.length) ||
      (typeof cleaned === "object" &&
        cleaned !== null &&
        !Array.isArray(cleaned) &&
        !Object.keys(cleaned).length)
    )
      continue;
    // Prefer "aucune" over numeric 0 so the model does not misread the scale.
    if (
      question.type === "multi_scale" &&
      cleaned &&
      typeof cleaned === "object" &&
      !Array.isArray(cleaned)
    ) {
      cleaned = Object.fromEntries(
        Object.entries(cleaned as Record<string, unknown>).map(([k, v]) => [
          k,
          v === 0 ? "aucune" : v,
        ]),
      );
    }
    fields[question.id] = cleaned;
    const w = question.weights;
    for (const axis of ["M", "A", "D", "F"] as AxisBucket[]) {
      if (w[axis] > 0) axes[axis][question.id] = cleaned;
    }
  }

  if (containsContactLeak(fields)) {
    throw new Error(
      "Des coordonnées personnelles ont été détectées. Retirez-les avant d’envoyer.",
    );
  }

  return { axes, fields };
}
