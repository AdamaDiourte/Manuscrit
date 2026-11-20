import { topicQuestions } from "../research/topicQuestions";
import { COMPLETENESS_FIELDS } from "../research/profileCompleteness";
import { SKIP_VALUE, type Question } from "../research/topicTypes";
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

function optionLabel(question: Question, value: string): string {
  return question.options?.find((o) => o.value === value)?.label || value;
}

/**
 * Transforme une valeur brute en libellé lisible pour le modèle
 * (ex. « Délai de rendu prévu : 3 à 6 mois »).
 */
export function formatProfileFieldValue(
  question: Question,
  raw: unknown,
): string | undefined {
  const cleaned = scrubValue(raw);
  if (
    cleaned === undefined ||
    cleaned === "" ||
    cleaned === SKIP_VALUE ||
    (Array.isArray(cleaned) && !cleaned.length) ||
    (typeof cleaned === "object" &&
      cleaned !== null &&
      !Array.isArray(cleaned) &&
      !Object.keys(cleaned).length)
  )
    return undefined;

  if (question.type === "single" && typeof cleaned === "string")
    return `${question.label} : ${optionLabel(question, cleaned)}`;

  if (question.type === "multi" && Array.isArray(cleaned))
    return `${question.label} : ${cleaned
      .map((v) => optionLabel(question, String(v)))
      .join(", ")}`;

  if (
    question.type === "multi_scale" &&
    cleaned &&
    typeof cleaned === "object" &&
    !Array.isArray(cleaned)
  ) {
    const min = question.min ?? 0;
    const max = question.max ?? 3;
    const parts = Object.entries(cleaned as Record<string, unknown>).map(
      ([k, v]) => {
        const n = typeof v === "number" ? v : Number(v);
        const scale =
          question.scaleLabels?.[n - min] ??
          (n === 0 ? "aucune" : String(n));
        const item = optionLabel(question, k);
        return `${item} : niveau ${n}/${max}, ${scale}`;
      },
    );
    if (!parts.length) return undefined;
    return `${question.label} : ${parts.join(" ; ")}`;
  }

  if (question.type === "repeatable_group" && Array.isArray(cleaned)) {
    const parts = cleaned.map((row, i) => {
      const fields = (question.fields || [])
        .map((f) => {
          const val = (row as Record<string, unknown>)[f.id];
          if (val === undefined || val === null || val === "") return null;
          const label =
            f.type === "single"
              ? f.options?.find((o) => o.value === String(val))?.label ||
                String(val)
              : String(val);
          return `${f.label} : ${label}`;
        })
        .filter(Boolean);
      return `Travail ${i + 1} — ${fields.join(" · ")}`;
    });
    if (!parts.length) return undefined;
    return `${question.label} : ${parts.join(" | ")}`;
  }

  if (typeof cleaned === "string")
    return `${question.label} : ${cleaned}`;

  return `${question.label} : ${JSON.stringify(cleaned)}`;
}

export type PseudonymizedProfile = {
  axes: Record<AxisBucket, Record<string, string>>;
  fields: Record<string, string>;
  /** Libellés des questions importantes laissées vides. */
  missing_fields: string[];
  /** Valeurs brutes scrubbées (pour contrôles qualité). */
  rawValues: Record<string, unknown>;
};

/**
 * Builds the object sent to the LLM from a whitelist of fields only.
 * Values are human-readable labels; identifiers and non-whitelisted keys are dropped.
 */
export function buildPseudonymizedProfile(
  answers: Record<string, unknown>,
): PseudonymizedProfile {
  const fields: Record<string, string> = {};
  const rawValues: Record<string, unknown> = {};
  const axes: Record<AxisBucket, Record<string, string>> = {
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
    const labeled = formatProfileFieldValue(question, raw);
    if (!labeled) continue;
    const scrubbed = scrubValue(raw);
    if (scrubbed !== undefined) rawValues[question.id] = scrubbed;
    fields[question.id] = labeled;
    const w = question.weights;
    for (const axis of ["M", "A", "D", "F"] as AxisBucket[]) {
      if (w[axis] > 0) axes[axis][question.id] = labeled;
    }
  }

  if (containsContactLeak(fields) || containsContactLeak(rawValues)) {
    throw new Error(
      "Des coordonnées personnelles ont été détectées. Retirez-les avant d’envoyer.",
    );
  }

  const missing_fields: string[] = [];
  for (const id of COMPLETENESS_FIELDS) {
    if (fields[id]) continue;
    const q = topicQuestions.find((x) => x.id === id);
    if (q) missing_fields.push(q.label);
  }

  return { axes, fields, missing_fields, rawValues };
}
