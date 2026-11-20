/**
 * Persistance des tâches d’analyse corpus (ObjectStore + etag).
 * Clés : owners/{uid}/jobs/{jobId}
 */

import type { ObjectStore } from "../../storage/types";
import type { ClaudeUsage } from "../llm/claude";
import type { ResearchUnit } from "../../../../shared/research/units";

export type JobStatus =
  | "queued"
  | "running"
  | "waiting_batch"
  | "done"
  | "failed"
  | "cancelled";

export type JobMode = "realtime" | "batch";

export type UnitCoverageStatus = "pending" | "done" | "failed" | "skipped";

export type UnitCoverageEntry = {
  status: UnitCoverageStatus;
  materialId: string;
  reason?: string;
};

export type MaterialCoverage = {
  materialId: string;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  pending: number;
};

export type CoverageRegistry = {
  units: Record<string, UnitCoverageEntry>;
  perMaterial: MaterialCoverage[];
  totals: {
    total: number;
    done: number;
    failed: number;
    skipped: number;
    pending: number;
  };
  complete: boolean;
};

export type ResearchJob = {
  id: string;
  projectId: string;
  status: JobStatus;
  step: string;
  progress: { done: number; total: number };
  mode: JobMode;
  batchId?: string;
  /** Phase du lot en cours (ex. extract) — reprise après waiting_batch. */
  batchPhase?: string;
  usage?: ClaudeUsage;
  createdAt: string;
  updatedAt: string;
  error?: string;
  fingerprint?: string;
  billingToken?: string;
  /** Brief / format figés à la création pour le worker. */
  brief?: string;
  format?: string;
  writingStructure?: { title: string; intent: string; role?: string }[];
  /** Snapshot minimal pour le worker (sans textes volumineux dupliqués). */
  materialIds: string[];
  coverage: CoverageRegistry;
  /** Résultat final (forme POST /api/research) une fois done. */
  result?: unknown;
  request: {
    mode: "design" | "corpus";
    consent: boolean;
    simulate?: boolean;
    publicQuery?: string;
    revisionFeedback?: string;
    previousPlan?: { title: string; advice: string }[];
    /** Demande utilisateur ; peut être rétrogradée si !capabilities.batch. */
    preferBatch?: boolean;
    pseudonymize?: boolean;
    pseudonymNames?: string[];
  };
};

export function jobsPrefix(ownerPrefix: string): string {
  return ownerPrefix + "jobs/";
}

export function jobKey(ownerPrefix: string, jobId: string): string {
  return jobsPrefix(ownerPrefix) + jobId;
}

export function unitsKey(ownerPrefix: string, materialId: string): string {
  return ownerPrefix + "units/" + materialId;
}

export function emptyCoverage(): CoverageRegistry {
  return {
    units: {},
    perMaterial: [],
    totals: { total: 0, done: 0, failed: 0, skipped: 0, pending: 0 },
    complete: false,
  };
}

export function buildCoverageFromUnits(
  units: ResearchUnit[],
): CoverageRegistry {
  const unitsMap: Record<string, UnitCoverageEntry> = {};
  const byMaterial = new Map<
    string,
    { total: number; done: number; failed: number; skipped: number; pending: number }
  >();

  for (const unit of units) {
    unitsMap[unit.id] = {
      status: "pending",
      materialId: unit.materialId,
    };
    const row = byMaterial.get(unit.materialId) || {
      total: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
    };
    row.total += 1;
    row.pending += 1;
    byMaterial.set(unit.materialId, row);
  }

  const perMaterial = [...byMaterial.entries()].map(([materialId, counts]) => ({
    materialId,
    ...counts,
  }));
  const totals = perMaterial.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      done: acc.done + row.done,
      failed: acc.failed + row.failed,
      skipped: acc.skipped + row.skipped,
      pending: acc.pending + row.pending,
    }),
    { total: 0, done: 0, failed: 0, skipped: 0, pending: 0 },
  );

  return {
    units: unitsMap,
    perMaterial,
    totals,
    complete: totals.total > 0 && totals.pending === 0 && totals.failed === 0,
  };
}

export function recountCoverage(registry: CoverageRegistry): CoverageRegistry {
  const byMaterial = new Map<
    string,
    { total: number; done: number; failed: number; skipped: number; pending: number }
  >();
  for (const entry of Object.values(registry.units)) {
    const row = byMaterial.get(entry.materialId) || {
      total: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
    };
    row.total += 1;
    row[entry.status] += 1;
    byMaterial.set(entry.materialId, row);
  }
  const perMaterial = [...byMaterial.entries()].map(([materialId, counts]) => ({
    materialId,
    ...counts,
  }));
  const totals = perMaterial.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      done: acc.done + row.done,
      failed: acc.failed + row.failed,
      skipped: acc.skipped + row.skipped,
      pending: acc.pending + row.pending,
    }),
    { total: 0, done: 0, failed: 0, skipped: 0, pending: 0 },
  );
  return {
    units: registry.units,
    perMaterial,
    totals,
    complete: totals.total > 0 && totals.pending === 0 && totals.failed === 0,
  };
}

export async function readJob(
  bucket: ObjectStore,
  ownerPrefix: string,
  jobId: string,
): Promise<{ job: ResearchJob; etag: string } | null> {
  const object = await bucket.get(jobKey(ownerPrefix, jobId));
  if (!object) return null;
  return { job: await object.json<ResearchJob>(), etag: object.etag };
}

export async function writeJob(
  bucket: ObjectStore,
  ownerPrefix: string,
  job: ResearchJob,
  etag?: string,
): Promise<{ etag: string } | null> {
  const next = { ...job, updatedAt: new Date().toISOString() };
  return bucket.put(jobKey(ownerPrefix, job.id), JSON.stringify(next), {
    onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: "*" },
  });
}

/** Écriture conditionnelle avec retries (même modèle que billing). */
export async function updateJob(
  bucket: ObjectStore,
  ownerPrefix: string,
  jobId: string,
  update: (job: ResearchJob) => ResearchJob,
): Promise<ResearchJob | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await readJob(bucket, ownerPrefix, jobId);
    if (!current) return null;
    const next = update(current.job);
    if (next === current.job) return current.job;
    const saved = await writeJob(bucket, ownerPrefix, next, current.etag);
    if (saved) return { ...next, updatedAt: next.updatedAt };
  }
  throw Object.assign(
    new Error("Plusieurs opérations sont en cours sur cette tâche. Réessayez."),
    { status: 503 },
  );
}

export async function saveMaterialUnits(
  bucket: ObjectStore,
  ownerPrefix: string,
  materialId: string,
  units: ResearchUnit[],
  textLength: number,
  fingerprints?: { textFingerprint?: string; visionFingerprint?: string },
): Promise<void> {
  await bucket.put(
    unitsKey(ownerPrefix, materialId),
    JSON.stringify({
      materialId,
      textLength,
      textFingerprint: fingerprints?.textFingerprint || undefined,
      visionFingerprint: fingerprints?.visionFingerprint || undefined,
      units,
      updatedAt: new Date().toISOString(),
    }),
  );
}

export async function loadMaterialUnits(
  bucket: ObjectStore,
  ownerPrefix: string,
  materialId: string,
): Promise<ResearchUnit[] | null> {
  const object = await bucket.get(unitsKey(ownerPrefix, materialId));
  if (!object) return null;
  const payload = await object.json<{ units?: ResearchUnit[] }>();
  return Array.isArray(payload.units) ? payload.units : null;
}

const ACTIVE: JobStatus[] = ["queued", "running", "waiting_batch"];

export function isActiveStatus(status: JobStatus): boolean {
  return ACTIVE.includes(status);
}

async function forEachJob(
  bucket: ObjectStore,
  visit: (job: ResearchJob, ownerPrefix: string) => void | Promise<void>,
): Promise<void> {
  if (!bucket.list) return;
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const listed = await bucket.list({ prefix: "owners/", cursor, limit: 500 });
    for (const obj of listed.objects) {
      const key = obj.key || "";
      const match = /^owners\/([^/]+)\/jobs\/([^/]+)$/.exec(key);
      if (!match) continue;
      const body = await bucket.get(key);
      if (!body) continue;
      try {
        const job = await body.json<ResearchJob>();
        if (job)
          await visit(job, `owners/${match[1]}/`);
      } catch {
        /* objet illisible ignoré */
      }
    }
    if (!listed.truncated || !listed.cursor) break;
    cursor = listed.cursor;
  }
}

/** Liste les tâches actives (reprise au démarrage). */
export async function listActiveJobs(
  bucket: ObjectStore,
): Promise<Array<{ ownerPrefix: string; jobId: string }>> {
  const found: Array<{ ownerPrefix: string; jobId: string }> = [];
  await forEachJob(bucket, (job, ownerPrefix) => {
    if (isActiveStatus(job.status))
      found.push({ ownerPrefix, jobId: job.id });
  });
  return found;
}

/**
 * Tâches failed|cancelled qui retiennent encore un jeton à libérer —
 * typiquement après un crash entre le statut terminal et releaseAnalysis.
 * Ne liste jamais les tâches « done » (crédit consommé définitivement).
 */
export async function listJobsWithOrphanBilling(
  bucket: ObjectStore,
): Promise<Array<{ ownerPrefix: string; jobId: string; token: string }>> {
  const found: Array<{ ownerPrefix: string; jobId: string; token: string }> =
    [];
  await forEachJob(bucket, (job, ownerPrefix) => {
    if (
      job.billingToken &&
      (job.status === "failed" || job.status === "cancelled")
    )
      found.push({
        ownerPrefix,
        jobId: job.id,
        token: job.billingToken,
      });
  });
  return found;
}

/**
 * Tâches « done » qui ont encore billingToken en métadonnée (écriture partielle).
 * On efface seulement le champ — on ne rappelle JAMAIS releaseAnalysis.
 */
export async function listDoneJobsWithStaleToken(
  bucket: ObjectStore,
): Promise<Array<{ ownerPrefix: string; jobId: string }>> {
  const found: Array<{ ownerPrefix: string; jobId: string }> = [];
  await forEachJob(bucket, (job, ownerPrefix) => {
    if (job.status === "done" && job.billingToken)
      found.push({ ownerPrefix, jobId: job.id });
  });
  return found;
}

export function publicJobView(job: ResearchJob) {
  return {
    jobId: job.id,
    status: job.status,
    step: job.step,
    progress: job.progress,
    mode: job.mode,
    batchId: job.batchId,
    usage: job.usage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
    coverage: {
      totalUnits: job.coverage.totals.total,
      done: job.coverage.totals.done,
      failed: job.coverage.totals.failed,
      skipped: job.coverage.totals.skipped,
      pending: job.coverage.totals.pending,
      perMaterial: job.coverage.perMaterial,
      complete: job.coverage.complete,
    },
    result: job.status === "done" ? job.result : undefined,
  };
}
