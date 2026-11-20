import { simulateTopics } from "./simulateContent";
import {
  attachTopicWarnings,
  qualityCheck,
} from "./qualityCheck";
import {
  buildProfile,
  ensureLlmReady,
  resolveSimilarity,
  runAxisPipeline,
  type GenerateEffort,
} from "./generateAxis";
import {
  createTopicsJob,
  getTopicsJob,
  setAxisState,
  updateTopicsJob,
  type TopicsJob,
} from "./topicsJobs";
import { issueTicket } from "./generationTicket";
import type {
  GeneratedTopic,
  ProfileAnalysis,
  TopicAxis,
} from "../../../../shared/research/topicTypes";
import { estimateFieldworkHours } from "../../../../shared/research/fieldworkCosts";
import { planTopicAngles, type AnglePlanItem } from "./planAngles";
import { reviewTopics } from "./reviewTopics";
import {
  enforceTopicLimits,
  logTruncationSuspects,
} from "./textLimits";

const AXES: TopicAxis[] = ["mastery", "ambition", "discovery"];

function withoutReadings(topic: GeneratedTopic): GeneratedTopic {
  const { readings: _r, ...t } = topic;
  return {
    ...t,
    estimated_hours: estimateFieldworkHours(t.fieldwork_plan || []),
  };
}

/**
 * Démarre un job de génération progressive (3 axes en parallèle).
 * Retourne immédiatement le job ; le ticket est émis à la fin.
 */
export function startTopicsGenerateJob(params: {
  uid: string;
  answers: Record<string, unknown>;
  env: Record<string, string>;
  simulate?: boolean;
  effort?: GenerateEffort;
  onQuotaRelease?: () => void;
}): TopicsJob {
  const job = createTopicsJob(params.uid);
  void runJob(job.id, params).catch((err) => {
    const code = err instanceof Error ? err.message.slice(0, 80) : "unknown";
    updateTopicsJob(job.id, {
      status: "error",
      error_code: code.replace(/\s+/g, " "),
      finishedAt: Date.now(),
    });
    params.onQuotaRelease?.();
    console.info(
      JSON.stringify({
        event: "topics.job",
        status: "error",
        job_id: job.id.slice(0, 8),
        code: "job_failed",
      }),
    );
  });
  return job;
}

async function runJob(
  jobId: string,
  params: {
    uid: string;
    answers: Record<string, unknown>;
    env: Record<string, string>;
    simulate?: boolean;
    effort?: GenerateEffort;
    onQuotaRelease?: () => void;
  },
): Promise<void> {
  const started = Date.now();
  const { answers, env, uid } = params;

  if (params.simulate) {
    const topics = attachTopicWarnings(
      simulateTopics(answers).map(withoutReadings),
      answers,
    );
    for (const t of topics) {
      setAxisState(jobId, t.axis, {
        status: "done",
        topic: t,
        ready_at_ms: Date.now(),
        review_status: "ok",
        review_issues: [],
        violations_first: [],
        violations_after: [],
        latency_ms: 0,
      });
    }
    const ticket = issueTicket(
      uid,
      env,
      { topics, rejectedTitles: [], profile_analysis: undefined },
      3,
    );
    updateTopicsJob(jobId, {
      status: "done",
      finishedAt: Date.now(),
      ticket,
      regenerationsRemaining: 3,
      simulated: true,
      model: "simulation",
      personalization_level: "low",
      review_status: "ok",
      review_issues_first: [],
      blocking_corrections: [],
      latency_ms: Date.now() - started,
    });
    // Simulation : quota non réservé (simulate) — rien à libérer.
    return;
  }

  await ensureLlmReady(env);
  const { profile, completeness } = buildProfile(answers);

  let anglePlan: AnglePlanItem[] | undefined;
  let tokens_in = 0;
  let tokens_out = 0;
  let tokens_thinking = 0;
  let model: string | undefined;

  try {
    const plan = await planTopicAngles({ profile, answers });
    anglePlan = plan.angles;
    tokens_in += plan.tokens_in;
    tokens_out += plan.tokens_out;
    tokens_thinking += plan.tokens_thinking;
    model = plan.model;
  } catch (err) {
    const code =
      err instanceof Error
        ? err.message.slice(0, 80).replace(/\s+/g, " ")
        : "angle_plan_error";
    console.info(
      JSON.stringify({
        event: "topics.angle_plan",
        status: "error",
        code,
      }),
    );
    // Poursuite sans plan imposé si l'étape échoue.
  }

  const angleByAxis = new Map(
    (anglePlan || []).map((a) => [a.axis, a] as const),
  );

  const results = await Promise.all(
    AXES.map(async (axis) => {
      try {
        const own = angleByAxis.get(axis);
        const others = (anglePlan || []).filter((a) => a.axis !== axis);
        const result = await runAxisPipeline({
          axis,
          answers,
          profile,
          effort: params.effort,
          anglePlan: own,
          otherAngles: others.length ? others : undefined,
        });
        setAxisState(jobId, axis, {
          status: "done",
          topic: withoutReadings(result.topic),
          ready_at_ms: Date.now(),
          review_status: result.review_status,
          review_issues: result.review_issues,
          violations_first: result.violations_first,
          violations_after: result.violations_after,
          latency_ms: result.latency_ms,
        });
        return { axis, result, ok: true as const };
      } catch (err) {
        const code =
          err instanceof Error
            ? err.message.slice(0, 80).replace(/\s+/g, " ")
            : "axis_error";
        setAxisState(jobId, axis, {
          status: "error",
          error_code: code,
          ready_at_ms: Date.now(),
        });
        console.info(
          JSON.stringify({
            event: "topics.axis",
            status: "error",
            axis,
            code,
          }),
        );
        return { axis, ok: false as const, error_code: code };
      }
    }),
  );

  const job = getTopicsJob(jobId, uid);
  if (!job) {
    params.onQuotaRelease?.();
    return;
  }

  const okResults = results.filter((r) => r.ok);
  if (okResults.length < 3) {
    updateTopicsJob(jobId, {
      status: "error",
      finishedAt: Date.now(),
      error_code: "axis_incomplete",
      latency_ms: Date.now() - started,
    });
    params.onQuotaRelease?.(); // libère le quota
    return;
  }

  let topics = AXES.map((a) => job.axes[a].topic!).filter(Boolean);
  const blocking_corrections = okResults.flatMap((r) =>
    r.ok ? r.result.blocking_corrections : [],
  );
  const review_issues_first = okResults.flatMap((r) =>
    r.ok ? r.result.review_issues : [],
  );
  let review_status = okResults.every(
    (r) => r.ok && r.result.review_status === "ok",
  )
    ? ("ok" as const)
    : ("failed" as const);

  for (const r of okResults) {
    if (!r.ok) continue;
    tokens_in += r.result.tokens_in;
    tokens_out += r.result.tokens_out;
    tokens_thinking += r.result.tokens_thinking;
    model = r.result.model;
  }

  const mastery = okResults.find((r) => r.ok && r.axis === "mastery");
  let profile_analysis: ProfileAnalysis | undefined =
    mastery && mastery.ok ? mastery.result.profile_analysis : undefined;
  let personalization_level =
    (mastery && mastery.ok
      ? mastery.result.personalization_level
      : undefined) || completeness.level;

  // Relecture croisée (OVERLAP) sur les 3 sujets
  try {
    const cross = await reviewTopics({ topics, profile, answers });
    tokens_in += cross.tokens_in;
    tokens_out += cross.tokens_out;
    tokens_thinking += cross.tokens_thinking;
    if (cross.status === "failed") review_status = "failed";
    const overlapIssues = cross.blocking.filter((i) => i.code === "OVERLAP");
    review_issues_first.push(...overlapIssues);
    if (overlapIssues.length) {
      const target =
        overlapIssues[0].axis ||
        ("discovery" as TopicAxis);
      const avoid = topics
        .filter((t) => t.axis !== target)
        .map((t) => ({
          axis: t.axis,
          title: t.title,
          research_object: t.research_object,
        }));
      const own = angleByAxis.get(target);
      const others = (anglePlan || []).filter((a) => a.axis !== target);
      const regen = await runAxisPipeline({
        axis: target,
        answers,
        profile,
        effort: params.effort,
        avoidTopics: avoid,
        anglePlan: own,
        otherAngles: others.length ? others : undefined,
      });
      tokens_in += regen.tokens_in;
      tokens_out += regen.tokens_out;
      tokens_thinking += regen.tokens_thinking;
      model = regen.model;
      setAxisState(jobId, target, {
        status: "done",
        topic: withoutReadings(regen.topic),
        ready_at_ms: Date.now(),
        review_status: regen.review_status,
        review_issues: regen.review_issues,
        violations_first: regen.violations_first,
        violations_after: regen.violations_after,
        latency_ms: regen.latency_ms,
      });
      blocking_corrections.push(
        ...overlapIssues.map((issue) => ({
          axis: target,
          code: issue.code,
          severity: issue.severity,
          explanation: issue.explanation,
          before: {
            hypotheses: topics.find((t) => t.axis === target)?.hypotheses || [],
            method: topics.find((t) => t.axis === target)?.method || "",
            field_or_corpus:
              topics.find((t) => t.axis === target)?.field_or_corpus || "",
            hypothesis_tests:
              topics.find((t) => t.axis === target)?.hypothesis_tests || [],
          },
          after: {
            hypotheses: regen.topic.hypotheses || [],
            method: regen.topic.method || "",
            field_or_corpus: regen.topic.field_or_corpus || "",
            hypothesis_tests: regen.topic.hypothesis_tests || [],
          },
        })),
        ...regen.blocking_corrections,
      );
      review_issues_first.push(...regen.review_issues);
      if (regen.review_status === "failed") review_status = "failed";
      const refreshed = getTopicsJob(jobId, uid);
      if (refreshed) {
        topics = AXES.map((a) => refreshed.axes[a].topic!).filter(Boolean);
      }
    }
  } catch {
    // ignore échec relecture croisée
  }

  // TOO_SIMILAR à la fin
  const sim = resolveSimilarity(topics, profile, answers);
  if (sim.similar && sim.target) {
    const avoid = topics
      .filter((t) => t.axis !== sim.target)
      .map((t) => ({
        axis: t.axis,
        title: t.title,
        research_object: t.research_object,
      }));
    try {
      const own = angleByAxis.get(sim.target);
      const others = (anglePlan || []).filter((a) => a.axis !== sim.target);
      const regen = await runAxisPipeline({
        axis: sim.target,
        answers,
        profile,
        effort: params.effort,
        avoidTopics: avoid,
        anglePlan: own,
        otherAngles: others.length ? others : undefined,
      });
      tokens_in += regen.tokens_in;
      tokens_out += regen.tokens_out;
      tokens_thinking += regen.tokens_thinking;
      model = regen.model;
      setAxisState(jobId, sim.target, {
        status: "done",
        topic: withoutReadings(regen.topic),
        ready_at_ms: Date.now(),
        review_status: regen.review_status,
        review_issues: regen.review_issues,
        violations_first: regen.violations_first,
        violations_after: regen.violations_after,
        latency_ms: regen.latency_ms,
      });
      blocking_corrections.push(...regen.blocking_corrections);
      review_issues_first.push(...regen.review_issues);
      if (regen.review_status === "failed") review_status = "failed";
      const refreshed = getTopicsJob(jobId, uid);
      if (refreshed) {
        topics = AXES.map((a) => refreshed.axes[a].topic!).filter(Boolean);
      }
    } catch {
      // garde les sujets actuels
    }
  }

  topics = attachTopicWarnings(topics, answers).map(enforceTopicLimits);
  logTruncationSuspects(topics);
  for (const t of topics) {
    setAxisState(jobId, t.axis, { topic: withoutReadings(t) });
  }

  // Contrôle final (métadonnées)
  void qualityCheck(topics, profile, { answers });

  const ticket = issueTicket(
    uid,
    env,
    {
      topics,
      rejectedTitles: [],
      profile_analysis,
    },
    3,
  );

  const finished = Date.now();
  updateTopicsJob(jobId, {
    status: "done",
    finishedAt: finished,
    ticket,
    regenerationsRemaining: 3,
    profile_analysis,
    personalization_level,
    model,
    simulated: false,
    review_status,
    review_issues_first,
    blocking_corrections,
    tokens_in,
    tokens_out,
    tokens_thinking,
    latency_ms: finished - started,
    angle_plan: anglePlan,
  });

  // Succès : ne pas libérer le quota (analyse consommée).

  console.info(
    JSON.stringify({
      event: "topics.generate",
      uidPseudo: uid.slice(0, 8),
      status: "ok",
      at: new Date().toISOString(),
      job_id: jobId.slice(0, 8),
      model: model || null,
      tokens_in,
      tokens_out,
      tokens_thinking,
      latency_ms: finished - started,
      first_ready_ms: getTopicsJob(jobId, uid)?.first_ready_ms ?? null,
      last_ready_ms: getTopicsJob(jobId, uid)?.last_ready_ms ?? null,
      review_status,
      review_blocking: review_issues_first.filter((i) => i.severity === "blocking")
        .length,
      review_minor: review_issues_first.filter((i) => i.severity === "minor")
        .length,
      personalization_level: personalization_level ?? null,
      simulated: false,
    }),
  );
}
