import { randomUUID } from "node:crypto";
import type {
  GeneratedTopic,
  ProfileAnalysis,
  TopicAxis,
} from "../../../../shared/research/topicTypes";
import type { ReviewIssue, ReviewStatus } from "./reviewTopics";
import type { AnglePlanItem } from "./planAngles";

const TTL_MS = 10 * 60 * 1000;

export type AxisJobStatus = "pending" | "done" | "error";

export type BlockingCorrectionTrace = {
  axis: TopicAxis;
  code: string;
  severity: string;
  explanation: string;
  before: {
    hypotheses: string[];
    method: string;
    field_or_corpus: string;
    hypothesis_tests: GeneratedTopic["hypothesis_tests"];
  };
  after: {
    hypotheses: string[];
    method: string;
    field_or_corpus: string;
    hypothesis_tests: GeneratedTopic["hypothesis_tests"];
  };
};

export type TopicsJobAxisState = {
  status: AxisJobStatus;
  topic?: GeneratedTopic;
  error_code?: string;
  review_issues?: ReviewIssue[];
  violations_first?: string[];
  violations_after?: string[];
  review_status?: ReviewStatus;
  latency_ms?: number;
  ready_at_ms?: number;
};

export type TopicsJob = {
  id: string;
  uid: string;
  createdAt: number;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "done" | "error";
  axes: Record<TopicAxis, TopicsJobAxisState>;
  profile_analysis?: ProfileAnalysis;
  personalization_level?: "high" | "medium" | "low";
  ticket?: string;
  regenerationsRemaining?: number;
  model?: string;
  simulated?: boolean;
  review_status?: ReviewStatus;
  review_issues_first?: ReviewIssue[];
  blocking_corrections?: BlockingCorrectionTrace[];
  tokens_in?: number;
  tokens_out?: number;
  tokens_thinking?: number;
  latency_ms?: number;
  first_ready_ms?: number;
  last_ready_ms?: number;
  error_code?: string;
  angle_plan?: AnglePlanItem[];
};

const jobs = new Map<string, TopicsJob>();

function emptyAxes(): Record<TopicAxis, TopicsJobAxisState> {
  return {
    mastery: { status: "pending" },
    ambition: { status: "pending" },
    discovery: { status: "pending" },
  };
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > TTL_MS) jobs.delete(id);
  }
}

export function createTopicsJob(uid: string): TopicsJob {
  purgeExpired();
  const job: TopicsJob = {
    id: randomUUID(),
    uid,
    createdAt: Date.now(),
    startedAt: Date.now(),
    status: "running",
    axes: emptyAxes(),
    blocking_corrections: [],
  };
  jobs.set(job.id, job);
  return job;
}

export function getTopicsJob(
  id: string,
  uid: string,
): TopicsJob | undefined {
  purgeExpired();
  const job = jobs.get(id);
  if (!job || job.uid !== uid) return undefined;
  return job;
}

export function updateTopicsJob(
  id: string,
  patch: Partial<TopicsJob>,
): TopicsJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  Object.assign(job, patch);
  return job;
}

export function setAxisState(
  id: string,
  axis: TopicAxis,
  state: Partial<TopicsJobAxisState>,
): void {
  const job = jobs.get(id);
  if (!job) return;
  job.axes[axis] = { ...job.axes[axis], ...state };
  if (state.status === "done" && state.ready_at_ms != null) {
    const elapsed = state.ready_at_ms - job.startedAt;
    if (job.first_ready_ms == null || elapsed < job.first_ready_ms) {
      job.first_ready_ms = elapsed;
    }
    if (job.last_ready_ms == null || elapsed > job.last_ready_ms) {
      job.last_ready_ms = elapsed;
    }
  }
}

export function jobPublicView(job: TopicsJob): Record<string, unknown> {
  const axesDone = (["mastery", "ambition", "discovery"] as TopicAxis[]).every(
    (a) => job.axes[a].status === "done" || job.axes[a].status === "error",
  );
  return {
    job_id: job.id,
    status: job.status,
    axes: {
      mastery: {
        status: job.axes.mastery.status,
        topic: job.axes.mastery.topic || null,
        error_code: job.axes.mastery.error_code || null,
      },
      ambition: {
        status: job.axes.ambition.status,
        topic: job.axes.ambition.topic || null,
        error_code: job.axes.ambition.error_code || null,
      },
      discovery: {
        status: job.axes.discovery.status,
        topic: job.axes.discovery.topic || null,
        error_code: job.axes.discovery.error_code || null,
      },
    },
    ticket: job.ticket || null,
    regenerationsRemaining: job.regenerationsRemaining ?? null,
    profile_analysis: job.profile_analysis || null,
    personalization_level: job.personalization_level || null,
    model: job.model || null,
    simulated: Boolean(job.simulated),
    review_status: job.review_status || null,
    review_issues_first: job.review_issues_first || [],
    blocking_corrections: job.blocking_corrections || [],
    tokens_in: job.tokens_in ?? null,
    tokens_out: job.tokens_out ?? null,
    tokens_thinking: job.tokens_thinking ?? null,
    latency_ms: job.latency_ms ?? null,
    first_ready_ms: job.first_ready_ms ?? null,
    last_ready_ms: job.last_ready_ms ?? null,
    angle_plan: job.angle_plan || null,
    axes_meta: {
      mastery: {
        violations_first: job.axes.mastery.violations_first || [],
        violations_after: job.axes.mastery.violations_after || [],
        latency_ms: job.axes.mastery.latency_ms ?? null,
        review_issues: job.axes.mastery.review_issues || [],
      },
      ambition: {
        violations_first: job.axes.ambition.violations_first || [],
        violations_after: job.axes.ambition.violations_after || [],
        latency_ms: job.axes.ambition.latency_ms ?? null,
        review_issues: job.axes.ambition.review_issues || [],
      },
      discovery: {
        violations_first: job.axes.discovery.violations_first || [],
        violations_after: job.axes.discovery.violations_after || [],
        latency_ms: job.axes.discovery.latency_ms ?? null,
        review_issues: job.axes.discovery.review_issues || [],
      },
    },
    complete: axesDone && job.status !== "running",
    noticeVersion: undefined,
  };
}
