import { simulateTopics } from "./simulateContent";
import {
  attachRemainingDefectWarnings,
  attachTopicWarnings,
  attachUncorrectedReviewWarnings,
  qualityCheck,
} from "./qualityCheck";
import {
  buildProfile,
  ensureLlmReady,
  patchCrossBlockingAxis,
  resolveSimilarity,
  runAxisPipeline,
  type AxisPipelineResult,
  type AxisTiming,
  type GenerateEffort,
} from "./generateAxis";
import {
  createTopicsJob,
  getTopicsJob,
  setAxisState,
  updateTopicsJob,
  type TopicsJob,
} from "./topicsJobs";
import {
  consumeRegen,
  issueTicket,
} from "./generationTicket";
import type {
  GeneratedTopic,
  ProfileAnalysis,
  RegenReason,
  TopicAxis,
} from "../../../../shared/research/topicTypes";
import { estimateFieldworkHours } from "../../../../shared/research/fieldworkCosts";
import {
  planOneAxisAngle,
  planTopicAngles,
  type AnglePlanItem,
} from "./planAngles";
import {
  attachFeasibilityRisksFromReview,
  reviewTopics,
} from "./reviewTopics";
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

function logAxisTiming(
  axis: TopicAxis,
  parts: {
    angle_plan_ms: number;
    generate_ms: number;
    quality_check_ms: number;
    review_ms: number;
    correction_ms: number;
    cross_review_ms: number;
  },
): void {
  console.info(
    JSON.stringify({
      event: "topics.timing",
      axis,
      angle_plan_ms: parts.angle_plan_ms,
      generate_ms: parts.generate_ms,
      quality_check_ms: parts.quality_check_ms,
      review_ms: parts.review_ms,
      correction_ms: parts.correction_ms,
      cross_review_ms: parts.cross_review_ms,
    }),
  );
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
  let angle_plan_ms = 0;

  try {
    const plan = await planTopicAngles({ profile, answers });
    anglePlan = plan.angles;
    angle_plan_ms = plan.latency_ms;
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
  const timingByAxis = new Map<TopicAxis, AxisTiming>();

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
        timingByAxis.set(axis, result.timing);
        setAxisState(jobId, axis, {
          status: "done",
          topic: withoutReadings(result.topic),
          ready_at_ms: Date.now(),
          review_status: result.review_status,
          review_issues: result.review_issues,
          violations_first: result.violations_first,
          violations_after: result.violations_after,
          latency_ms: result.latency_ms,
          timing: result.timing,
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

  // Relecture croisée : bloquants (OVERLAP, ETHICS…) → 1 correction ciblée / axe
  let cross_review_ms = 0;
  try {
    const crossStarted = Date.now();
    const cross = await reviewTopics({ topics, profile, answers });
    cross_review_ms = Date.now() - crossStarted;
    tokens_in += cross.tokens_in;
    tokens_out += cross.tokens_out;
    tokens_thinking += cross.tokens_thinking;
    if (cross.status === "failed") review_status = "failed";
    review_issues_first.push(
      ...cross.issues.filter(
        (i) =>
          i.code === "OVERLAP" ||
          i.code === "FEASIBILITY_RISK" ||
          (i.severity === "blocking" &&
            !review_issues_first.some(
              (x) => x.axis === i.axis && x.code === i.code,
            )),
      ),
    );
    topics = attachFeasibilityRisksFromReview(topics, cross.minor);

    const blockingByAxis = new Map<TopicAxis, typeof cross.blocking>();
    for (const issue of cross.blocking) {
      const a = (issue.axis || "") as TopicAxis;
      if (!AXES.includes(a)) continue;
      const list = blockingByAxis.get(a) || [];
      list.push(issue);
      blockingByAxis.set(a, list);
    }
    for (const target of AXES) {
      const axisIssues = blockingByAxis.get(target);
      if (!axisIssues?.length) continue;
      const own = angleByAxis.get(target);
      const others = (anglePlan || []).filter((a) => a.axis !== target);
      const current = topics.find((t) => t.axis === target);
      if (!current) continue;
      const patch = await patchCrossBlockingAxis({
        axis: target,
        topic: current,
        otherTopics: topics.filter((t) => t.axis !== target),
        issues: axisIssues.map((i) => ({
          code: i.code,
          explanation: i.explanation,
          severity: i.severity,
        })),
        answers,
        profile,
        effort: params.effort,
        anglePlan: own,
        otherAngles: others.length ? others : undefined,
      });
      tokens_in += patch.tokens_in;
      tokens_out += patch.tokens_out;
      tokens_thinking += patch.tokens_thinking;
      model = patch.model;
      const prevTiming = timingByAxis.get(target);
      timingByAxis.set(target, {
        generate_ms:
          (prevTiming?.generate_ms ?? 0) + patch.timing.generate_ms,
        quality_check_ms:
          (prevTiming?.quality_check_ms ?? 0) + patch.timing.quality_check_ms,
        review_ms: (prevTiming?.review_ms ?? 0) + patch.timing.review_ms,
        correction_ms:
          (prevTiming?.correction_ms ?? 0) + patch.timing.correction_ms,
      });
      setAxisState(jobId, target, {
        status: "done",
        topic: withoutReadings(patch.topic),
        ready_at_ms: Date.now(),
        review_status: patch.review_status,
        review_issues: patch.review_issues,
        violations_first: patch.violations_first,
        violations_after: patch.violations_after,
        latency_ms: patch.latency_ms,
        timing: timingByAxis.get(target),
      });
      blocking_corrections.push(...patch.blocking_corrections);
      review_issues_first.push(...patch.review_issues);
      if (patch.review_status === "failed") review_status = "failed";
      console.info(
        JSON.stringify({
          event: "topics.cross_blocking_patch",
          axis: target,
          codes: axisIssues.map((i) => i.code),
          used_full_regen: patch.used_full_regen,
        }),
      );
      const refreshed = getTopicsJob(jobId, uid);
      if (refreshed) {
        topics = AXES.map((a) => refreshed.axes[a].topic!).filter(Boolean);
      }
    }
  } catch {
    // ignore échec relecture croisée
  }

  for (const axis of AXES) {
    const t = timingByAxis.get(axis);
    logAxisTiming(axis, {
      angle_plan_ms,
      generate_ms: t?.generate_ms ?? 0,
      quality_check_ms: t?.quality_check_ms ?? 0,
      review_ms: t?.review_ms ?? 0,
      correction_ms: t?.correction_ms ?? 0,
      cross_review_ms,
    });
  }
  updateTopicsJob(jobId, {
    timing_shared: { angle_plan_ms, cross_review_ms },
  });

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
  const finalQc = qualityCheck(topics, profile, { answers });
  topics = attachRemainingDefectWarnings(topics, finalQc.violations);
  topics = attachUncorrectedReviewWarnings(topics, blocking_corrections);
  logTruncationSuspects(topics);
  for (const t of topics) {
    setAxisState(jobId, t.axis, { topic: withoutReadings(t) });
  }

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

/**
 * Régénération d'un axe via le même chemin que la génération :
 * nouvel angle → pipeline axe → contrôles/relecture → OVERLAP croisé.
 */
export function startTopicsRegenJob(params: {
  uid: string;
  answers: Record<string, unknown>;
  env: Record<string, string>;
  axis: TopicAxis;
  reason: RegenReason;
  previousTopics: GeneratedTopic[];
  rejectedTitles: string[];
  previousTitle?: string;
  profile_analysis?: ProfileAnalysis;
  ticket: string;
  simulate?: boolean;
  effort?: GenerateEffort;
}): TopicsJob {
  const job = createTopicsJob(params.uid);
  // Les deux axes conservés sont déjà prêts.
  for (const t of params.previousTopics) {
    if (t.axis === params.axis) continue;
    setAxisState(job.id, t.axis, {
      status: "done",
      topic: withoutReadings(t),
      ready_at_ms: Date.now(),
      review_status: "ok",
      review_issues: [],
      violations_first: [],
      violations_after: [],
      latency_ms: 0,
    });
  }
  void runRegenJob(job.id, params).catch((err) => {
    const code = err instanceof Error ? err.message.slice(0, 80) : "unknown";
    updateTopicsJob(job.id, {
      status: "error",
      error_code: code.replace(/\s+/g, " "),
      finishedAt: Date.now(),
    });
    setAxisState(job.id, params.axis, {
      status: "error",
      error_code: code.replace(/\s+/g, " "),
      ready_at_ms: Date.now(),
    });
    console.info(
      JSON.stringify({
        event: "topics.regenerate",
        status: "error",
        job_id: job.id.slice(0, 8),
        axis: params.axis,
        code: "job_failed",
      }),
    );
  });
  return job;
}

async function runRegenJob(
  jobId: string,
  params: {
    uid: string;
    answers: Record<string, unknown>;
    env: Record<string, string>;
    axis: TopicAxis;
    reason: RegenReason;
    previousTopics: GeneratedTopic[];
    rejectedTitles: string[];
    previousTitle?: string;
    profile_analysis?: ProfileAnalysis;
    ticket: string;
    simulate?: boolean;
    effort?: GenerateEffort;
  },
): Promise<void> {
  const started = Date.now();
  const { answers, env, uid, axis } = params;

  if (params.simulate) {
    const sim = simulateTopics(answers);
    const replacement =
      sim.find((t) => t.axis === axis) ||
      params.previousTopics.find((t) => t.axis === axis)!;
    const topics = attachTopicWarnings(
      params.previousTopics.map((t) =>
        t.axis === axis ? withoutReadings(replacement) : withoutReadings(t),
      ),
      answers,
    );
    for (const t of topics) {
      setAxisState(jobId, t.axis, {
        status: "done",
        topic: t,
        ready_at_ms: Date.now(),
      });
    }
    const { nextToken, payload } = consumeRegen(params.ticket, uid, env, {
      topics,
      rejectedTitles: params.rejectedTitles,
      profile_analysis: params.profile_analysis,
    });
    updateTopicsJob(jobId, {
      status: "done",
      finishedAt: Date.now(),
      ticket: nextToken,
      regenerationsRemaining: payload.rem,
      simulated: true,
      model: "simulation",
      profile_analysis: params.profile_analysis,
      review_status: "ok",
      review_issues_first: [],
      blocking_corrections: [],
      latency_ms: Date.now() - started,
    });
    return;
  }

  await ensureLlmReady(env);
  const { profile, completeness } = buildProfile(answers);

  let tokens_in = 0;
  let tokens_out = 0;
  let tokens_thinking = 0;
  let model: string | undefined;
  let angle_plan_ms = 0;
  let anglePlan: AnglePlanItem | undefined;
  const reservedObjects = params.previousTopics
    .filter((t) => t.axis !== axis)
    .map((t) => ({
      axis: t.axis,
      research_object: t.research_object || t.title,
    }));

  try {
    const plan = await planOneAxisAngle({
      profile,
      answers,
      axis,
      reservedObjects,
      rejectedTitles: params.rejectedTitles,
    });
    anglePlan = plan.angle;
    angle_plan_ms = plan.latency_ms;
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
        mode: "regen",
        axis,
        code,
      }),
    );
  }

  const avoid = params.previousTopics
    .filter((t) => t.axis !== axis)
    .map((t) => ({
      axis: t.axis,
      title: t.title,
      research_object: t.research_object,
    }));

  const otherAngles: AnglePlanItem[] = reservedObjects.map((r) => ({
    axis: r.axis,
    research_object: r.research_object,
    material: "(conservé)",
    angle: "(conservé)",
  }));

  let result: AxisPipelineResult;
  try {
    result = await runAxisPipeline({
      axis,
      answers,
      profile,
      effort: params.effort,
      avoidTopics: avoid,
      anglePlan,
      otherAngles,
      regen: {
        reason: params.reason,
        previousTitle: params.previousTitle,
        rejectedTitles: params.rejectedTitles,
      },
    });
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
    updateTopicsJob(jobId, {
      status: "error",
      error_code: code,
      finishedAt: Date.now(),
      latency_ms: Date.now() - started,
    });
    throw err;
  }

  tokens_in += result.tokens_in;
  tokens_out += result.tokens_out;
  tokens_thinking += result.tokens_thinking;
  model = result.model;

  setAxisState(jobId, axis, {
    status: "done",
    topic: withoutReadings(result.topic),
    ready_at_ms: Date.now(),
    review_status: result.review_status,
    review_issues: result.review_issues,
    violations_first: result.violations_first,
    violations_after: result.violations_after,
    latency_ms: result.latency_ms,
    timing: result.timing,
  });

  let topics = params.previousTopics.map((t) =>
    t.axis === axis ? withoutReadings(result.topic) : withoutReadings(t),
  );
  const blocking_corrections = [...result.blocking_corrections];
  const review_issues_first = [...result.review_issues];
  let review_status = result.review_status;

  let cross_review_ms = 0;
  try {
    const crossStarted = Date.now();
    const cross = await reviewTopics({ topics, profile, answers });
    cross_review_ms = Date.now() - crossStarted;
    tokens_in += cross.tokens_in;
    tokens_out += cross.tokens_out;
    tokens_thinking += cross.tokens_thinking;
    if (cross.status === "failed") review_status = "failed";
    topics = attachFeasibilityRisksFromReview(topics, cross.minor);
    review_issues_first.push(
      ...cross.issues.filter(
        (i) =>
          i.code === "OVERLAP" ||
          (i.severity === "blocking" &&
            !review_issues_first.some(
              (x) => x.axis === i.axis && x.code === i.code,
            )),
      ),
    );

    const blockingByAxis = new Map<TopicAxis, typeof cross.blocking>();
    for (const issue of cross.blocking) {
      const a = (issue.axis || "") as TopicAxis;
      if (!AXES.includes(a)) continue;
      const list = blockingByAxis.get(a) || [];
      list.push(issue);
      blockingByAxis.set(a, list);
    }
    for (const target of AXES) {
      const axisIssues = blockingByAxis.get(target);
      if (!axisIssues?.length) continue;
      const current = topics.find((t) => t.axis === target);
      if (!current) continue;
      const patch = await patchCrossBlockingAxis({
        axis: target,
        topic: current,
        otherTopics: topics.filter((t) => t.axis !== target),
        issues: axisIssues.map((i) => ({
          code: i.code,
          explanation: i.explanation,
          severity: i.severity,
        })),
        answers,
        profile,
        effort: params.effort,
        anglePlan: target === axis ? anglePlan : undefined,
        otherAngles,
      });
      tokens_in += patch.tokens_in;
      tokens_out += patch.tokens_out;
      tokens_thinking += patch.tokens_thinking;
      model = patch.model;
      setAxisState(jobId, target, {
        status: "done",
        topic: withoutReadings(patch.topic),
        ready_at_ms: Date.now(),
        review_status: patch.review_status,
        review_issues: patch.review_issues,
        violations_first: patch.violations_first,
        violations_after: patch.violations_after,
        latency_ms: patch.latency_ms,
        timing: {
          generate_ms:
            (result.timing.generate_ms || 0) + patch.timing.generate_ms,
          quality_check_ms:
            (result.timing.quality_check_ms || 0) +
            patch.timing.quality_check_ms,
          review_ms: (result.timing.review_ms || 0) + patch.timing.review_ms,
          correction_ms:
            (result.timing.correction_ms || 0) + patch.timing.correction_ms,
        },
      });
      blocking_corrections.push(...patch.blocking_corrections);
      review_issues_first.push(...patch.review_issues);
      if (patch.review_status === "failed") review_status = "failed";
      topics = topics.map((t) =>
        t.axis === target ? withoutReadings(patch.topic) : t,
      );
      if (target === axis) {
        result = {
          ...result,
          timing: {
            generate_ms:
              result.timing.generate_ms + patch.timing.generate_ms,
            quality_check_ms:
              result.timing.quality_check_ms + patch.timing.quality_check_ms,
            review_ms: result.timing.review_ms + patch.timing.review_ms,
            correction_ms:
              result.timing.correction_ms + patch.timing.correction_ms,
          },
        };
      }
      console.info(
        JSON.stringify({
          event: "topics.cross_blocking_patch",
          axis: target,
          codes: axisIssues.map((i) => i.code),
          used_full_regen: patch.used_full_regen,
          mode: "regen",
        }),
      );
    }
  } catch {
    // ignore
  }

  logAxisTiming(axis, {
    angle_plan_ms,
    generate_ms: result.timing.generate_ms,
    quality_check_ms: result.timing.quality_check_ms,
    review_ms: result.timing.review_ms,
    correction_ms: result.timing.correction_ms,
    cross_review_ms,
  });
  updateTopicsJob(jobId, {
    timing_shared: { angle_plan_ms, cross_review_ms },
  });

  topics = attachTopicWarnings(topics, answers).map(enforceTopicLimits);
  const finalQc = qualityCheck(topics, profile, { answers });
  topics = attachRemainingDefectWarnings(topics, finalQc.violations);
  topics = attachUncorrectedReviewWarnings(topics, blocking_corrections);
  logTruncationSuspects(topics);
  for (const t of topics) {
    setAxisState(jobId, t.axis, { topic: withoutReadings(t) });
  }

  const { nextToken, payload } = consumeRegen(params.ticket, uid, env, {
    topics,
    rejectedTitles: params.rejectedTitles,
    profile_analysis:
      result.profile_analysis || params.profile_analysis,
  });

  const finished = Date.now();
  updateTopicsJob(jobId, {
    status: "done",
    finishedAt: finished,
    ticket: nextToken,
    regenerationsRemaining: payload.rem,
    profile_analysis:
      result.profile_analysis || params.profile_analysis,
    personalization_level:
      result.personalization_level || completeness.level,
    model,
    simulated: false,
    review_status,
    review_issues_first,
    blocking_corrections,
    tokens_in,
    tokens_out,
    tokens_thinking,
    latency_ms: finished - started,
    angle_plan: anglePlan ? [anglePlan, ...otherAngles] : otherAngles,
  });

  console.info(
    JSON.stringify({
      event: "topics.regenerate",
      uidPseudo: uid.slice(0, 8),
      status: "ok",
      at: new Date().toISOString(),
      job_id: jobId.slice(0, 8),
      axis,
      rem: payload.rem,
      model: model || null,
      tokens_in,
      tokens_out,
      tokens_thinking,
      latency_ms: finished - started,
      review_status,
      simulated: false,
    }),
  );
}
