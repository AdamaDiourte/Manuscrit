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
  systemPrompt,
} from "./promptBuilder";
import {
  parseProposeTopicToolInput,
  proposeTopicInputSchema,
  proposeTopicLlmSchema,
  proposeTopicMasteryInputSchema,
} from "./validateOutput";
import {
  attachTopicWarnings,
  formatViolationsForCorrection,
  qualityCheck,
  sanitizeAfterFailedCorrection,
} from "./qualityCheck";
import {
  formatReviewIssuesForCorrection,
  reviewTopics,
  type ReviewIssue,
  type ReviewStatus,
} from "./reviewTopics";
import type {
  GeneratedTopic,
  ProfileAnalysis,
  TopicAxis,
} from "../../../../shared/research/topicTypes";
import type { PseudonymizedProfile } from "../../../../shared/privacy/buildPseudonymizedProfile";
import type { BlockingCorrectionTrace } from "./topicsJobs";
import type { AnglePlanItem } from "./planAngles";
import {
  clampAtSentence,
  enforceTopicLimits,
  findTruncationSuspects,
  TOPIC_LIMITS,
} from "./textLimits";

export type GenerateEffort = "low" | "medium" | "high";
export type { BlockingCorrectionTrace };

function syncFieldOrCorpus(topic: GeneratedTopic): GeneratedTopic {
  const plan = topic.fieldwork_plan || [];
  const hours = estimateFieldworkHours(plan);
  const summary = formatFieldworkPlanSummary(plan);
  if (!summary) return { ...topic, estimated_hours: hours };
  const base = (topic.field_or_corpus || "").trim();
  const alreadyMentions =
    /≈|\b\d+\s+(entretien|document|questionnaire|observation|journée)/i.test(
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
};

/**
 * Chaîne complète pour un axe : génération → contrôles code → relecture → correction.
 * Trop similaire est traité plus tard, une fois les 3 axes prêts.
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

  const baseUser = buildAxisUserPrompt({
    profile,
    answers,
    axis,
    avoidTopics: params.avoidTopics,
    anglePlan: params.anglePlan,
    otherAngles: params.otherAngles,
  });

  let call = await runProposeTopic({
    system,
    user: baseUser,
    temperature: 0.6,
    axis,
    effort,
  });
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

  // Contrôles en code (sans TOO_SIMILAR inter-axes — un seul sujet)
  let qc = qualityCheck([topic], profile, qcOpts);
  const violations_first = [...new Set(qc.violations.map((v) => v.code))];
  let violations_after: string[] = [];

  if (qc.violations.length) {
    const correctionUser = buildCorrectionUserPrompt({
      baseUserPrompt: baseUser,
      previousOutput: { topic },
      violationListFr: formatViolationsForCorrection(qc.violations),
    });
    try {
      call = await runProposeTopic({
        system,
        user: correctionUser,
        temperature: 0.6,
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
  }

  // Relecture de cet axe seul
  const review = await reviewTopics({
    topics: [topic],
    profile,
    answers,
  });
  tokens_in += review.tokens_in;
  tokens_out += review.tokens_out;
  tokens_thinking += review.tokens_thinking;
  latency_ms += review.latency_ms;
  const review_status = review.status;
  const review_issues = review.issues.filter((i) => i.axis === axis);

  if (review.status === "ok" && review.blocking.length) {
    const before = passageSnapshot(topic);
    const correctionUser = buildCorrectionUserPrompt({
      baseUserPrompt: baseUser,
      previousOutput: { topic },
      violationListFr: formatReviewIssuesForCorrection(review.blocking),
    });
    try {
      call = await runProposeTopic({
        system,
        user: correctionUser,
        temperature: 0.6,
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
      const after = passageSnapshot(topic);
      for (const issue of review.blocking) {
        blocking_corrections.push({
          axis,
          code: issue.code,
          severity: issue.severity,
          explanation: issue.explanation,
          before,
          after,
        });
      }
      qc = qualityCheck([topic], profile, qcOpts);
      violations_after = [...new Set(qc.violations.map((v) => v.code))];
      if (qc.violations.length) {
        topic = attachTopicWarnings(
          sanitizeAfterFailedCorrection([topic], profile, { answers }),
          answers,
        )[0];
      }
    } catch {
      // conserve le sujet avant correction relecteur
    }
  }

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

  // Re-contrôle longueur après coupe éventuelle (métadonnées).
  const finalHits = qualityCheck([topic], profile, qcOpts);
  violations_after = [
    ...new Set([
      ...violations_after,
      ...finalHits.violations.map((v) => v.code),
    ]),
  ];

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
  };
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
