/**
 * Worker in-process : reprend les tâches non terminées au démarrage
 * et traite la file au fil de l’eau.
 */

import { env } from "../../storage/index";
import type { ObjectStore } from "../../storage/types";
import { releaseAnalysis } from "../billing/quotas";
import {
  isActiveStatus,
  listActiveJobs,
  listDoneJobsWithStaleToken,
  listJobsWithOrphanBilling,
  readJob,
  updateJob,
  type ResearchJob,
} from "./jobs";
import { runResearchPipeline } from "./pipeline/index";
import { deletePseudonymMap } from "./pipeline/pseudonym";

type QueueItem = { ownerPrefix: string; jobId: string };

const queue: QueueItem[] = [];
const queued = new Set<string>();
let busy = false;
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

function itemKey(item: QueueItem): string {
  return item.ownerPrefix + item.jobId;
}

export function enqueueResearchJob(ownerPrefix: string, jobId: string): void {
  const item = { ownerPrefix, jobId };
  const key = itemKey(item);
  if (queued.has(key)) return;
  queued.add(key);
  queue.push(item);
  void pump();
}

async function releaseJobCredit(
  bucket: ObjectStore,
  ownerPrefix: string,
  jobId: string,
  token: string | undefined,
): Promise<void> {
  if (!token) return;
  await releaseAnalysis(bucket, ownerPrefix, token);
  await updateJob(bucket, ownerPrefix, jobId, (job) => ({
    ...job,
    billingToken: undefined,
  }));
}

async function loadMaterials(
  bucket: ObjectStore,
  ownerPrefix: string,
  job: ResearchJob,
): Promise<unknown[]> {
  const ws = await bucket.get(ownerPrefix + "workspace");
  if (!ws) return [];
  const data = await ws.json<{
    projects?: Array<{
      id: string;
      materials?: unknown[];
      copilot?: { excluded?: string[] };
    }>;
  }>();
  const project = (data.projects || []).find((p) => p.id === job.projectId);
  if (!project) return [];
  const excluded = new Set(project.copilot?.excluded || []);
  const wanted = new Set(job.materialIds);
  return (project.materials || []).filter((m: any) => {
    const id = String(m?.id || "");
    return id && wanted.has(id) && !excluded.has(id);
  });
}

async function processOne(item: QueueItem): Promise<void> {
  const bucket = env.BUCKET as ObjectStore | undefined;
  if (!bucket) return;

  const current = await readJob(bucket, item.ownerPrefix, item.jobId);
  if (!current || !isActiveStatus(current.job.status)) return;
  if (current.job.status === "cancelled") return;

  const claimed = await updateJob(
    bucket,
    item.ownerPrefix,
    item.jobId,
    (job) => {
      if (!isActiveStatus(job.status) || job.status === "cancelled") return job;
      if (job.status === "waiting_batch") return job;
      return {
        ...job,
        status: "running",
        step: job.step || "units",
      };
    },
  );
  if (!claimed || !isActiveStatus(claimed.status)) return;

  try {
    const materials = await loadMaterials(bucket, item.ownerPrefix, claimed);
    const outcome = await runResearchPipeline(
      { bucket, ownerPrefix: item.ownerPrefix, jobId: item.jobId },
      claimed,
      materials,
    );
    if (outcome === "waiting") {
      // Re-poll plus tard (intervalle worker / file).
      return;
    }
    // Succès : le pipeline a retiré billingToken sans libérer (crédit consommé).
  } catch (err: any) {
    const message =
      err?.message || "Analyse indisponible. Votre corpus est conservé.";
    const failed = await updateJob(
      bucket,
      item.ownerPrefix,
      item.jobId,
      (job) => {
        if (job.status === "cancelled" || job.status === "done") return job;
        return {
          ...job,
          status: "failed",
          step: "failed",
          error: message,
        };
      },
    );
    // Libération du crédit sur failed (et pas seulement cancelled).
    if (failed?.billingToken)
      await releaseJobCredit(
        bucket,
        item.ownerPrefix,
        item.jobId,
        failed.billingToken,
      );
    await deletePseudonymMap(bucket, item.ownerPrefix, item.jobId);
  }
}

async function pump(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const item = queue.shift()!;
      queued.delete(itemKey(item));
      try {
        await processOne(item);
      } catch (err) {
        console.warn(
          "Manuscrit : échec worker research",
          err instanceof Error ? err.message : "erreur",
        );
      }
    }
  } finally {
    busy = false;
  }
}

/**
 * Libère uniquement les jetons des tâches failed|cancelled.
 * Ne touche jamais une tâche done (crédit consommé).
 * Pour done avec billingToken résiduel : efface le champ sans releaseAnalysis.
 */
async function releaseOrphanCredits(): Promise<void> {
  const bucket = env.BUCKET as ObjectStore | undefined;
  if (!bucket) return;
  try {
    const orphans = await listJobsWithOrphanBilling(bucket);
    for (const item of orphans) {
      await releaseJobCredit(
        bucket,
        item.ownerPrefix,
        item.jobId,
        item.token,
      );
    }
    const staleDone = await listDoneJobsWithStaleToken(bucket);
    for (const item of staleDone) {
      await updateJob(bucket, item.ownerPrefix, item.jobId, (job) =>
        job.status === "done" && job.billingToken
          ? { ...job, billingToken: undefined }
          : job,
      );
    }
  } catch (err) {
    console.warn(
      "Manuscrit : nettoyage crédits research impossible",
      err instanceof Error ? err.message : "erreur",
    );
  }
}

async function resumeActiveJobs(): Promise<void> {
  const bucket = env.BUCKET as ObjectStore | undefined;
  if (!bucket) return;
  try {
    await releaseOrphanCredits();
    const active = await listActiveJobs(bucket);
    for (const item of active) enqueueResearchJob(item.ownerPrefix, item.jobId);
  } catch (err) {
    console.warn(
      "Manuscrit : reprise des tâches research impossible",
      err instanceof Error ? err.message : "erreur",
    );
  }
}

/** Démarre le worker (idempotent) et reprend les tâches non terminées. */
export function startResearchWorker(): void {
  if (started) return;
  started = true;
  void resumeActiveJobs();
  timer = setInterval(() => {
    void resumeActiveJobs();
  }, 60_000);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

export function stopResearchWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
