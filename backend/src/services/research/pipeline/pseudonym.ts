/**
 * Table de correspondance pseudonymisation.
 * Clé ObjectStore : owners/{uid}/jobs/{jobId}/pseudonym-map
 *
 * Règles : jamais envoyée au fournisseur IA, jamais journalisée,
 * jamais exportée (Word / API publique) ; supprimée en fin de tâche
 * (done / failed / cancelled) et lors de la purge projet / compte.
 */

import type { ObjectStore } from "../../../storage/types";
import {
  pseudonymizeText,
  restorePseudonyms,
  type PseudonymMap,
} from "../../../../../shared/research/pseudonymizeCorpus";

export function pseudonymMapKey(ownerPrefix: string, jobId: string): string {
  return ownerPrefix + "jobs/" + jobId + "/pseudonym-map";
}

export async function loadPseudonymMap(
  bucket: ObjectStore,
  ownerPrefix: string,
  jobId: string,
): Promise<PseudonymMap> {
  const object = await bucket.get(pseudonymMapKey(ownerPrefix, jobId));
  if (!object) return {};
  try {
    return (await object.json<PseudonymMap>()) || {};
  } catch {
    return {};
  }
}

export async function savePseudonymMap(
  bucket: ObjectStore,
  ownerPrefix: string,
  jobId: string,
  map: PseudonymMap,
): Promise<void> {
  await bucket.put(pseudonymMapKey(ownerPrefix, jobId), JSON.stringify(map));
}

/** Efface la table (best-effort). */
export async function deletePseudonymMap(
  bucket: ObjectStore,
  ownerPrefix: string,
  jobId: string,
): Promise<void> {
  try {
    await bucket.delete(pseudonymMapKey(ownerPrefix, jobId));
  } catch {
    /* ignore */
  }
}

export function applyPseudonymToText(
  text: string,
  names: string[],
  map: PseudonymMap,
): { text: string; map: PseudonymMap } {
  return pseudonymizeText(text, names, map);
}

export function restoreEvidenceQuote(
  quote: string,
  map: PseudonymMap,
): string {
  return restorePseudonyms(quote, map);
}
