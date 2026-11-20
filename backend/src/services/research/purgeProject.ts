/**
 * Purge des artefacts pipeline liés à un projet (jobs, cartes, map
 * de pseudonymisation, unités, transcriptions vision, textes hashés).
 */

import type { ObjectStore } from "../../storage/types";
import { jobKey, jobsPrefix, unitsKey, type ResearchJob } from "./jobs";
import {
  visionObjectKey,
} from "./pipeline/persistVision";
import {
  textsMaterialPrefix,
  textsObjectKey,
} from "./persistMaterialTexts";
import { pseudonymMapKey } from "./pipeline/pseudonym";

async function listKeys(
  bucket: ObjectStore,
  prefix: string,
): Promise<string[]> {
  if (!bucket.list) return [];
  const keys: string[] = [];
  let cursor = "";
  for (let page = 0; page < 40; page++) {
    const listed = await bucket.list({ prefix, cursor, limit: 500 });
    for (const obj of listed.objects) {
      if (obj.key) keys.push(obj.key);
    }
    if (!listed.truncated || !listed.cursor) break;
    cursor = listed.cursor;
  }
  return keys;
}

async function deleteKeys(bucket: ObjectStore, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const unique = [...new Set(keys)];
  const chunk = 80;
  for (let i = 0; i < unique.length; i += chunk) {
    await bucket.delete(unique.slice(i, i + chunk));
  }
}

async function jobArtifacts(
  bucket: ObjectStore,
  ownerPrefix: string,
  jobId: string,
): Promise<string[]> {
  const base = jobsPrefix(ownerPrefix) + jobId;
  const listed = await listKeys(bucket, base);
  return [
    jobKey(ownerPrefix, jobId),
    base + "/cards",
    pseudonymMapKey(ownerPrefix, jobId),
    ...listed,
  ];
}

/**
 * Supprime jobs (+ pseudonym-map, cards) et objets vision/textes/unités
 * des matériaux du projet (tous les hash inclus).
 */
export async function purgeProjectResearchData(
  bucket: ObjectStore,
  ownerPrefix: string,
  projectId: string,
  materialIds: string[] = [],
): Promise<void> {
  const keys: string[] = [];

  if (bucket.list) {
    const jobKeys = await listKeys(bucket, jobsPrefix(ownerPrefix));
    for (const key of jobKeys) {
      const match = new RegExp(
        `^${jobsPrefix(ownerPrefix).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^/]+)$`,
      ).exec(key);
      if (!match) continue;
      const jobId = match[1];
      try {
        const obj = await bucket.get(key);
        if (!obj) continue;
        const job = await obj.json<ResearchJob>();
        if (job?.projectId !== projectId) continue;
        keys.push(...(await jobArtifacts(bucket, ownerPrefix, jobId)));
      } catch {
        /* ignore */
      }
    }
  }

  for (const materialId of materialIds) {
    if (!materialId) continue;
    keys.push(unitsKey(ownerPrefix, materialId));
    // Vision : clé legacy + tous les hash vision/{id}/…
    keys.push(visionObjectKey(ownerPrefix, materialId));
    keys.push(
      ...(await listKeys(bucket, visionObjectKey(ownerPrefix, materialId) + "/")),
    );
    // Textes : clé legacy + tous les hash texts/{id}/…
    keys.push(textsObjectKey(ownerPrefix, materialId));
    keys.push(
      ...(await listKeys(bucket, textsMaterialPrefix(ownerPrefix, materialId) + "/")),
    );
  }

  await deleteKeys(bucket, keys);
}

/** Diff workspace : purge les projets absents de la nouvelle version. */
export async function purgeRemovedProjects(
  bucket: ObjectStore,
  ownerPrefix: string,
  previous: {
    projects?: Array<{ id?: string; materials?: Array<{ id?: string }> }>;
  } | null,
  next: { projects?: Array<{ id?: string }> },
): Promise<void> {
  const keep = new Set(
    (next.projects || []).map((p) => String(p.id || "")).filter(Boolean),
  );
  for (const project of previous?.projects || []) {
    const id = String(project.id || "");
    if (!id || keep.has(id)) continue;
    const materialIds = (project.materials || [])
      .map((m) => String(m?.id || ""))
      .filter(Boolean);
    await purgeProjectResearchData(bucket, ownerPrefix, id, materialIds);
  }
}
