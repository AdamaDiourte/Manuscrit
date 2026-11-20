import { buildUnits, type UnitMaterialInput } from "./units";
import { materialText } from "./project";

export type CorpusEstimate = {
  materials: number;
  characters: number;
  units: number;
  scannedPages: number;
  imageUnits: number;
  /** Durée indicative temps réel (minutes). */
  durationRealtimeMin: number;
  /** Durée indicative mode économique (heures, plafond 24 h). */
  durationBatchHours: number;
  overSyncLimit: boolean;
};

const SYNC_LIMIT = 120_000;

/**
 * Estimation locale avant lancement (sans appel réseau).
 * ~1 unité / 2–4 s en temps réel ; batch jusqu’à 24 h.
 */
export function estimateCorpusAnalysis(
  materials: UnitMaterialInput[],
): CorpusEstimate {
  let characters = 0;
  let units = 0;
  let scannedPages = 0;
  let imageUnits = 0;
  for (const m of materials) {
    characters += materialText(m).length;
    const built = buildUnits(m);
    units += built.length;
    for (const u of built) {
      if (u.scanned) scannedPages += 1;
      if (u.kind === "image") imageUnits += 1;
    }
    if (m.scanned && m.pdfPageCount)
      scannedPages = Math.max(scannedPages, Number(m.pdfPageCount) || 0);
  }
  const durationRealtimeMin = Math.max(
    1,
    Math.ceil((units * 3) / 60) || 1,
  );
  const durationBatchHours = Math.min(24, Math.max(1, Math.ceil(units / 200)));
  return {
    materials: materials.length,
    characters,
    units,
    scannedPages,
    imageUnits,
    durationRealtimeMin,
    durationBatchHours,
    overSyncLimit: characters > SYNC_LIMIT,
  };
}

export { SYNC_LIMIT as CORPUS_SYNC_CHAR_LIMIT };
