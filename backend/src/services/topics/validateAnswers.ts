import { z } from "zod";
import {
  normalizeTopicAnswers,
  topicQuestions,
} from "../../../../shared/research/topicQuestions";
import {
  isQuestionVisible,
  SKIP_VALUE,
  type TopicConsents,
} from "../../../../shared/research/topicTypes";
import { NOTICE_VERSION } from "../../../../shared/research/notice";

const consentRecord = z.object({
  value: z.boolean(),
  at: z.string().datetime(),
  noticeVersion: z.literal(NOTICE_VERSION),
});

export const consentsSchema = z.object({
  ageOver15: consentRecord,
  noticeAccepted: consentRecord,
  retainProfile: consentRecord,
  serviceImprovement: consentRecord,
});

function assertRequiredBlock1(answers: Record<string, unknown>) {
  for (const q of topicQuestions) {
    if (q.block !== 1 || !q.required) continue;
    if (!isQuestionVisible(q, answers)) continue;
    const v = answers[q.id];
    if (v === undefined || v === null || v === "" || v === SKIP_VALUE)
      throw Object.assign(
        new Error("Le bloc 1 est obligatoire : complétez « " + q.label + " »."),
        { status: 422 },
      );
  }
}

/** Loose shape check: known question ids, length limits for strings. */
export function validateAnswersPayload(
  answers: unknown,
): Record<string, unknown> {
  if (!answers || typeof answers !== "object" || Array.isArray(answers))
    throw Object.assign(new Error("Réponses invalides."), { status: 400 });
  const raw = normalizeTopicAnswers(answers as Record<string, unknown>);
  const known = new Set(topicQuestions.map((q) => q.id));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key)) continue;
    const q = topicQuestions.find((x) => x.id === key)!;
    if (typeof value === "string") {
      const max = q.maxLength ?? 300;
      if (value.length > max)
        throw Object.assign(
          new Error("Texte trop long pour « " + q.label + " »."),
          { status: 422 },
        );
      out[key] = value;
      continue;
    }
    out[key] = value;
  }
  assertRequiredBlock1(out);
  return out;
}

export function validateConsents(input: unknown): TopicConsents {
  const consents = consentsSchema.parse(input);
  if (!consents.ageOver15.value)
    throw Object.assign(
      new Error(
        "Le parcours est réservé aux personnes de 15 ans ou plus (art. 45 loi Informatique et Libertés).",
      ),
      { status: 403 },
    );
  if (!consents.noticeAccepted.value)
    throw Object.assign(
      new Error("Veuillez prendre connaissance de la notice d’information."),
      { status: 400 },
    );
  return consents;
}
