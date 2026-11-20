/**
 * Transcriptions vision hors workspace JSON, adressées par contenu :
 *   owners/{uid}/vision/{materialId}/{hash}
 * Clé historique (repli lecture / migration) :
 *   owners/{uid}/vision/{materialId}
 * Le workspace conserve visionStored + visionFingerprint (pas le texte).
 */

import { hashUnitKey } from "../../../../../shared/research/units";
import type { ObjectStore } from "../../../storage/types";
import type { UnitCard } from "./types";

export function visionObjectKey(
  ownerPrefix: string,
  materialId: string,
): string {
  return ownerPrefix + "vision/" + materialId;
}

export function visionHashKey(
  ownerPrefix: string,
  materialId: string,
  hash: string,
): string {
  return ownerPrefix + "vision/" + materialId + "/" + hash;
}

export function isVisionContentHash(
  hash: string | null | undefined,
): boolean {
  return typeof hash === "string" && /^[a-f0-9]{32}$/i.test(hash);
}

export function fingerprintVisionText(text: string): string {
  return hashUnitKey(text);
}

export function hasInlineVision(m: any): boolean {
  if (!m) return false;
  if (typeof m.visionTranscription === "string" && m.visionTranscription.trim())
    return true;
  if (
    typeof m.toolVisionTranscription === "string" &&
    m.toolVisionTranscription.trim()
  )
    return true;
  return false;
}

export function visionTextFrom(m: any): string {
  return [m?.visionTranscription, m?.toolVisionTranscription]
    .filter((v) => typeof v === "string" && String(v).trim())
    .join("\n\n");
}

export function stripInlineVisionFields(m: any): void {
  delete m.visionTranscription;
  delete m.toolVisionTranscription;
}

async function readVisionText(
  bucket: ObjectStore,
  key: string,
): Promise<string | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    const data = await object.json<{ text?: string }>();
    return typeof data.text === "string" && data.text.trim() ? data.text : null;
  } catch {
    return null;
  }
}

/**
 * Charge une transcription. Prefère `vision/{id}/{hash}` ; repli legacy.
 */
export async function loadVisionTranscription(
  bucket: ObjectStore,
  ownerPrefix: string,
  materialId: string,
  hash?: string | null,
): Promise<string | null> {
  if (isVisionContentHash(hash)) {
    const hashed = await readVisionText(
      bucket,
      visionHashKey(ownerPrefix, materialId, hash!),
    );
    if (hashed) return hashed;
  }
  return readVisionText(bucket, visionObjectKey(ownerPrefix, materialId));
}

/**
 * Assure la présence de `vision/{id}/{hash}`. Si `text` est fourni, l’écrit.
 * Sinon migre depuis la clé legacy si le hash correspond ou si preferredHash
 * est absent. Retourne le hash confirmé, ou null si rien n’a pu être écrit.
 */
export async function ensureVisionHashStored(
  bucket: ObjectStore,
  ownerPrefix: string,
  materialId: string,
  preferredHash?: string | null,
  text?: string | null,
): Promise<string | null> {
  let body = typeof text === "string" && text.trim() ? text : null;
  let hash = isVisionContentHash(preferredHash)
    ? preferredHash!
    : body
      ? fingerprintVisionText(body)
      : null;

  if (hash) {
    const key = visionHashKey(ownerPrefix, materialId, hash);
    if (await bucket.head(key)) return hash;
  }

  if (!body) {
    const legacy = await readVisionText(
      bucket,
      visionObjectKey(ownerPrefix, materialId),
    );
    if (!legacy) {
      if (
        hash &&
        (await bucket.head(visionHashKey(ownerPrefix, materialId, hash)))
      )
        return hash;
      return null;
    }
    body = legacy;
    const legacyHash = fingerprintVisionText(legacy);
    if (hash && hash !== legacyHash) {
      // Hash déclaré ≠ legacy : conserver le legacy sous son propre hash.
      const legacyKey = visionHashKey(ownerPrefix, materialId, legacyHash);
      if (!(await bucket.head(legacyKey))) {
        await bucket.put(
          legacyKey,
          JSON.stringify({
            materialId,
            hash: legacyHash,
            text: legacy,
            updatedAt: new Date().toISOString(),
          }),
        );
      }
      return (await bucket.head(legacyKey)) ? legacyHash : null;
    }
    hash = legacyHash;
  }

  if (!hash || !body) return null;
  const key = visionHashKey(ownerPrefix, materialId, hash);
  if (!(await bucket.head(key))) {
    await bucket.put(
      key,
      JSON.stringify({
        materialId,
        hash,
        text: body,
        updatedAt: new Date().toISOString(),
      }),
    );
  }
  return (await bucket.head(key)) ? hash : null;
}

/** Attache visionTranscription aux matériaux (copie en mémoire, workspace inchangé). */
export async function hydrateMaterialsVision(
  bucket: ObjectStore,
  ownerPrefix: string,
  materials: any[],
): Promise<any[]> {
  return Promise.all(
    materials.map(async (m) => {
      if (!m?.id) return m;
      if (
        typeof m.visionTranscription === "string" &&
        m.visionTranscription.trim()
      )
        return m;
      if (!m.visionStored && !m.scanned && m.kind !== "image") {
        // Pas de signal de vision stockée : laisser tel quel.
      }
      const text = await loadVisionTranscription(
        bucket,
        ownerPrefix,
        m.id,
        m.visionFingerprint,
      );
      if (!text) return m;
      const hash = m.visionFingerprint || fingerprintVisionText(text);
      return { ...m, visionTranscription: text, visionFingerprint: hash };
    }),
  );
}

export async function persistVisionTranscriptions(
  bucket: ObjectStore,
  ownerPrefix: string,
  projectId: string,
  cards: UnitCard[],
): Promise<void> {
  const byMaterial = new Map<string, string>();
  for (const card of cards) {
    const t = (card.transcription || "").trim();
    if (!t) continue;
    const prev = byMaterial.get(card.materialId) || "";
    byMaterial.set(card.materialId, prev ? prev + "\n\n" + t : t);
  }
  if (!byMaterial.size) return;

  const hashes = new Map<string, string>();
  for (const [materialId, text] of byMaterial) {
    const hash = await ensureVisionHashStored(
      bucket,
      ownerPrefix,
      materialId,
      null,
      text,
    );
    if (hash) hashes.set(materialId, hash);
  }

  // Flag léger dans le workspace (pas le texte).
  const key = ownerPrefix + "workspace";
  for (let attempt = 0; attempt < 6; attempt++) {
    const object = await bucket.get(key);
    if (!object) return;
    const data = await object.json<{ projects?: any[] }>();
    const project = (data.projects || []).find((p) => p.id === projectId);
    if (!project?.materials) return;

    let changed = false;
    for (const material of project.materials) {
      if (!byMaterial.has(material.id)) continue;
      const hash = hashes.get(material.id);
      if (material.visionStored !== true) {
        material.visionStored = true;
        changed = true;
      }
      if (hash && material.visionFingerprint !== hash) {
        material.visionFingerprint = hash;
        changed = true;
      }
      if (material.visionTranscription) {
        delete material.visionTranscription;
        changed = true;
      }
      if (material.toolVisionTranscription) {
        delete material.toolVisionTranscription;
        changed = true;
      }
    }
    if (!changed) return;

    const saved = await bucket.put(key, JSON.stringify(data), {
      onlyIf: { etagMatches: object.etag },
    });
    if (saved) return;
  }
}
