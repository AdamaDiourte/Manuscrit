/**
 * Textes extraits hors workspace JSON, adressés par contenu :
 *   owners/{uid}/texts/{materialId}/{hash}
 * Clé historique (repli lecture / migration) :
 *   owners/{uid}/texts/{materialId}
 * Le workspace ne conserve que textStored / textLength / textFingerprint / unitCount.
 */

import { materialText } from "../../../../shared/research/project";
import { buildUnits, hashUnitKey } from "../../../../shared/research/units";
import type { ObjectStore } from "../../storage/types";
import {
  ensureVisionHashStored,
  fingerprintVisionText,
  hasInlineVision,
  stripInlineVisionFields,
  visionTextFrom,
} from "./pipeline/persistVision";

export type MaterialTextPayload = {
  materialId: string;
  hash?: string;
  extracted?: string;
  toolExtracted?: string;
  tables?: unknown;
  updatedAt: string;
};

/** Clé historique (un seul objet par matériau). */
export function textsObjectKey(ownerPrefix: string, materialId: string): string {
  return ownerPrefix + "texts/" + materialId;
}

/** Clé adressée par contenu. */
export function textsHashKey(
  ownerPrefix: string,
  materialId: string,
  hash: string,
): string {
  return ownerPrefix + "texts/" + materialId + "/" + hash;
}

export function isTextContentHash(hash: string | null | undefined): boolean {
  return typeof hash === "string" && /^[a-f0-9]{32}$/i.test(hash);
}

function hasInlineText(m: any): boolean {
  if (!m) return false;
  if (typeof m.extracted === "string" && m.extracted.trim()) return true;
  if (typeof m.toolExtracted === "string" && m.toolExtracted.trim()) return true;
  if (Array.isArray(m.tables) && m.tables.length > 0) return true;
  return false;
}

function stripInlineTextFields(m: any): void {
  delete m.extracted;
  delete m.toolExtracted;
  delete m.tables;
}

export function fingerprintMaterialTexts(payload: {
  extracted?: string;
  toolExtracted?: string;
  tables?: unknown;
}): string {
  return hashUnitKey(
    JSON.stringify({
      e: payload.extracted || "",
      t: payload.toolExtracted || "",
      tables: payload.tables || null,
    }),
  );
}

/** Indicateurs workspace après persistance ObjectStore. */
export function materialTextIndicators(payload: {
  extracted?: string;
  toolExtracted?: string;
  tables?: unknown;
  observation?: string;
  text?: string;
  extra?: Record<string, unknown>;
}): { length: number; hash: string; unitCount: number } {
  const hash = fingerprintMaterialTexts(payload);
  const length = materialText(payload as any).length;
  let unitCount = 0;
  try {
    unitCount = buildUnits(payload as any).length;
  } catch {
    unitCount = 0;
  }
  return { length, hash, unitCount };
}

function applyTextIndicators(
  m: any,
  payload: {
    extracted?: string;
    toolExtracted?: string;
    tables?: unknown;
  },
  hash: string,
): void {
  m.textStored = true;
  m.textFingerprint = hash;
  try {
    m.textLength = materialText({ ...m, ...payload }).length;
  } catch {
    m.textLength = materialText(payload as any).length;
  }
  try {
    m.unitCount = buildUnits({ ...m, ...payload } as any).length;
  } catch {
    if (m.unitCount == null) m.unitCount = 0;
  }
}

async function readJsonPayload(
  bucket: ObjectStore,
  key: string,
): Promise<MaterialTextPayload | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    const data = await object.json<MaterialTextPayload>();
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Charge un texte extrait. Prefère `texts/{id}/{hash}` ; repli sur
 * `texts/{id}` (anciens projets).
 */
export async function loadMaterialTexts(
  bucket: ObjectStore,
  ownerPrefix: string,
  materialId: string,
  hash?: string | null,
): Promise<MaterialTextPayload | null> {
  if (isTextContentHash(hash)) {
    const hashed = await readJsonPayload(
      bucket,
      textsHashKey(ownerPrefix, materialId, hash!),
    );
    if (hashed) return hashed;
  }
  return readJsonPayload(bucket, textsObjectKey(ownerPrefix, materialId));
}

/**
 * Écrit le payload sous `texts/{id}/{hash}` (idempotent si déjà présent).
 * Ne retire jamais les champs inline de l’appelant — réservé à externalize
 * après confirmation.
 */
export async function saveMaterialTexts(
  bucket: ObjectStore,
  ownerPrefix: string,
  materialId: string,
  payload: {
    extracted?: string;
    toolExtracted?: string;
    tables?: unknown;
  },
): Promise<MaterialTextPayload & { hash: string }> {
  const hash = fingerprintMaterialTexts(payload);
  const body: MaterialTextPayload = {
    materialId,
    hash,
    extracted:
      typeof payload.extracted === "string" ? payload.extracted : undefined,
    toolExtracted:
      typeof payload.toolExtracted === "string"
        ? payload.toolExtracted
        : undefined,
    tables: Array.isArray(payload.tables) ? payload.tables : undefined,
    updatedAt: new Date().toISOString(),
  };
  const key = textsHashKey(ownerPrefix, materialId, hash);
  if (!(await bucket.head(key))) {
    await bucket.put(key, JSON.stringify(body));
  }
  return { ...body, hash };
}

/** Migre la clé plate legacy vers `texts/{id}/{hash}` si besoin. */
async function migrateLegacyTextIfNeeded(
  bucket: ObjectStore,
  ownerPrefix: string,
  materialId: string,
  preferredHash?: string | null,
): Promise<string | null> {
  const legacy = await readJsonPayload(
    bucket,
    textsObjectKey(ownerPrefix, materialId),
  );
  if (!legacy) {
    if (isTextContentHash(preferredHash)) {
      const existing = await bucket.head(
        textsHashKey(ownerPrefix, materialId, preferredHash!),
      );
      return existing ? preferredHash! : null;
    }
    return null;
  }
  const payload = {
    extracted: legacy.extracted || "",
    toolExtracted: legacy.toolExtracted || "",
    tables: legacy.tables,
  };
  const hash = fingerprintMaterialTexts(payload);
  const saved = await saveMaterialTexts(
    bucket,
    ownerPrefix,
    materialId,
    payload,
  );
  return saved.hash || hash;
}

/** Attache extracted / toolExtracted / tables depuis ObjectStore (copie mémoire). */
export async function hydrateMaterialsTexts(
  bucket: ObjectStore,
  ownerPrefix: string,
  materials: any[],
): Promise<any[]> {
  return Promise.all(
    materials.map(async (m) => {
      if (!m?.id) return m;
      if (hasInlineText(m)) return m;
      if (!m.textStored) return m;
      const stored = await loadMaterialTexts(
        bucket,
        ownerPrefix,
        m.id,
        m.textFingerprint,
      );
      if (!stored) return m;
      const hash =
        stored.hash ||
        fingerprintMaterialTexts({
          extracted: stored.extracted || "",
          toolExtracted: stored.toolExtracted || "",
          tables: stored.tables,
        });
      return {
        ...m,
        textFingerprint: m.textFingerprint || hash,
        extracted: stored.extracted || "",
        toolExtracted: stored.toolExtracted || "",
        ...(stored.tables ? { tables: stored.tables } : {}),
      };
    }),
  );
}

export type ExternalizeWriteLog = {
  /** Clés logiques `materialId/hash` écrites ou confirmées dans cette passe. */
  texts: Set<string>;
  vision: Set<string>;
};

export function emptyExternalizeWriteLog(): ExternalizeWriteLog {
  return { texts: new Set(), vision: new Set() };
}

/**
 * Persiste le texte inline sous son hash, pose les indicateurs, puis strip.
 * Ne strip que si l’écriture (ou la présence) du hash est confirmée.
 */
async function externalizeInlineTexts(
  bucket: ObjectStore,
  ownerPrefix: string,
  snap: any,
  log: ExternalizeWriteLog,
): Promise<void> {
  if (!snap?.id || !hasInlineText(snap)) {
    // Déjà externalisé : migrer legacy → hash si possible.
    if (snap?.id && snap.textStored) {
      const hash = await migrateLegacyTextIfNeeded(
        bucket,
        ownerPrefix,
        snap.id,
        snap.textFingerprint,
      );
      if (hash) {
        snap.textFingerprint = hash;
        log.texts.add(snap.id + "/" + hash);
      }
    }
    return;
  }
  const payload = {
    extracted: snap.extracted || "",
    toolExtracted: snap.toolExtracted || "",
    tables: snap.tables,
  };
  const saved = await saveMaterialTexts(
    bucket,
    ownerPrefix,
    snap.id,
    payload,
  );
  // Confirmation : l’objet hashé doit être lisible avant strip.
  const confirmed = await bucket.head(
    textsHashKey(ownerPrefix, snap.id, saved.hash),
  );
  if (!confirmed) {
    // Laisser le texte inline — pas de perte silencieuse.
    return;
  }
  log.texts.add(snap.id + "/" + saved.hash);
  applyTextIndicators(snap, payload, saved.hash);
  stripInlineTextFields(snap);
}

async function externalizeInlineVision(
  bucket: ObjectStore,
  ownerPrefix: string,
  snap: any,
  log: ExternalizeWriteLog,
): Promise<void> {
  if (!snap?.id) return;
  if (!hasInlineVision(snap)) {
    if (snap.visionStored) {
      const hash = await ensureVisionHashStored(
        bucket,
        ownerPrefix,
        snap.id,
        snap.visionFingerprint,
      );
      if (hash) {
        snap.visionFingerprint = hash;
        log.vision.add(snap.id + "/" + hash);
      }
    }
    return;
  }
  const text = visionTextFrom(snap);
  if (!text) {
    stripInlineVisionFields(snap);
    return;
  }
  const hash = fingerprintVisionText(text);
  const ok = await ensureVisionHashStored(
    bucket,
    ownerPrefix,
    snap.id,
    hash,
    text,
  );
  if (!ok) return;
  log.vision.add(snap.id + "/" + hash);
  snap.visionStored = true;
  snap.visionFingerprint = hash;
  stripInlineVisionFields(snap);
}

/**
 * Extrait les champs volumineux vers ObjectStore (clé par hash) et laisse
 * des indicateurs sur chaque matériau et chaque instantané versions.
 * Chaque contenu distinct conserve son propre objet — pas d’écrasement.
 */
export async function externalizeProjectMaterialTexts(
  bucket: ObjectStore,
  ownerPrefix: string,
  data: { projects?: any[] },
): Promise<ExternalizeWriteLog> {
  const log = emptyExternalizeWriteLog();
  const projects = Array.isArray(data.projects) ? data.projects : [];
  for (const project of projects) {
    const materials = Array.isArray(project?.materials) ? project.materials : [];
    for (const material of materials) {
      if (!material?.id) continue;
      await externalizeInlineTexts(bucket, ownerPrefix, material, log);
      await externalizeInlineVision(bucket, ownerPrefix, material, log);
    }

    const versions = Array.isArray(project?.versions) ? project.versions : [];
    for (const version of versions) {
      for (const side of ["before", "after"] as const) {
        const snap = version?.[side];
        if (!snap || typeof snap !== "object") continue;
        await externalizeInlineTexts(bucket, ownerPrefix, snap, log);
        await externalizeInlineVision(bucket, ownerPrefix, snap, log);
      }
    }
  }
  return log;
}

/** Préfixe de liste pour tous les hash d’un matériau (+ migration). */
export function textsMaterialPrefix(
  ownerPrefix: string,
  materialId: string,
): string {
  return ownerPrefix + "texts/" + materialId;
}
