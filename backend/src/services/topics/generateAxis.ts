import { z } from "zod";
import { buildPseudonymizedProfile } from "../privacy/buildPseudonymizedProfile";
import {
  callClaudeStructured,
  getClaudeSettings,
  isClaudeProvider,
  isLlmConfigured,
  type StructuredCallMode,
} from "../llm/claude";
import { computeProfileCompleteness } from "../../../../shared/research/profileCompleteness";
import {
  estimateFieldworkHours,
  formatFieldworkPlanSummary,
} from "../../../../shared/research/fieldworkCosts";
import {
  buildAxisUserPrompt,
  buildCorrectionUserPrompt,
  buildCrossBlockingPatchUserPrompt,
  systemPrompt,
} from "./promptBuilder";
import {
  parseProposeTopicToolInput,
  proposeTopicInputSchema,
  proposeTopicLlmSchema,
  proposeTopicMasteryInputSchema,
} from "./validateOutput";
import {
  attachRemainingDefectWarnings,
  attachTopicWarnings,
  attachUncorrectedReviewWarnings,
  formatViolationsForCorrection,
  qualityCheck,
  sanitizeAfterFailedCorrection,
  type QualityViolation,
} from "./qualityCheck";
import {
  attachFeasibilityRisksFromReview,
  formatReviewIssuesForCorrection,
  reviewTopics,
  type ReviewIssue,
  type ReviewStatus,
} from "./reviewTopics";
import type {
  GeneratedTopic,
  ProfileAnalysis,
  RegenReason,
  TopicAxis,
} from "../../../../shared/research/topicTypes";
import { REGEN_REASON_LABELS } from "../../../../shared/research/topicTypes";
import type { PseudonymizedProfile } from "../../../../shared/privacy/buildPseudonymizedProfile";
import type {
  AxisTiming,
  BlockingCorrectionTrace,
} from "./topicsJobs";
import type { AnglePlanItem } from "./planAngles";
import {
  clampAtSentence,
  enforceTopicLimits,
  findTruncationSuspects,
  TOPIC_LIMITS,
} from "./textLimits";

const titleOnlySchema = z.object({
  title: z.string().trim().min(3).max(220),
});

const titleOnlyInputSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 3, maxLength: 220 },
  },
  required: ["title"],
  additionalProperties: false,
} as const;

const questionOnlySchema = z.object({
  research_question: z.string().trim().min(8).max(600),
});

const questionOnlyInputSchema = {
  type: "object",
  properties: {
    research_question: { type: "string", minLength: 8, maxLength: 600 },
  },
  required: ["research_question"],
  additionalProperties: false,
} as const;

type ShortenUsage = {
  tokens_in: number;
  tokens_out: number;
  tokens_thinking: number;
  latency_ms: number;
};

/** Raccourcit un titre trop long via le modèle rapide (1 essai). */
async function shortenTitleOnly(title: string): Promise<
  { title: string } & ShortenUsage
> {
  const { modelFast } = getClaudeSettings();
  const result = await callClaudeStructured<{ title: string }>({
    system:
      "Tu raccourcis des titres de recherche. Tu ne changes que la longueur et la densité : conserve l'objet et l'angle.",
    user: [
      "Raccourcis ce titre à 15 mots au plus, ≤ 110 caractères, un seul « : » au plus, sans perdre l'objet ni l'angle.",
      JSON.stringify({ title }),
    ].join("\n"),
    toolName: "shorten_title",
    inputSchema: titleOnlyInputSchema as unknown as Record<string, unknown>,
    zodSchema: titleOnlySchema,
    model: modelFast,
    maxTokens: 200,
    effort: "low",
    toolDescription: "Renvoie uniquement le titre raccourci.",
  });
  return {
    title: String(result.data?.title || "").trim(),
    tokens_in: result.usage.inputTokens,
    tokens_out: result.usage.outputTokens,
    tokens_thinking: result.usage.thinkingTokens,
    latency_ms: result.latencyMs,
  };
}

/** Raccourcit une question trop longue via le modèle rapide (1 essai). */
async function shortenQuestionOnly(research_question: string): Promise<
  { research_question: string } & ShortenUsage
> {
  const { modelFast } = getClaudeSettings();
  const result = await callClaudeStructured<{ research_question: string }>({
    system:
      "Tu raccourcis des questions de recherche. Une seule interrogation ; conserve l'objet et l'angle.",
    user: [
      "Reformule en une seule question interrogative de 30 mots au plus (un seul « ? »), sans perdre l'objet.",
      JSON.stringify({ research_question }),
    ].join("\n"),
    toolName: "shorten_question",
    inputSchema: questionOnlyInputSchema as unknown as Record<string, unknown>,
    zodSchema: questionOnlySchema,
    model: modelFast,
    maxTokens: 250,
    effort: "low",
    toolDescription: "Renvoie uniquement la question raccourcie.",
  });
  return {
    research_question: String(result.data?.research_question || "").trim(),
    tokens_in: result.usage.inputTokens,
    tokens_out: result.usage.outputTokens,
    tokens_thinking: result.usage.thinkingTokens,
    latency_ms: result.latencyMs,
  };
}

export type GenerateEffort = "low" | "medium" | "high";
export type { AxisTiming, BlockingCorrectionTrace };

function syncFieldOrCorpus(topic: GeneratedTopic): GeneratedTopic {
  const plan = topic.fieldwork_plan || [];
  const hours = estimateFieldworkHours(plan);
  const summary = formatFieldworkPlanSummary(plan);
  if (!summary) return { ...topic, estimated_hours: hours };
  const base = (topic.field_or_corpus || "").trim();
  const alreadyMentions =
    /≈|\b\d+\s+(entretien|document|questionnaire|observation|journée|mois\s+d'analyse)/i.test(
      base,
    );
  const appended = alreadyMentions
    ? base
    : `${base}${base.endsWith(".") ? "" : "."} Plan : ${summary} (≈ ${hours} h collecte/analyse).`;
  const max = TOPIC_LIMITS.field_or_corpus;
  let field_or_corpus = appended;
  if (appended.length > max) {
    const clamped = clampAtSentence(appended, max);
    if (clamped !== null) field_or_corpus = clamped;
    else {
      console.info(
        JSON.stringify({
          event: "topics.quality",
          code: "TOO_LONG_KEPT",
          axis: topic.axis,
          field: "field_or_corpus",
          length: appended.length,
          max,
        }),
      );
      field_or_corpus = appended;
    }
  }
  return { ...topic, field_or_corpus, estimated_hours: hours };
}

function passageSnapshot(topic: GeneratedTopic) {
  return {
    title: topic.title || "",
    research_question: topic.research_question || "",
    hypotheses: [...(topic.hypotheses || [])],
    method: topic.method || "",
    field_or_corpus: topic.field_or_corpus || "",
    hypothesis_tests: [...(topic.hypothesis_tests || [])],
  };
}

async function runProposeTopic(params: {
  system: string;
  user: string;
  temperature: number;
  axis: TopicAxis;
  effort?: GenerateEffort;
}): Promise<{
  topic: GeneratedTopic;
  profile_analysis?: ProfileAnalysis;
  personalization_level?: "high" | "medium" | "low";
  model: string;
  tokens_in: number;
  tokens_out: number;
  tokens_thinking: number;
  mode: StructuredCallMode;
  latencyMs: number;
}> {
  const { modelSmart } = getClaudeSettings();
  const isMastery = params.axis === "mastery";
  const callOnce = () =>
    callClaudeStructured<unknown>({
      system: params.system,
      user: params.user,
      toolName: "propose_topic",
      inputSchema: isMastery
        ? proposeTopicMasteryInputSchema
        : proposeTopicInputSchema,
      zodSchema: proposeTopicLlmSchema,
      model: modelSmart,
      temperature: params.temperature,
      maxTokens: 4500,
      effort: params.effort || "low",
      toolDescription: isMastery
        ? "Propose le sujet mastery et l'analyse de profil."
        : "Propose un seul sujet de recherche pour l'axe demandé.",
    });

  let result;
  let parsed;
  let latencyMs = 0;
  let tokens_in = 0;
  let tokens_out = 0;
  let tokens_thinking = 0;
  try {
    result = await callOnce();
    latencyMs += result.latencyMs;
    tokens_in += result.usage.inputTokens;
    tokens_out += result.usage.outputTokens;
    tokens_thinking += result.usage.thinkingTokens;
    parsed = parseProposeTopicToolInput(result.data);
  } catch {
    console.info(
      JSON.stringify({
        event: "topics.axis_retry",
        axis: params.axis,
        code: "parse_retry",
      }),
    );
    result = await callOnce();
    latencyMs += result.latencyMs;
    tokens_in += result.usage.inputTokens;
    tokens_out += result.usage.outputTokens;
    tokens_thinking += result.usage.thinkingTokens;
    parsed = parseProposeTopicToolInput(result.data);
  }
  return {
    topic: parsed.topic as GeneratedTopic,
    profile_analysis: parsed.profile_analysis,
    personalization_level: parsed.personalization_level,
    model: result.model,
    tokens_in,
    tokens_out,
    tokens_thinking,
    mode: result.mode,
    latencyMs,
  };
}

export type AxisPipelineResult = {
  topic: GeneratedTopic;
  profile_analysis?: ProfileAnalysis;
  personalization_level?: "high" | "medium" | "low";
  model: string;
  tokens_in: number;
  tokens_out: number;
  tokens_thinking: number;
  latency_ms: number;
  violations_first: string[];
  violations_after: string[];
  review_status: ReviewStatus;
  review_issues: ReviewIssue[];
  blocking_corrections: BlockingCorrectionTrace[];
  timing: AxisTiming;
};

/**
 * Chaîne complète pour un axe :
 * génération → (contrôles code ∥ relecteur) → une seule correction patch → re-contrôle code.
 */
export async function runAxisPipeline(params: {
  axis: TopicAxis;
  answers: Record<string, unknown>;
  profile: PseudonymizedProfile;
  effort?: GenerateEffort;
  avoidTopics?: Array<
    Pick<GeneratedTopic, "axis" | "title" | "research_object">
  >;
  anglePlan?: AnglePlanItem;
  otherAngles?: AnglePlanItem[];
  regen?: {
    reason: RegenReason;
    previousTitle?: string;
    rejectedTitles?: string[];
  };
}): Promise<AxisPipelineResult> {
  const { axis, answers, profile } = params;
  const effort = params.effort || "low";
  const system = systemPrompt();
  const qcOpts = { answers };
  let tokens_in = 0;
  let tokens_out = 0;
  let tokens_thinking = 0;
  let latency_ms = 0;
  let model = getClaudeSettings().modelSmart;
  const blocking_corrections: BlockingCorrectionTrace[] = [];
  const timing: AxisTiming = {
    generate_ms: 0,
    quality_check_ms: 0,
    review_ms: 0,
    correction_ms: 0,
  };

  let baseUser = buildAxisUserPrompt({
    profile,
    answers,
    axis,
    avoidTopics: params.avoidTopics,
    anglePlan: params.anglePlan,
    otherAngles: params.otherAngles,
  });
  if (params.regen) {
    const regenLines = [
      "## Régénération",
      `Motif : ${REGEN_REASON_LABELS[params.regen.reason]}`,
      params.regen.previousTitle
        ? `Titre précédent à remplacer : ${params.regen.previousTitle}`
        : "",
      params.regen.rejectedTitles?.length
        ? [
            "## Titres déjà rejetés pour cet axe (ne pas les reproduire)",
            params.regen.rejectedTitles.map((t) => `- ${t}`).join("\n"),
          ].join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    baseUser = `${baseUser}\n\n${regenLines}`;
  }

  const genStarted = Date.now();
  let call = await runProposeTopic({
    system,
    user: baseUser,
    temperature: params.regen ? 0.75 : 0.6,
    axis,
    effort,
  });
  timing.generate_ms = Date.now() - genStarted;
  tokens_in += call.tokens_in;
  tokens_out += call.tokens_out;
  tokens_thinking += call.tokens_thinking;
  latency_ms += call.latencyMs;
  model = call.model;

  let topic = syncFieldOrCorpus({
    ...call.topic,
    axis,
    readings: undefined,
  });
  let profile_analysis = call.profile_analysis;
  let personalization_level = call.personalization_level;

  // Contrôles code + relecteur en parallèle
  const checksStarted = Date.now();
  const qcPromise = Promise.resolve().then(() => {
    const t0 = Date.now();
    const qc = qualityCheck([topic], profile, qcOpts);
    return { qc, ms: Date.now() - t0 };
  });
  const reviewPromise = reviewTopics({
    topics: [topic],
    profile,
    answers,
  });
  const [qcPack, review] = await Promise.all([qcPromise, reviewPromise]);
  timing.quality_check_ms = qcPack.ms;
  timing.review_ms = review.latency_ms;
  // Wall clock des contrôles parallèles (pour latency_ms axe).
  latency_ms += Math.max(Date.now() - checksStarted, review.latency_ms);

  tokens_in += review.tokens_in;
  tokens_out += review.tokens_out;
  tokens_thinking += review.tokens_thinking;

  let qc = qcPack.qc;
  const violations_first = [...new Set(qc.violations.map((v) => v.code))];
  let violations_after: string[] = [];
  const review_status = review.status;
  let review_issues = review.issues.filter((i) => i.axis === axis);
  const blockingReview =
    review.status === "ok" ? review.blocking.filter((i) => i.axis === axis) : [];

  // TOO_LONG : coupé ensuite par enforceTopicLimits — pas d'appel modèle seul pour ça.
  // COMPLEX_DESIGN : avertissement carte seulement, pas de correction LLM.
  // PITCH_REPETITIVE : mineur — joint à une correction déjà prévue, sinon journal seulement.
  const pitchRepetitive = qc.violations.filter(
    (v) => v.code === "PITCH_REPETITIVE",
  );
  const qcForLlm = qc.violations.filter(
    (v) =>
      v.code !== "TOO_LONG" &&
      v.code !== "COMPLEX_DESIGN" &&
      v.code !== "PITCH_REPETITIVE",
  );
  const blockingLines: string[] = [];
  if (qcForLlm.length) {
    blockingLines.push(formatViolationsForCorrection(qcForLlm));
  }
  if (blockingReview.length) {
    blockingLines.push(formatReviewIssuesForCorrection(blockingReview));
  }
  if (blockingLines.length && pitchRepetitive.length) {
    blockingLines.push(formatViolationsForCorrection(pitchRepetitive));
  } else if (pitchRepetitive.length) {
    for (const v of pitchRepetitive) {
      console.info(
        JSON.stringify({
          event: "topics.quality",
          code: "PITCH_REPETITIVE",
          axis,
          detail: v.detail.slice(0, 120),
        }),
      );
    }
  }

  if (blockingLines.length) {
    const corrStarted = Date.now();
    const before = passageSnapshot(topic);
    // Correction unique : propose_topic (stable ~15–30 s). Le format
    // patch_topic { fields } timeout sous output_config Sonnet (120 s) ;
    // OVERLAP croisé utilise encore patch_topic (champs ciblés).
    const correctionUser = buildCorrectionUserPrompt({
      baseUserPrompt: baseUser,
      previousOutput: { topic },
      violationListFr: [
        blockingLines.join("\n"),
        "Corrige uniquement les points listés. Ne change pas l'axe ni l'angle imposé sans nécessité.",
      ].join("\n"),
    });
    try {
      call = await runProposeTopic({
        system,
        user: correctionUser,
        temperature: 0.5,
        axis,
        effort,
      });
      tokens_in += call.tokens_in;
      tokens_out += call.tokens_out;
      tokens_thinking += call.tokens_thinking;
      latency_ms += call.latencyMs;
      model = call.model;
      topic = syncFieldOrCorpus({
        ...call.topic,
        axis,
        readings: undefined,
      });
      if (call.profile_analysis) profile_analysis = call.profile_analysis;
      if (call.personalization_level)
        personalization_level = call.personalization_level;
      const after = passageSnapshot(topic);
      for (const issue of blockingReview) {
        blocking_corrections.push({
          axis,
          code: issue.code,
          severity: issue.severity,
          explanation: issue.explanation,
          before,
          after,
        });
      }
      for (const v of [...qcForLlm, ...pitchRepetitive]) {
        if (blockingReview.some((i) => i.code === (v.code as string)))
          continue;
        blocking_corrections.push({
          axis,
          code: v.code,
          severity: v.code === "PITCH_REPETITIVE" ? "minor" : "blocking",
          explanation: v.detail,
          before,
          after,
        });
      }
      // Re-contrôle code uniquement — pas de nouvel appel modèle.
      qc = qualityCheck([topic], profile, qcOpts);
      violations_after = [...new Set(qc.violations.map((v) => v.code))];
      if (qc.violations.length) {
        topic = attachTopicWarnings(
          sanitizeAfterFailedCorrection([topic], profile, { answers }),
          answers,
        )[0];
      }
    } catch {
      topic = attachTopicWarnings(
        sanitizeAfterFailedCorrection([topic], profile, { answers }),
        answers,
      )[0];
      violations_after = violations_first;
    }
    timing.correction_ms = Date.now() - corrStarted;
  }

  // TITLE_TOO_LONG / QUESTION_TOO_LONG persistants → appels dédiés (modèle rapide), 1 essai chacun.
  if (qc.violations.some((v) => v.code === "TITLE_TOO_LONG")) {
    const titleStarted = Date.now();
    try {
      const shortened = await shortenTitleOnly(topic.title);
      tokens_in += shortened.tokens_in;
      tokens_out += shortened.tokens_out;
      tokens_thinking += shortened.tokens_thinking;
      latency_ms += shortened.latency_ms;
      if (shortened.title) {
        topic = { ...topic, title: shortened.title };
      }
      qc = qualityCheck([topic], profile, qcOpts);
      violations_after = [...new Set(qc.violations.map((v) => v.code))];
    } catch (err) {
      console.info(
        JSON.stringify({
          event: "topics.quality",
          code: "TITLE_SHORTEN_FAILED",
          axis,
          error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
        }),
      );
    }
    timing.correction_ms += Date.now() - titleStarted;
  }

  if (qc.violations.some((v) => v.code === "QUESTION_TOO_LONG")) {
    const qStarted = Date.now();
    try {
      const shortened = await shortenQuestionOnly(topic.research_question);
      tokens_in += shortened.tokens_in;
      tokens_out += shortened.tokens_out;
      tokens_thinking += shortened.tokens_thinking;
      latency_ms += shortened.latency_ms;
      if (shortened.research_question) {
        topic = {
          ...topic,
          research_question: shortened.research_question,
        };
      }
      qc = qualityCheck([topic], profile, qcOpts);
      violations_after = [...new Set(qc.violations.map((v) => v.code))];
    } catch (err) {
      console.info(
        JSON.stringify({
          event: "topics.quality",
          code: "QUESTION_SHORTEN_FAILED",
          axis,
          error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
        }),
      );
    }
    timing.correction_ms += Date.now() - qStarted;
  }

  // FEASIBILITY_RISK mineurs → risks
  topic = attachFeasibilityRisksFromReview([topic], review_issues)[0];

  topic = enforceTopicLimits(attachTopicWarnings([topic], answers)[0]);
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

  // Re-contrôle après coupe : défauts restants → avertissements carte.
  const finalHits = qualityCheck([topic], profile, qcOpts);
  violations_after = [
    ...new Set([
      ...violations_after,
      ...finalHits.violations.map((v) => v.code),
    ]),
  ];
  topic = attachRemainingDefectWarnings([topic], finalHits.violations)[0];
  topic = attachUncorrectedReviewWarnings([topic], blocking_corrections)[0];

  return {
    topic,
    profile_analysis,
    personalization_level,
    model,
    tokens_in,
    tokens_out,
    tokens_thinking,
    latency_ms,
    violations_first,
    violations_after,
    review_status,
    review_issues,
    blocking_corrections,
    timing,
  };
}

/**
 * Correction ciblée pour un bloquant de relecture croisée (OVERLAP, ETHICS…).
 * Un appel par axe. En dernier recours (TOO_SIMILAR / échec), régénère l'axe.
 */
export async function patchCrossBlockingAxis(params: {
  axis: TopicAxis;
  topic: GeneratedTopic;
  otherTopics: GeneratedTopic[];
  issues: Array<{ code: string; explanation: string; severity?: string }>;
  answers: Record<string, unknown>;
  profile: PseudonymizedProfile;
  effort?: GenerateEffort;
  anglePlan?: AnglePlanItem;
  otherAngles?: AnglePlanItem[];
}): Promise<{
  topic: GeneratedTopic;
  model: string;
  tokens_in: number;
  tokens_out: number;
  tokens_thinking: number;
  latency_ms: number;
  timing: AxisTiming;
  blocking_corrections: BlockingCorrectionTrace[];
  review_status: ReviewStatus;
  review_issues: ReviewIssue[];
  violations_first: string[];
  violations_after: string[];
  used_full_regen: boolean;
}> {
  const effort = params.effort || "low";
  const system = systemPrompt();
  const before = passageSnapshot(params.topic);
  const timing: AxisTiming = {
    generate_ms: 0,
    quality_check_ms: 0,
    review_ms: 0,
    correction_ms: 0,
  };
  const blocking_corrections: BlockingCorrectionTrace[] = [];
  let tokens_in = 0;
  let tokens_out = 0;
  let tokens_thinking = 0;
  let latency_ms = 0;
  let model = getClaudeSettings().modelSmart;

  const issues = params.issues.filter((i) => (i.explanation || "").trim());
  // Correction ciblée, sans régénérer tout le pipeline axe.
  // patch_topic { fields } timeout sous output_config Sonnet → propose_topic.
  const focusedUser = buildCrossBlockingPatchUserPrompt({
    axis: params.axis,
    topic: params.topic,
    otherTopics: params.otherTopics.map((t) => ({
      axis: t.axis,
      title: t.title,
      research_object: t.research_object,
      field_or_corpus: t.field_or_corpus,
    })),
    issues,
  }).replace(
    "Appelle patch_topic avec { fields: { <nom_du_champ>: <nouvelle_valeur> } }. Inclure seulement les champs réellement changés. Les autres champs sont conservés tels quels.",
    "Appelle propose_topic avec le sujet corrigé. Corrige les champs nécessaires (ethical_notes, research_object, field_or_corpus, title, research_question, hypotheses, hypothesis_tests, pitch, stakes, leads…). Garde method et l'esprit de l'axe.",
  );

  try {
    const corrStarted = Date.now();
    const call = await runProposeTopic({
      system,
      user: focusedUser,
      temperature: 0.55,
      axis: params.axis,
      effort,
    });
    tokens_in += call.tokens_in;
    tokens_out += call.tokens_out;
    tokens_thinking += call.tokens_thinking;
    latency_ms += call.latencyMs;
    model = call.model;
    let topic = syncFieldOrCorpus({
      ...call.topic,
      axis: params.axis,
      readings: undefined,
    });
    timing.correction_ms = Date.now() - corrStarted;
    const after = passageSnapshot(topic);
    for (const issue of issues) {
      blocking_corrections.push({
        axis: params.axis,
        code: issue.code,
        severity: "blocking",
        explanation: issue.explanation,
        before,
        after,
      });
    }

    const qcStarted = Date.now();
    let qc = qualityCheck([topic], params.profile, { answers: params.answers });
    timing.quality_check_ms = Date.now() - qcStarted;
    const violations_first = [...new Set(qc.violations.map((v) => v.code))];

    if (qc.violations.some((v) => v.code === "TOO_SIMILAR")) {
      // Patch insuffisant → régénération complète en dernier recours.
      const regen = await runAxisPipeline({
        axis: params.axis,
        answers: params.answers,
        profile: params.profile,
        effort,
        avoidTopics: params.otherTopics.map((t) => ({
          axis: t.axis,
          title: t.title,
          research_object: t.research_object,
        })),
        anglePlan: params.anglePlan,
        otherAngles: params.otherAngles,
      });
      return {
        topic: regen.topic,
        model: regen.model,
        tokens_in: tokens_in + regen.tokens_in,
        tokens_out: tokens_out + regen.tokens_out,
        tokens_thinking: tokens_thinking + regen.tokens_thinking,
        latency_ms: latency_ms + regen.latency_ms,
        timing: {
          generate_ms: regen.timing.generate_ms,
          quality_check_ms:
            timing.quality_check_ms + regen.timing.quality_check_ms,
          review_ms: regen.timing.review_ms,
          correction_ms: timing.correction_ms + regen.timing.correction_ms,
        },
        blocking_corrections: [
          ...blocking_corrections,
          ...regen.blocking_corrections,
        ],
        review_status: regen.review_status,
        review_issues: regen.review_issues,
        violations_first,
        violations_after: regen.violations_after,
        used_full_regen: true,
      };
    }

    if (qc.violations.length) {
      topic = attachTopicWarnings(
        sanitizeAfterFailedCorrection([topic], params.profile, {
          answers: params.answers,
        }),
        params.answers,
      )[0];
    }
    topic = enforceTopicLimits(
      attachTopicWarnings([topic], params.answers)[0],
    );
    const finalHits = qualityCheck([topic], params.profile, {
      answers: params.answers,
    });
    topic = attachRemainingDefectWarnings([topic], finalHits.violations)[0];
    topic = attachUncorrectedReviewWarnings([topic], blocking_corrections)[0];

    return {
      topic,
      model,
      tokens_in,
      tokens_out,
      tokens_thinking,
      latency_ms,
      timing,
      blocking_corrections,
      review_status: "ok",
      review_issues: [],
      violations_first,
      violations_after: [...new Set(finalHits.violations.map((v) => v.code))],
      used_full_regen: false,
    };
  } catch {
    // Échec patch → régénération complète.
    const regen = await runAxisPipeline({
      axis: params.axis,
      answers: params.answers,
      profile: params.profile,
      effort,
      avoidTopics: params.otherTopics.map((t) => ({
        axis: t.axis,
        title: t.title,
        research_object: t.research_object,
      })),
      anglePlan: params.anglePlan,
      otherAngles: params.otherAngles,
    });
    return {
      topic: regen.topic,
      model: regen.model,
      tokens_in: tokens_in + regen.tokens_in,
      tokens_out: tokens_out + regen.tokens_out,
      tokens_thinking: tokens_thinking + regen.tokens_thinking,
      latency_ms: latency_ms + regen.latency_ms,
      timing: regen.timing,
      blocking_corrections: [
        ...blocking_corrections,
        ...regen.blocking_corrections,
      ],
      review_status: regen.review_status,
      review_issues: regen.review_issues,
      violations_first: regen.violations_first,
      violations_after: regen.violations_after,
      used_full_regen: true,
    };
  }
}

/** @deprecated alias — préfère patchCrossBlockingAxis */
export async function patchOverlapAxis(params: {
  axis: TopicAxis;
  topic: GeneratedTopic;
  otherTopics: GeneratedTopic[];
  explanations: string[];
  answers: Record<string, unknown>;
  profile: PseudonymizedProfile;
  effort?: GenerateEffort;
  anglePlan?: AnglePlanItem;
  otherAngles?: AnglePlanItem[];
}) {
  return patchCrossBlockingAxis({
    ...params,
    issues: params.explanations.map((explanation) => ({
      code: "OVERLAP",
      explanation,
    })),
  });
}

export function resolveSimilarity(
  topics: GeneratedTopic[],
  profile: PseudonymizedProfile,
  answers: Record<string, unknown>,
): { topics: GeneratedTopic[]; similar: boolean; target?: TopicAxis } {
  const qc = qualityCheck(topics, profile, { answers });
  const similar = qc.violations.filter((v) => v.code === "TOO_SIMILAR");
  if (!similar.length) return { topics, similar: false };
  const target: TopicAxis =
    similar.some((v) => v.axis === "discovery") ||
    similar.some((v) => v.detail.includes("discovery"))
      ? "discovery"
      : similar[0].axis || "discovery";
  return { topics, similar: true, target };
}

export async function ensureLlmReady(
  env: Record<string, string>,
): Promise<void> {
  if (!isLlmConfigured(env) || !isClaudeProvider()) {
    const err = new Error(
      "Le service de génération est momentanément indisponible.",
    ) as Error & { status: number };
    err.status = 503;
    throw err;
  }
}

export function buildProfile(answers: Record<string, unknown>) {
  return {
    profile: buildPseudonymizedProfile(answers),
    completeness: computeProfileCompleteness(answers),
  };
}

export type { QualityViolation };
