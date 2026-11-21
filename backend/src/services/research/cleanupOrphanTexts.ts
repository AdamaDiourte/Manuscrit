/**
 * Nettoyage ObjectStore après sauvegarde workspace (arrière-plan).
 *
 * Familles nettoyées :
 * - texts/{materialId}[/{hash}]
 * - vision/{materialId}[/{hash}]
 * - units/{materialId}
 * - unit-cache/{cacheHash}
 * - jobs/{jobId}/cards, jobs/{jobId}/pseudonym-map
 * - jobs/{jobId} (+ sous-clés) si terminé et > JOB_RETENTION_DAYS
 * - research/{fingerprint} (+ .lock) — matériaux cités absents ou > RESEARCH_CACHE_MAX_DAYS
 * - files/{sha256} orphelins + recalcul upload-capacity
 *
 * Conservées (hors nettoyage orphelin) :
 * - workspace ; billing/usage/{period} ; billing/{live|test}/account ;
 *   Crossref non persisté (appel API à la volée).
 */

import type { ObjectStore } from "../../storage/types";
import { changeValue } from "../billing/storage";
import {
  isTextContentHash,
  type ExternalizeWriteLog,
} from "./persistMaterialTexts";
import { isVisionContentHash } from "./pipeline/persistVision";
import { unitCachePrefix } from "./pipeline/cache";
import { pseudonymMapKey } from "./pipeline/pseudonym";
import {
  jobKey,
  jobsPrefix,
  unitsKey,
  type ResearchJob,
} from "./jobs";
import {
  jobRetentionMaxAgeMs,
  researchCacheMaxAgeMs,
} from "./retention";

export type TextReferences = {
  /** Matériaux encore présents (courants). */
  materialIds: Set<string>;
  /** materialId → empreintes textFingerprint encore référencées. */
  texts: Map<string, Set<string>>;
  /** materialId → empreintes visionFingerprint encore référencées. */
  vision: Map<string, Set<string>>;
};

function addRef(
  map: Map<string, Set<string>>,
  materialId: string,
  hash: string,
) {
  let set = map.get(materialId);
  if (!set) {
    set = new Set();
    map.set(materialId, set);
  }
  set.add(hash.toLowerCase());
}

function visitSnap(
  refs: TextReferences,
  snap: any,
  countAsLiveMaterial: boolean,
) {
  if (!snap?.id) return;
  const id = String(snap.id);
  if (countAsLiveMaterial) refs.materialIds.add(id);
  if (isTextContentHash(snap.textFingerprint)) {
    addRef(refs.texts, id, snap.textFingerprint);
  }
  if (isVisionContentHash(snap.visionFingerprint)) {
    addRef(refs.vision, id, snap.visionFingerprint);
  }
}

function isFileContentId(id: unknown): id is string {
  return typeof id === "string" && /^[a-f0-9]{64}$/i.test(id);
}

function collectFileIdsFromSnap(snap: any, into: Set<string>) {
  if (!snap || typeof snap !== "object") return;
  for (const key of ["file", "toolFile"] as const) {
    const v = snap[key];
    if (isFileContentId(v)) into.add(v.toLowerCase());
  }
}

/** Empreintes encore référencées par les matériaux courants et les versions. */
export function collectTextReferences(data: {
  projects?: any[];
}): TextReferences {
  const refs: TextReferences = {
    materialIds: new Set(),
    texts: new Map(),
    vision: new Map(),
  };
  for (const project of data.projects || []) {
    for (const material of project?.materials || []) {
      visitSnap(refs, material, true);
    }
    for (const version of project?.versions || []) {
      for (const side of ["before", "after"] as const) {
        visitSnap(refs, version?.[side], false);
      }
    }
  }
  return refs;
}

/** Identifiants files/{sha} encore référencés (matériaux, versions, archive sujets). */
export function collectReferencedFileIds(data: {
  projects?: any[];
}): Set<string> {
  const ids = new Set<string>();
  for (const project of data.projects || []) {
    for (const material of project?.materials || []) {
      collectFileIdsFromSnap(material, ids);
    }
    for (const version of project?.versions || []) {
      for (const side of ["before", "after"] as const) {
        collectFileIdsFromSnap(version?.[side], ids);
      }
    }
    // Word archivés après choix d’un sujet (projet + plan de travail).
    const archive = project?.copilot?.topicArchive;
    if (Array.isArray(archive)) {
      for (const entry of archive) {
        const docs = entry?.documents;
        if (!Array.isArray(docs)) continue;
        for (const doc of docs) {
          if (isFileContentId(doc?.fileId)) ids.add(String(doc.fileId).toLowerCase());
        }
      }
    }
  }
  return ids;
}

/** Matériaux encore liés (courants ou au moins un instantané). */
function materialsWithAnyRef(refs: TextReferences): Set<string> {
  const ids = new Set(refs.materialIds);
  for (const id of refs.texts.keys()) ids.add(id);
  for (const id of refs.vision.keys()) ids.add(id);
  return ids;
}

function uidPseudoFromPrefix(ownerPrefix: string): string {
  const match = /^owners\/([^/]+)\//.exec(ownerPrefix);
  if (!match) return "unknown";
  try {
    return decodeURIComponent(match[1]).slice(0, 8);
  } catch {
    return match[1].slice(0, 8);
  }
}

function errorTypeOf(err: unknown): string {
  if (!err) return "Error";
  if (err instanceof Error && err.name) return err.name;
  if (typeof err === "object" && err && "name" in err)
    return String((err as { name: unknown }).name || "Error");
  return "Error";
}

/** Journal technique — jamais de contenu, chemin ni nom de fichier. */
export function logOrphanCleanupFailure(
  ownerPrefix: string,
  err: unknown,
  objectCount: number,
): void {
  console.info(
    JSON.stringify({
      event: "workspace.orphan_cleanup",
      status: "error",
      errorType: errorTypeOf(err),
      objectCount: Math.max(0, Math.floor(Number(objectCount) || 0)),
      uidPseudo: uidPseudoFromPrefix(ownerPrefix),
      at: new Date().toISOString(),
    }),
  );
}

async function listKeys(
  bucket: ObjectStore,
  prefix: string,
): Promise<string[]> {
  if (!bucket.list) return [];
  const keys: string[] = [];
  let cursor = "";
  for (let page = 0; page < 80; page++) {
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

/**
 * Matériaux utilisés par une tâche running / waiting_batch du propriétaire.
 */
export async function materialIdsInActiveAnalysis(
  bucket: ObjectStore,
  ownerPrefix: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!bucket.list) return ids;
  const prefix = jobsPrefix(ownerPrefix);
  const keys = await listKeys(bucket, prefix);
  for (const key of keys) {
    const rest = key.slice(prefix.length);
    if (!rest || rest.includes("/")) continue;
    try {
      const obj = await bucket.get(key);
      if (!obj) continue;
      const job = await obj.json<ResearchJob>();
      if (!job || (job.status !== "running" && job.status !== "waiting_batch"))
        continue;
      for (const mid of job.materialIds || []) {
        if (mid) ids.add(String(mid));
      }
      for (const entry of Object.values(job.coverage?.units || {})) {
        if (entry?.materialId) ids.add(String(entry.materialId));
      }
    } catch {
      /* ignore */
    }
  }
  return ids;
}

function parseStoreKey(
  ownerPrefix: string,
  kind: "texts" | "vision",
  key: string,
): { materialId: string; hash: string | null } | null {
  const base = ownerPrefix + kind + "/";
  if (!key.startsWith(base)) return null;
  const rest = key.slice(base.length);
  if (!rest || rest.endsWith("/")) return null;
  const slash = rest.indexOf("/");
  if (slash < 0) return { materialId: rest, hash: null };
  const materialId = rest.slice(0, slash);
  const hash = rest.slice(slash + 1);
  if (!materialId || hash.includes("/")) return null;
  return { materialId, hash };
}

async function collectTextVisionDeletes(
  bucket: ObjectStore,
  ownerPrefix: string,
  refs: TextReferences,
  keptMaterials: Set<string>,
  protectedMaterials: Set<string>,
  writeLog: ExternalizeWriteLog,
): Promise<string[]> {
  const writtenTexts = new Set(
    [...writeLog.texts].map((k) => k.toLowerCase()),
  );
  const writtenVision = new Set(
    [...writeLog.vision].map((k) => k.toLowerCase()),
  );
  const toDelete: string[] = [];

  for (const kind of ["texts", "vision"] as const) {
    const keys = await listKeys(bucket, ownerPrefix + kind + "/");
    const refMap = kind === "texts" ? refs.texts : refs.vision;
    const written = kind === "texts" ? writtenTexts : writtenVision;

    for (const key of keys) {
      const parsed = parseStoreKey(ownerPrefix, kind, key);
      if (!parsed) continue;
      const { materialId, hash } = parsed;

      if (protectedMaterials.has(materialId)) continue;

      if (!keptMaterials.has(materialId)) {
        toDelete.push(key);
        continue;
      }

      if (!hash) {
        const hashes = refMap.get(materialId);
        if (hashes && hashes.size > 0) toDelete.push(key);
        continue;
      }

      if (!isTextContentHash(hash) && !isVisionContentHash(hash)) continue;

      const refKey = (materialId + "/" + hash).toLowerCase();
      if (written.has(refKey)) continue;

      const hashes = refMap.get(materialId);
      if (hashes && hashes.has(hash.toLowerCase())) continue;

      toDelete.push(key);
    }
  }
  return toDelete;
}

/** units/{materialId} — dérivé du texte (empreinte si connue). */
async function collectUnitsDeletes(
  bucket: ObjectStore,
  ownerPrefix: string,
  refs: TextReferences,
  keptMaterials: Set<string>,
  protectedMaterials: Set<string>,
): Promise<string[]> {
  const keys = await listKeys(bucket, ownerPrefix + "units/");
  const toDelete: string[] = [];
  for (const key of keys) {
    const materialId = key.slice((ownerPrefix + "units/").length);
    if (!materialId || materialId.includes("/")) continue;
    if (protectedMaterials.has(materialId)) continue;

    if (!keptMaterials.has(materialId)) {
      toDelete.push(unitsKey(ownerPrefix, materialId));
      continue;
    }

    // Matériau uniquement en version (plus courant) : unités d’analyse caduques.
    if (!refs.materialIds.has(materialId)) {
      toDelete.push(unitsKey(ownerPrefix, materialId));
      continue;
    }

    try {
      const obj = await bucket.get(key);
      if (!obj) continue;
      const meta = await obj.json<{
        textFingerprint?: string;
        visionFingerprint?: string;
      }>();
      const textFp = meta?.textFingerprint;
      if (
        isTextContentHash(textFp) &&
        !refs.texts.get(materialId)?.has(textFp!.toLowerCase())
      ) {
        toDelete.push(unitsKey(ownerPrefix, materialId));
        continue;
      }
      const visionFp = meta?.visionFingerprint;
      if (
        isVisionContentHash(visionFp) &&
        !refs.vision.get(materialId)?.has(visionFp!.toLowerCase()) &&
        // Ne pas purger pour seule empreinte vision absente si le texte courant match.
        !(
          isTextContentHash(textFp) &&
          refs.texts.get(materialId)?.has(textFp!.toLowerCase())
        )
      ) {
        toDelete.push(unitsKey(ownerPrefix, materialId));
      }
    } catch {
      /* ignore lecture */
    }
  }
  return toDelete;
}

/**
 * unit-cache/{hash} — fiches d’extraction (citations).
 * Suppression si materialId absent de toute référence.
 */
async function collectUnitCacheDeletes(
  bucket: ObjectStore,
  ownerPrefix: string,
  keptMaterials: Set<string>,
  protectedMaterials: Set<string>,
): Promise<string[]> {
  const keys = await listKeys(bucket, unitCachePrefix(ownerPrefix));
  const toDelete: string[] = [];
  for (const key of keys) {
    try {
      const obj = await bucket.get(key);
      if (!obj) continue;
      const card = await obj.json<{ materialId?: string }>();
      const materialId = String(card?.materialId || "");
      if (!materialId) continue;
      if (protectedMaterials.has(materialId)) continue;
      if (!keptMaterials.has(materialId)) toDelete.push(key);
    } catch {
      /* ignore */
    }
  }
  return toDelete;
}

/**
 * jobs/{id}/cards et jobs/{id}/pseudonym-map pour tâches non actives
 * dont les matériaux ne sont plus (tous) référencés.
 */
async function collectJobDerivedDeletes(
  bucket: ObjectStore,
  ownerPrefix: string,
  keptMaterials: Set<string>,
): Promise<string[]> {
  const prefix = jobsPrefix(ownerPrefix);
  const keys = await listKeys(bucket, prefix);
  const toDelete: string[] = [];

  for (const key of keys) {
    const rest = key.slice(prefix.length);
    if (!rest || rest.includes("/")) continue;
    const jobId = rest;
    try {
      const obj = await bucket.get(key);
      if (!obj) continue;
      const job = await obj.json<ResearchJob>();
      if (!job) continue;
      if (
        job.status === "running" ||
        job.status === "waiting_batch" ||
        job.status === "queued"
      )
        continue;

      const jobMaterials = new Set<string>();
      for (const mid of job.materialIds || []) {
        if (mid) jobMaterials.add(String(mid));
      }
      for (const entry of Object.values(job.coverage?.units || {})) {
        if (entry?.materialId) jobMaterials.add(String(entry.materialId));
      }

      const anyKept = [...jobMaterials].some((id) => keptMaterials.has(id));
      const mapKey = pseudonymMapKey(ownerPrefix, jobId);
      const cardsKey = prefix + jobId + "/cards";

      if (!anyKept && jobMaterials.size > 0) {
        toDelete.push(mapKey);
      }

      const cardsObj = await bucket.get(cardsKey);
      if (!cardsObj) continue;
      const payload = await cardsObj.json<{
        cards?: { materialId?: string }[];
      }>();
      const cards = Array.isArray(payload?.cards) ? payload.cards : [];
      if (!cards.length) {
        if (!anyKept) toDelete.push(cardsKey);
        continue;
      }
      const keptCards = cards.filter((c) =>
        keptMaterials.has(String(c?.materialId || "")),
      );
      if (keptCards.length === cards.length) continue;
      if (keptCards.length === 0) {
        toDelete.push(cardsKey);
        if (!anyKept) toDelete.push(mapKey);
        continue;
      }
      await bucket.put(cardsKey, JSON.stringify({ cards: keptCards }));
    } catch {
      /* ignore job */
    }
  }

  return toDelete;
}

/** jobs/{id} terminés au-delà de JOB_RETENTION_DAYS (+ cartes / map). */
async function collectExpiredJobDeletes(
  bucket: ObjectStore,
  ownerPrefix: string,
): Promise<string[]> {
  const maxAge = jobRetentionMaxAgeMs();
  const prefix = jobsPrefix(ownerPrefix);
  const keys = await listKeys(bucket, prefix);
  const toDelete: string[] = [];
  const now = Date.now();

  for (const key of keys) {
    const rest = key.slice(prefix.length);
    if (!rest || rest.includes("/")) continue;
    const jobId = rest;
    try {
      const obj = await bucket.get(key);
      if (!obj) continue;
      const job = await obj.json<ResearchJob>();
      if (!job) continue;
      if (
        job.status !== "done" &&
        job.status !== "failed" &&
        job.status !== "cancelled"
      )
        continue;
      const stamp = Date.parse(job.updatedAt || job.createdAt || "");
      const ageBase = Number.isFinite(stamp)
        ? stamp
        : obj.uploaded?.getTime?.() || 0;
      if (!ageBase || now - ageBase < maxAge) continue;
      toDelete.push(jobKey(ownerPrefix, jobId));
      toDelete.push(...(await listKeys(bucket, prefix + jobId + "/")));
    } catch {
      /* ignore */
    }
  }
  return toDelete;
}

function researchCacheCitesMissing(
  result: any,
  keptMaterials: Set<string>,
): boolean {
  for (const section of result?.sections || []) {
    for (const ev of section?.evidence || []) {
      const id = String(ev?.id || "");
      if (id && !keptMaterials.has(id)) return true;
    }
  }
  return false;
}

/**
 * research/{fingerprint} (+ .lock) : matériau cité absent ou TTL dépassé.
 */
async function collectResearchCacheDeletes(
  bucket: ObjectStore,
  ownerPrefix: string,
  keptMaterials: Set<string>,
): Promise<string[]> {
  const maxAge = researchCacheMaxAgeMs();
  const lockStaleMs = 15 * 60 * 1000;
  const prefix = ownerPrefix + "research/";
  const keys = await listKeys(bucket, prefix);
  const toDelete: string[] = [];
  const now = Date.now();

  for (const key of keys) {
    const rest = key.slice(prefix.length);
    if (!rest) continue;
    try {
      if (rest.endsWith(".lock")) {
        const head = await bucket.head(key);
        const age = head?.uploaded ? now - head.uploaded.getTime() : 0;
        const cacheKey = key.slice(0, -".lock".length);
        const cacheExists = await bucket.head(cacheKey);
        if (!cacheExists || age > lockStaleMs) toDelete.push(key);
        continue;
      }
      const head = await bucket.head(key);
      const obj = await bucket.get(key);
      if (!obj) continue;
      const result = await obj.json<any>();
      const stamp = Date.parse(String(result?.date || ""));
      const ageBase = Number.isFinite(stamp)
        ? stamp
        : head?.uploaded?.getTime?.() || 0;
      if (ageBase && now - ageBase > maxAge) {
        toDelete.push(key);
        toDelete.push(key + ".lock");
        continue;
      }
      if (researchCacheCitesMissing(result, keptMaterials)) {
        toDelete.push(key);
        toDelete.push(key + ".lock");
      }
    } catch {
      /* ignore */
    }
  }
  return toDelete;
}

/**
 * files/{sha} non référencés (hors matériaux protégés par analyse active).
 * Retourne aussi les id à retirer de upload-capacity.
 */
async function collectOrphanFileDeletes(
  bucket: ObjectStore,
  ownerPrefix: string,
  data: { projects?: any[] },
  protectedMaterials: Set<string>,
): Promise<{ keys: string[]; fileIds: string[] }> {
  const referenced = collectReferencedFileIds(data);
  // Fichiers des matériaux en analyse active : toujours protégés.
  for (const project of data.projects || []) {
    for (const material of project?.materials || []) {
      if (!material?.id || !protectedMaterials.has(String(material.id)))
        continue;
      collectFileIdsFromSnap(material, referenced);
    }
  }

  const prefix = ownerPrefix + "files/";
  const keys = await listKeys(bucket, prefix);
  const toDelete: string[] = [];
  const fileIds: string[] = [];
  for (const key of keys) {
    const id = key.slice(prefix.length).toLowerCase();
    if (!isFileContentId(id)) continue;
    if (referenced.has(id)) continue;
    toDelete.push(key);
    fileIds.push(id);
  }
  return { keys: toDelete, fileIds };
}

/** Recalcule upload-capacity à partir des fichiers encore présents. */
async function rebuildUploadCapacity(
  bucket: ObjectStore,
  ownerPrefix: string,
): Promise<void> {
  const prefix = ownerPrefix + "files/";
  const keys = await listKeys(bucket, prefix);
  const next: Record<string, number> = {};
  for (const key of keys) {
    const id = key.slice(prefix.length).toLowerCase();
    if (!isFileContentId(id)) continue;
    const head = await bucket.head(key);
    const size =
      typeof head?.size === "number" && head.size >= 0
        ? head.size
        : Number(head?.customMetadata?.size) || 0;
    next[id] = size;
  }
  await changeValue<Record<string, number>>(
    bucket,
    ownerPrefix + "upload-capacity",
    {},
    () => next,
  );
}

/**
 * Nettoyage complet texts/vision + données dérivées + fichiers + caches.
 * En cas d’échec : journal technique puis rethrow.
 */
export async function cleanupOrphanMaterialTexts(
  bucket: ObjectStore,
  ownerPrefix: string,
  data: { projects?: any[] },
  writeLog: ExternalizeWriteLog = { texts: new Set(), vision: new Set() },
): Promise<number> {
  let objectCount = 0;
  try {
    const refs = collectTextReferences(data);
    const keptMaterials = materialsWithAnyRef(refs);
    const protectedMaterials = await materialIdsInActiveAnalysis(
      bucket,
      ownerPrefix,
    );

    const toDelete: string[] = [];
    toDelete.push(
      ...(await collectTextVisionDeletes(
        bucket,
        ownerPrefix,
        refs,
        keptMaterials,
        protectedMaterials,
        writeLog,
      )),
    );
    toDelete.push(
      ...(await collectUnitsDeletes(
        bucket,
        ownerPrefix,
        refs,
        keptMaterials,
        protectedMaterials,
      )),
    );
    toDelete.push(
      ...(await collectUnitCacheDeletes(
        bucket,
        ownerPrefix,
        keptMaterials,
        protectedMaterials,
      )),
    );
    toDelete.push(
      ...(await collectJobDerivedDeletes(bucket, ownerPrefix, keptMaterials)),
    );
    toDelete.push(...(await collectExpiredJobDeletes(bucket, ownerPrefix)));
    toDelete.push(
      ...(await collectResearchCacheDeletes(
        bucket,
        ownerPrefix,
        keptMaterials,
      )),
    );

    const files = await collectOrphanFileDeletes(
      bucket,
      ownerPrefix,
      data,
      protectedMaterials,
    );
    toDelete.push(...files.keys);

    const unique = [...new Set(toDelete)];
    objectCount = unique.length;
    await deleteKeys(bucket, unique);

    if (files.fileIds.length) {
      await rebuildUploadCapacity(bucket, ownerPrefix);
    }

    return objectCount;
  } catch (err) {
    logOrphanCleanupFailure(ownerPrefix, err, objectCount);
    throw err;
  }
}

/**
 * Lance le nettoyage sans bloquer l’appelant.
 * Échec déjà journalisé dans cleanup → nouvelle tentative à la prochaine save.
 */
export function scheduleOrphanTextCleanup(
  bucket: ObjectStore,
  ownerPrefix: string,
  data: { projects?: any[] },
  writeLog: ExternalizeWriteLog,
): void {
  const snapshot = structuredClone(data);
  const texts = new Set(writeLog.texts);
  const vision = new Set(writeLog.vision);
  setImmediate(() => {
    void cleanupOrphanMaterialTexts(bucket, ownerPrefix, snapshot, {
      texts,
      vision,
    }).catch(() => {
      /* journal déjà émis ; réessai à la prochaine sauvegarde */
    });
  });
}
