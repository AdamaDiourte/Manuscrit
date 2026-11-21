import type { GeneratedTopic, TopicAxis } from "../../../../shared/research/topicTypes";

/** Limites caractères — alignées JSON Schema + Zod + contrôles. */
export const TOPIC_LIMITS = {
  title: 220,
  context: 600,
  research_question: 600,
  hypotheses: 300,
  field_or_corpus: 700,
  method: 700,
  risks: 220,
  first_steps: 220,
  rationale: 400,
  pitch: 400,
  stakes: 180,
  leads: 180,
  keywords: 80,
  ethical_notes: 800,
  research_object: 500,
  expected_contribution: 400,
  comparison_or_variable: 220,
  data_source: 180,
  title_writing_language: 300,
  profile_link_field: 200,
  profile_link_value: 500,
  profile_link_use: 400,
  profile_analysis_item: 160,
} as const;

const FINAL_PUNCT_RE = /[.!?…]$/;
const SENTENCE_END_RE = /[.!?]/g;

/**
 * Coupe à la dernière fin de phrase (`.`, `?`, `!`) avant max.
 * Jamais au milieu d'un mot. Si aucune fin de phrase : null (garder le texte).
 */
export function clampAtSentence(text: string, max: number): string | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const window = t.slice(0, max);
  let lastEnd = -1;
  SENTENCE_END_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END_RE.exec(window)) !== null) {
    lastEnd = m.index;
  }
  if (lastEnd < Math.floor(max * 0.4)) return null;
  return window.slice(0, lastEnd + 1).trim();
}

export type FieldLengthHit = {
  field: string;
  length: number;
  max: number;
};

/** Champs texte scalaires / listes à contrôler pour TOO_LONG. */
export function collectOverLimitFields(topic: GeneratedTopic): FieldLengthHit[] {
  const hits: FieldLengthHit[] = [];
  const check = (field: string, value: string | null | undefined, max: number) => {
    const t = (value || "").trim();
    if (t.length > max) hits.push({ field, length: t.length, max });
  };
  check("title", topic.title, TOPIC_LIMITS.title);
  check("context", topic.context, TOPIC_LIMITS.context);
  check("research_question", topic.research_question, TOPIC_LIMITS.research_question);
  check("field_or_corpus", topic.field_or_corpus, TOPIC_LIMITS.field_or_corpus);
  check("method", topic.method, TOPIC_LIMITS.method);
  check("rationale", topic.rationale, TOPIC_LIMITS.rationale);
  check("pitch", topic.pitch, TOPIC_LIMITS.pitch);
  check("research_object", topic.research_object, TOPIC_LIMITS.research_object);
  (topic.stakes || []).forEach((s, i) =>
    check(`stakes[${i}]`, s, TOPIC_LIMITS.stakes),
  );
  (topic.leads || []).forEach((s, i) =>
    check(`leads[${i}]`, s, TOPIC_LIMITS.leads),
  );
  check(
    "expected_contribution",
    topic.expected_contribution,
    TOPIC_LIMITS.expected_contribution,
  );
  check("ethical_notes", topic.ethical_notes, TOPIC_LIMITS.ethical_notes);
  check(
    "title_writing_language",
    topic.title_writing_language,
    TOPIC_LIMITS.title_writing_language,
  );
  (topic.hypotheses || []).forEach((h, i) =>
    check(`hypotheses[${i}]`, h, TOPIC_LIMITS.hypotheses),
  );
  (topic.feasibility?.risks || []).forEach((r, i) =>
    check(`feasibility.risks[${i}]`, r, TOPIC_LIMITS.risks),
  );
  (topic.feasibility?.first_steps || []).forEach((s, i) =>
    check(`feasibility.first_steps[${i}]`, s, TOPIC_LIMITS.first_steps),
  );
  (topic.hypothesis_tests || []).forEach((t, i) => {
    check(
      `hypothesis_tests[${i}].comparison_or_variable`,
      t.comparison_or_variable,
      TOPIC_LIMITS.comparison_or_variable,
    );
    check(
      `hypothesis_tests[${i}].data_source`,
      t.data_source,
      TOPIC_LIMITS.data_source,
    );
  });
  return hits;
}

function applyClamp(
  value: string,
  max: number,
  meta: { axis: TopicAxis; field: string },
): string {
  if (value.length <= max) return value;
  const clamped = clampAtSentence(value, max);
  if (clamped !== null) return clamped;
  console.info(
    JSON.stringify({
      event: "topics.quality",
      code: "TOO_LONG_KEPT",
      axis: meta.axis,
      field: meta.field,
      length: value.length,
      max,
    }),
  );
  return value;
}

/**
 * Après corrections : coupe à la fin de phrase si encore trop long.
 * Sinon garde le texte et journalise TOO_LONG_KEPT.
 */
export function enforceTopicLimits(topic: GeneratedTopic): GeneratedTopic {
  const axis = topic.axis;
  const hyp = (topic.hypotheses || []).map((h, i) =>
    applyClamp(h, TOPIC_LIMITS.hypotheses, {
      axis,
      field: `hypotheses[${i}]`,
    }),
  );
  const risks = (topic.feasibility?.risks || []).map((r, i) =>
    applyClamp(r, TOPIC_LIMITS.risks, {
      axis,
      field: `feasibility.risks[${i}]`,
    }),
  );
  const first_steps = (topic.feasibility?.first_steps || []).map((s, i) =>
    applyClamp(s, TOPIC_LIMITS.first_steps, {
      axis,
      field: `feasibility.first_steps[${i}]`,
    }),
  );
  const hypothesis_tests = (topic.hypothesis_tests || []).map((t, i) => ({
    ...t,
    comparison_or_variable: applyClamp(
      t.comparison_or_variable,
      TOPIC_LIMITS.comparison_or_variable,
      { axis, field: `hypothesis_tests[${i}].comparison_or_variable` },
    ),
    data_source: applyClamp(t.data_source, TOPIC_LIMITS.data_source, {
      axis,
      field: `hypothesis_tests[${i}].data_source`,
    }),
  }));

  return {
    ...topic,
    title: applyClamp(topic.title || "", TOPIC_LIMITS.title, {
      axis,
      field: "title",
    }),
    context: applyClamp(topic.context || "", TOPIC_LIMITS.context, {
      axis,
      field: "context",
    }),
    research_question: applyClamp(
      topic.research_question || "",
      TOPIC_LIMITS.research_question,
      { axis, field: "research_question" },
    ),
    field_or_corpus: applyClamp(
      topic.field_or_corpus || "",
      TOPIC_LIMITS.field_or_corpus,
      { axis, field: "field_or_corpus" },
    ),
    method: applyClamp(topic.method || "", TOPIC_LIMITS.method, {
      axis,
      field: "method",
    }),
    rationale: applyClamp(topic.rationale || "", TOPIC_LIMITS.rationale, {
      axis,
      field: "rationale",
    }),
    pitch: topic.pitch
      ? applyClamp(topic.pitch, TOPIC_LIMITS.pitch, { axis, field: "pitch" })
      : topic.pitch,
    stakes: (topic.stakes || []).map((s, i) =>
      applyClamp(s, TOPIC_LIMITS.stakes, { axis, field: `stakes[${i}]` }),
    ),
    leads: (topic.leads || []).map((s, i) =>
      applyClamp(s, TOPIC_LIMITS.leads, { axis, field: `leads[${i}]` }),
    ),
    research_object: applyClamp(
      topic.research_object || "",
      TOPIC_LIMITS.research_object,
      { axis, field: "research_object" },
    ),
    expected_contribution: applyClamp(
      topic.expected_contribution || "",
      TOPIC_LIMITS.expected_contribution,
      { axis, field: "expected_contribution" },
    ),
    ethical_notes: topic.ethical_notes
      ? applyClamp(topic.ethical_notes, TOPIC_LIMITS.ethical_notes, {
          axis,
          field: "ethical_notes",
        })
      : topic.ethical_notes,
    title_writing_language: topic.title_writing_language
      ? applyClamp(
          topic.title_writing_language,
          TOPIC_LIMITS.title_writing_language,
          { axis, field: "title_writing_language" },
        )
      : topic.title_writing_language,
    hypotheses: hyp,
    feasibility: {
      ...topic.feasibility,
      risks,
      first_steps,
    },
    hypothesis_tests,
  };
}

function looksCompleteListItem(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (FINAL_PUNCT_RE.test(t)) return true;
  // Élément de liste / courte consigne sans ponctuation finale obligatoire.
  if (t.length <= 80 && !/\s\w{1,2}$/.test(t)) return true;
  return false;
}

export type TruncationSuspect = { axis: TopicAxis; field: string };

/** Garde-fou final : texte coupé sans ponctuation finale. */
export function findTruncationSuspects(
  topic: GeneratedTopic,
): TruncationSuspect[] {
  const suspects: TruncationSuspect[] = [];
  const check = (field: string, value: string | null | undefined) => {
    const t = (value || "").trim();
    if (!t) return;
    if (!looksCompleteListItem(t)) {
      suspects.push({ axis: topic.axis, field });
    }
  };
  check("title", topic.title);
  check("context", topic.context);
  check("research_question", topic.research_question);
  check("field_or_corpus", topic.field_or_corpus);
  check("method", topic.method);
  check("rationale", topic.rationale);
  check("pitch", topic.pitch);
  check("research_object", topic.research_object);
  check("expected_contribution", topic.expected_contribution);
  (topic.stakes || []).forEach((s, i) => check(`stakes[${i}]`, s));
  (topic.leads || []).forEach((s, i) => check(`leads[${i}]`, s));
  (topic.hypotheses || []).forEach((h, i) => check(`hypotheses[${i}]`, h));
  (topic.feasibility?.risks || []).forEach((r, i) =>
    check(`feasibility.risks[${i}]`, r),
  );
  (topic.feasibility?.first_steps || []).forEach((s, i) =>
    check(`feasibility.first_steps[${i}]`, s),
  );
  // hypothesis_tests : libellés courts, pas d'exigence de ponctuation finale.
  return suspects;
}

export function logTruncationSuspects(topics: GeneratedTopic[]): void {
  for (const topic of topics) {
    for (const s of findTruncationSuspects(topic)) {
      console.info(
        JSON.stringify({
          event: "topics.quality",
          code: "TRUNCATION_SUSPECT",
          axis: s.axis,
          field: s.field,
        }),
      );
    }
  }
}

export { parseFieldAccessWeeks } from "../../../../shared/research/workPlan";
