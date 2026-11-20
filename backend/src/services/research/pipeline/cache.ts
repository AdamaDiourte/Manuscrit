import type { ObjectStore } from "../../../storage/types";
import { hashUnitKey } from "../../../../../shared/research/units";
import { ENGINE_VERSION } from "../engine";
import type { UnitCard } from "./types";

export function extractCacheKey(
  unitId: string,
  unitText: string,
  promptVersion: string,
  model: string,
  /** Hash pertinence (RQ, hypothèses, type, discipline). */
  relevanceHash = "",
  /** Marqueur enquêteur — invalide le cache si corrigé pour ce matériau. */
  interviewerMarker = "",
): string {
  return hashUnitKey(
    [
      unitId,
      unitText,
      promptVersion,
      ENGINE_VERSION,
      model,
      relevanceHash,
      String(interviewerMarker || "").trim(),
    ].join("|"),
  );
}

export function unitCachePrefix(ownerPrefix: string): string {
  return ownerPrefix + "unit-cache/";
}

function objectKey(ownerPrefix: string, cacheHash: string): string {
  return unitCachePrefix(ownerPrefix) + cacheHash;
}

export async function readExtractCache(
  bucket: ObjectStore,
  ownerPrefix: string,
  cacheHash: string,
): Promise<UnitCard | null> {
  const object = await bucket.get(objectKey(ownerPrefix, cacheHash));
  if (!object) return null;
  try {
    return await object.json<UnitCard>();
  } catch {
    return null;
  }
}

export async function writeExtractCache(
  bucket: ObjectStore,
  ownerPrefix: string,
  cacheHash: string,
  card: UnitCard,
): Promise<void> {
  await bucket.put(objectKey(ownerPrefix, cacheHash), JSON.stringify(card));
}
