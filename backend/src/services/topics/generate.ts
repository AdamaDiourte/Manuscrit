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
  buildRegenUserPrompt,
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
  type QualityViolation,
} from "./qualityCheck";
import {
  formatReviewIssuesForCorrection,
  reviewTopics,
  type ReviewIssue,
  type ReviewStatus,
} from "./reviewTopics";
import { simulateTopics } from "./simulateContent";
import type {
  GeneratedTopic,
  ProfileAnalysis,
  RegenReason,
  TopicAxis,
  TopicsOutput,
} from "../../../../shared/research/topicTypes";

export type GenerateTopicsResult = {
  topics: TopicsOutput["topics"];
  model: string;
  tokens?: number;
  tokens_in?: number;
  tokens_out?: number;
  tokens_thinking?: number;
  structured_mode?: StructuredCallMode;
  simulated?: boolean;
  profile_analysis?: ProfileAnalysis;
  personalization_level?: "high" | "medium" | "low";
  violations: string[];
  /** Codes détectés au premier essai (avant correction). */
  violations_first: string[];
  /** Codes restants après l'appel correctif (vide si pas de 2e essai). */
  violations_after_correction: string[];
  review_status?: ReviewStatus;
  review_issues_first?: Array<{
    axis: TopicAxis;
    code: string;
    severity: string;
    explanation?: string;
  }>;
  review_issues_after_correction?: Array<{
    axis: TopicAxis;
    code: string;
    severity: string;
    explanation?: string;
  }>;
  attempts: number;
  latency_ms: number;
  tokens_by_call?: Array<{
    call: string;
    tokens_in: number;
    tokens_out: number;
    tokens_thinking: number;
    latency_ms: number;
  }>;
};

export type GenerateEffort = "low" | "medium" | "high";

function emptyAnalysis(missing: string[]): ProfileAnalysis {
  return {
    strengths: [],
    interests: [],
    wants_to_learn: [],
    constraints: [],
    missing,
  };
}

/** Omit readings so the client can defer-fetch (undefined ≠ empty result). */
function withoutReadings(topics: GeneratedTopic[]): GeneratedTopic[] {
  return topics.map(({ readings: _r, ...t }) => ({
    ...t,
    estimated_hours: estimateFieldworkHours(t.fieldwork_plan || []),
  }));
}

/** Garde field_or_corpus cohérent avec le plan après correction. */
function syncFieldOrCorpus(topic: GeneratedTopic): GeneratedTopic {
  const plan = topic.fieldwork_plan || [];
  const hours = estimateFieldworkHours(plan);
  const summary = formatFieldworkPlanSummary(plan);
  if (!summary) {
    return { ...topic, estimated_hours: hours };
  }
  const base = (topic.field_or_corpus || "").trim();
  const alreadyMentions = /≈|\b\d+\s+(entretien|document|questionnaire|observation|journée)/i.test(
    base,
  );
  const appended = alreadyMentions
    ? base
    : `${base}${base.endsWith(".") ? "" : "."} Plan : ${summary} (≈ ${hours} h collecte/analyse).`;
  const max = 700;
  let field_or_corpus = appended;
  if (appended.length > max) {
    const window = appended.slice(0, max);
    const lastEnd = Math.max(
      window.lastIndexOf("."),
      window.lastIndexOf("?"),
      window.lastIndexOf("!"),
    );
    field_or_corpus =
      lastEnd >= Math.floor(max * 0.4)
        ? window.slice(0, lastEnd + 1).trim()
        : appended;
  }
  return { ...topic, field_or_corpus, estimated_hours: hours };
}

function applyHours(topics: GeneratedTopic[]): GeneratedTopic[] {
  return topics.map(syncFieldOrCorpus);
}

type AxisCallResult = {
  topic: GeneratedTopic;
  profile_analysis?: ProfileAnalysis;
  personalization_level?: "high" | "medium" | "low";
  model: string;
  tokens_in: number;
  tokens_out: number;
  tokens_thinking: number;
  mode: StructuredCallMode;
  latencyMs: number;
};

async function runProposeTopic(params: {
  system: string;
  user: string;
  temperature: number;
  axis?: TopicAxis;
  effort?: GenerateEffort;
}): Promise<AxisCallResult> {
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

  // Un nouvel essai si JSON / schéma invalide (erreurs intermittentes du modèle).
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
        axis: params.axis ?? null,
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

function mergeAxisTopics(
  byAxis: Partial<Record<TopicAxis, GeneratedTopic>>,
): GeneratedTopic[] {
  const order: TopicAxis[] = ["mastery", "ambition", "discovery"];
  return order.map((axis) => {
    const t = byAxis[axis];
    if (!t) throw new Error(`Sujet manquant pour l'axe ${axis}.`);
    return syncFieldOrCorpus({ ...t, axis, readings: undefined });
  });
}

export async function generateTopics(
  answers: Record<string, unknown>,
  env: Record<string, string>,
  regenerate?: {
    axis: TopicAxis;
    reason: RegenReason;
    previousTitle?: string;
    previousTopics?: TopicsOutput["topics"];
    rejectedTitles?: string[];
    profile_analysis?: ProfileAnalysis;
  },
  options?: { simulate?: boolean; effort?: GenerateEffort },
): Promise<GenerateTopicsResult> {
  const completeness = computeProfileCompleteness(answers);
  const personalization_level = completeness.level;
  const effort: GenerateEffort = options?.effort || "low";
  const tokens_by_call: GenerateTopicsResult["tokens_by_call"] = [];

  if (options?.simulate) {
    let topics: GeneratedTopic[] = withoutReadings(simulateTopics(answers));
    if (regenerate?.previousTopics?.length === 3) {
      const replacement = topics.find((t) => t.axis === regenerate.axis);
      if (replacement) {
        topics = regenerate.previousTopics.map((t) =>
          t.axis === regenerate.axis
            ? { ...replacement, readings: undefined }
            : t,
        );
      }
    }
    return {
      topics: attachTopicWarnings(applyHours(topics), answers),
      model: "simulation",
      simulated: true,
      profile_analysis: emptyAnalysis(
        completeness.missing.map((m) => m.label),
      ),
      personalization_level,
      violations: [],
      violations_first: [],
      violations_after_correction: [],
      review_status: "ok",
      attempts: 0,
      latency_ms: 0,
      tokens_by_call: [],
    };
  }

  if (!isLlmConfigured(env) || !isClaudeProvider()) {
    const err = new Error(
      "Le service de génération est momentanément indisponible.",
    ) as Error & { status: number };
    err.status = 503;
    throw err;
  }

  const profile = buildPseudonymizedProfile(answers);
  const system = systemPrompt();
  let attempts = 0;
  let tokens_in = 0;
  let tokens_out = 0;
  let tokens_thinking = 0;
  let structured_mode: StructuredCallMode | undefined;
  let latency_ms = 0;
  let model = getClaudeSettings().modelSmart;
  let violations: QualityViolation[] = [];
  let review_issues_first: ReviewIssue[] = [];
  let review_issues_after_correction: ReviewIssue[] = [];
  let review_status: ReviewStatus = "ok";

  const qcOpts = { answers };

  if (regenerate?.previousTopics?.length === 3) {
    const previousTopics = regenerate.previousTopics;
    const baseUser = buildRegenUserPrompt({
      profile,
      answers,
      axis: regenerate.axis,
      reason: regenerate.reason,
      keptTopics: previousTopics.map((t) => ({
        axis: t.axis,
        title: t.title,
        research_object: t.research_object,
      })),
      rejectedTitles: regenerate.rejectedTitles || [],
      previousTitle: regenerate.previousTitle,
    });

    attempts = 1;
    let topicResult = await runProposeTopic({
      system,
      user: baseUser,
      temperature: 0.75,
      axis: regenerate.axis,
      effort,
    });
    tokens_in += topicResult.tokens_in;
    tokens_out += topicResult.tokens_out;
    tokens_thinking += topicResult.tokens_thinking;
    structured_mode = topicResult.mode;
    latency_ms += topicResult.latencyMs;
    model = topicResult.model;
    tokens_by_call.push({
      call: `regen:${regenerate.axis}`,
      tokens_in: topicResult.tokens_in,
      tokens_out: topicResult.tokens_out,
      tokens_thinking: topicResult.tokens_thinking,
      latency_ms: topicResult.latencyMs,
    });

    let candidateTopics: GeneratedTopic[] = previousTopics.map((t) =>
      t.axis === regenerate.axis
        ? syncFieldOrCorpus({
            ...topicResult.topic,
            axis: regenerate.axis,
            readings: undefined,
          })
        : t,
    );

    let qc = qualityCheck(candidateTopics, profile, {
      rejectedTitles: regenerate.rejectedTitles,
      ...qcOpts,
    });
    violations = qc.violations;
    const violations_first = [...new Set(violations.map((v) => v.code))];
    let violations_after_correction: string[] = [];

    if (qc.violations.length) {
      attempts = 2;
      const correctionUser = buildCorrectionUserPrompt({
        baseUserPrompt: baseUser,
        previousOutput: { topic: topicResult.topic },
        violationListFr: formatViolationsForCorrection(qc.violations),
      });
      try {
        topicResult = await runProposeTopic({
          system,
          user: correctionUser,
          temperature: 0.75,
          axis: regenerate.axis,
          effort,
        });
        tokens_in += topicResult.tokens_in;
        tokens_out += topicResult.tokens_out;
        tokens_thinking += topicResult.tokens_thinking;
        structured_mode = topicResult.mode;
        latency_ms += topicResult.latencyMs;
        model = topicResult.model;
        tokens_by_call.push({
          call: `regen_correct:${regenerate.axis}`,
          tokens_in: topicResult.tokens_in,
          tokens_out: topicResult.tokens_out,
          tokens_thinking: topicResult.tokens_thinking,
          latency_ms: topicResult.latencyMs,
        });
        candidateTopics = previousTopics.map((t) =>
          t.axis === regenerate.axis
            ? syncFieldOrCorpus({
                ...topicResult.topic,
                axis: regenerate.axis,
                readings: undefined,
              })
            : t,
        );
        qc = qualityCheck(candidateTopics, profile, {
          rejectedTitles: regenerate.rejectedTitles,
          ...qcOpts,
        });
        violations = qc.violations;
        violations_after_correction = [
          ...new Set(violations.map((v) => v.code)),
        ];
        if (qc.violations.length) {
          const sanitized = sanitizeAfterFailedCorrection(
            candidateTopics,
            profile,
            { answers },
          );
          candidateTopics = applyHours(
            sanitized.map((t) =>
              t.axis === regenerate.axis
                ? { ...t, readings: undefined }
                : previousTopics.find((p) => p.axis === t.axis) || t,
            ),
          );
        }
      } catch {
        const sanitized = sanitizeAfterFailedCorrection(
          candidateTopics,
          profile,
          { answers },
        );
        candidateTopics = applyHours(
          sanitized.map((t) =>
            t.axis === regenerate.axis
              ? { ...t, readings: undefined }
              : previousTopics.find((p) => p.axis === t.axis) || t,
          ),
        );
        violations_after_correction = violations_first;
      }
    }

    return {
      topics: attachTopicWarnings(
        candidateTopics.map((t) =>
          t.axis === regenerate.axis
            ? { ...syncFieldOrCorpus(t), readings: undefined }
            : t,
        ),
        answers,
      ),
      model,
      tokens: tokens_in + tokens_out,
      tokens_in,
      tokens_out,
      tokens_thinking,
      structured_mode,
      simulated: false,
      profile_analysis: regenerate.profile_analysis,
      personalization_level,
      violations: [...new Set(violations.map((v) => v.code))],
      violations_first,
      violations_after_correction,
      attempts,
      latency_ms,
      tokens_by_call,
    };
  }

  // ——— Génération parallèle des 3 axes ———
  attempts = 1;
  const axes: TopicAxis[] = ["mastery", "ambition", "discovery"];
  const wallStart = Date.now();

  const axisResults = await Promise.all(
    axes.map(async (axis) => {
      const user = buildAxisUserPrompt({ profile, answers, axis });
      const result = await runProposeTopic({
        system,
        user,
        temperature: 0.6,
        axis,
        effort,
      });
      return { axis, result, user };
    }),
  );

  // Latence murale (parallèle) + somme tokens
  const wallMs = Date.now() - wallStart;
  latency_ms = wallMs;

  const byAxis: Partial<Record<TopicAxis, GeneratedTopic>> = {};
  let profile_analysis: ProfileAnalysis | undefined;
  let levelFromModel: "high" | "medium" | "low" | undefined;

  for (const { axis, result } of axisResults) {
    tokens_in += result.tokens_in;
    tokens_out += result.tokens_out;
    tokens_thinking += result.tokens_thinking;
    structured_mode = result.mode;
    model = result.model;
    tokens_by_call.push({
      call: `axis:${axis}`,
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
      tokens_thinking: result.tokens_thinking,
      latency_ms: result.latencyMs,
    });
    byAxis[axis] = { ...result.topic, axis, readings: undefined };
    if (axis === "mastery") {
      profile_analysis = result.profile_analysis;
      levelFromModel = result.personalization_level;
    }
  }

  let topics = mergeAxisTopics(byAxis);
  if (!profile_analysis) {
    profile_analysis = emptyAnalysis(
      completeness.missing.map((m) => m.label),
    );
  }

  let qc = qualityCheck(topics, profile, qcOpts);
  violations = qc.violations;
  let violations_first = [...new Set(violations.map((v) => v.code))];
  let violations_after_correction: string[] = [];

  // TOO_SIMILAR → régénérer discovery en priorité
  const similar = qc.violations.filter((v) => v.code === "TOO_SIMILAR");
  if (similar.length) {
    const avoid = topics.map((t) => ({
      axis: t.axis,
      title: t.title,
      research_object: t.research_object,
    }));
    const targetAxis: TopicAxis =
      similar.some((v) => v.axis === "discovery") ||
      similar.some((v) => v.detail.includes("discovery"))
        ? "discovery"
        : similar[0].axis || "discovery";
    const user = buildAxisUserPrompt({
      profile,
      answers,
      axis: targetAxis,
      avoidTopics: avoid.filter((t) => t.axis !== targetAxis),
    });
    try {
      const regen = await runProposeTopic({
        system,
        user,
        temperature: 0.7,
        axis: targetAxis,
        effort,
      });
      tokens_in += regen.tokens_in;
      tokens_out += regen.tokens_out;
      tokens_thinking += regen.tokens_thinking;
      latency_ms += regen.latencyMs;
      tokens_by_call.push({
        call: `similar:${targetAxis}`,
        tokens_in: regen.tokens_in,
        tokens_out: regen.tokens_out,
        tokens_thinking: regen.tokens_thinking,
        latency_ms: regen.latencyMs,
      });
      byAxis[targetAxis] = {
        ...regen.topic,
        axis: targetAxis,
        readings: undefined,
      };
      topics = mergeAxisTopics(byAxis);
      qc = qualityCheck(topics, profile, qcOpts);
      violations = qc.violations;
      violations_first = [...new Set(violations.map((v) => v.code))];
    } catch {
      // garde les sujets actuels
    }
  }

  // Contrôles en code + correction éventuelle
  if (qc.violations.length) {
    attempts = 2;
    const axesToFix = [
      ...new Set(
        qc.violations.map((v) => v.axis).filter(Boolean) as TopicAxis[],
      ),
    ];
    const targets = axesToFix.length ? axesToFix : axes;
    await Promise.all(
      targets.map(async (axis) => {
        const topic = topics.find((t) => t.axis === axis);
        if (!topic) return;
        const axisViolations = qc.violations.filter(
          (v) => !v.axis || v.axis === axis,
        );
        if (!axisViolations.length) return;
        const baseUser = buildAxisUserPrompt({ profile, answers, axis });
        const correctionUser = buildCorrectionUserPrompt({
          baseUserPrompt: baseUser,
          previousOutput: { topic },
          violationListFr: formatViolationsForCorrection(axisViolations),
        });
        try {
          const corrected = await runProposeTopic({
            system,
            user: correctionUser,
            temperature: 0.6,
            axis,
            effort,
          });
          tokens_in += corrected.tokens_in;
          tokens_out += corrected.tokens_out;
          tokens_thinking += corrected.tokens_thinking;
          latency_ms += corrected.latencyMs;
          tokens_by_call.push({
            call: `correct:${axis}`,
            tokens_in: corrected.tokens_in,
            tokens_out: corrected.tokens_out,
            tokens_thinking: corrected.tokens_thinking,
            latency_ms: corrected.latencyMs,
          });
          byAxis[axis] = {
            ...corrected.topic,
            axis,
            readings: undefined,
          };
          if (axis === "mastery" && corrected.profile_analysis) {
            profile_analysis = corrected.profile_analysis;
          }
        } catch {
          // conserve l'axe
        }
      }),
    );
    topics = mergeAxisTopics(byAxis);
    qc = qualityCheck(topics, profile, qcOpts);
    violations = qc.violations;
    violations_after_correction = [...new Set(violations.map((v) => v.code))];
    if (qc.violations.length) {
      topics = applyHours(
        withoutReadings(
          sanitizeAfterFailedCorrection(topics, profile, { answers }),
        ),
      );
    }
  }

  // Relecteur critique (retry interne) — corrections d'axes en parallèle
  {
    const review = await reviewTopics({ topics, profile, answers });
    tokens_in += review.tokens_in;
    tokens_out += review.tokens_out;
    tokens_thinking += review.tokens_thinking;
    latency_ms += review.latency_ms;
    tokens_by_call.push({
      call: "review",
      tokens_in: review.tokens_in,
      tokens_out: review.tokens_out,
      tokens_thinking: review.tokens_thinking,
      latency_ms: review.latency_ms,
    });
    review_status = review.status;

    if (review.status === "failed") {
      review_issues_first = [];
      console.info(
        JSON.stringify({
          event: "topics.review_failed",
          error_code: review.error_code || "unknown",
          error_path: review.error_path || null,
        }),
      );
    } else {
      review_issues_first = review.issues;

      if (review.blocking.length) {
        attempts = Math.max(attempts, 2);
        const axesBlocking = [
          ...new Set(review.blocking.map((i) => i.axis)),
        ];
        await Promise.all(
          axesBlocking.map(async (axis) => {
            const topic = topics.find((t) => t.axis === axis);
            if (!topic) return;
            const issues = review.blocking.filter((i) => i.axis === axis);
            const baseUser = buildAxisUserPrompt({ profile, answers, axis });
            const correctionUser = buildCorrectionUserPrompt({
              baseUserPrompt: baseUser,
              previousOutput: { topic },
              violationListFr: formatReviewIssuesForCorrection(issues),
            });
            try {
              const corrected = await runProposeTopic({
                system,
                user: correctionUser,
                temperature: 0.6,
                axis,
                effort,
              });
              tokens_in += corrected.tokens_in;
              tokens_out += corrected.tokens_out;
              tokens_thinking += corrected.tokens_thinking;
              latency_ms += corrected.latencyMs;
              tokens_by_call.push({
                call: `review_correct:${axis}`,
                tokens_in: corrected.tokens_in,
                tokens_out: corrected.tokens_out,
                tokens_thinking: corrected.tokens_thinking,
                latency_ms: corrected.latencyMs,
              });
              byAxis[axis] = {
                ...corrected.topic,
                axis,
                readings: undefined,
              };
            } catch {
              // conserve
            }
          }),
        );
        topics = mergeAxisTopics(byAxis);
        // Relance contrôles en code seulement (pas le relecteur une 2e fois)
        qc = qualityCheck(topics, profile, qcOpts);
        violations = qc.violations;
        violations_after_correction = [
          ...new Set(violations.map((v) => v.code)),
        ];
        if (qc.violations.length) {
          topics = applyHours(
            withoutReadings(
              sanitizeAfterFailedCorrection(topics, profile, { answers }),
            ),
          );
        }
        review_issues_after_correction = [];
      }
    }
  }

  const finalTopics = attachTopicWarnings(withoutReadings(topics), answers);
  const finalQc = qualityCheck(finalTopics, profile, qcOpts);
  violations = finalQc.violations;
  if (attempts >= 2) {
    violations_after_correction = [
      ...new Set(violations.map((v) => v.code)),
    ];
  }

  return {
    topics: finalTopics,
    model,
    tokens: tokens_in + tokens_out,
    tokens_in,
    tokens_out,
    tokens_thinking,
    structured_mode,
    simulated: false,
    profile_analysis,
    personalization_level: levelFromModel || personalization_level,
    violations: [...new Set(violations.map((v) => v.code))],
    violations_first,
    violations_after_correction,
    review_status,
    review_issues_first: review_issues_first.map((i) => ({
      axis: i.axis,
      code: i.code,
      severity: i.severity,
      explanation: i.explanation,
    })),
    review_issues_after_correction: review_issues_after_correction.map(
      (i) => ({
        axis: i.axis,
        code: i.code,
        severity: i.severity,
        explanation: i.explanation,
      }),
    ),
    attempts,
    latency_ms,
    tokens_by_call,
  };
}
