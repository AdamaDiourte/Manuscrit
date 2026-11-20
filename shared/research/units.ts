/**
 * Découpage d’un matériau en unités d’analyse (fonction pure).
 * Cible : 3 000–6 000 caractères aux frontières naturelles.
 */

import { isInterviewMaterial } from "./interviewMarkers";
import {
  materialCollectionModeLabel,
  materialText,
  materialTextBaseLength,
} from "./project";
import type { TableSheetStructure } from "./tableStats";

export const UNIT_MIN_CHARS = 3000;
export const UNIT_MAX_CHARS = 6000;

export type UnitKind = "text" | "table" | "image";

export type ResearchUnit = {
  id: string;
  materialId: string;
  kind: UnitKind;
  /** Offset inclusif dans materialText(m). */
  start: number;
  /** Offset exclusif dans materialText(m). */
  end: number;
  page?: number;
  sheet?: string;
  label: string;
  /** Texte de l’unité (= materialText.slice(start, end)). */
  text: string;
  /** Structure + stats (tableaux) — calculées hors IA. */
  table?: TableSheetStructure;
  /** Fichier binaire (image / PDF scanné) pour vision. */
  fileId?: string;
  scanned?: boolean;
  /** Mode de recueil (outil / type), libellé lisible. */
  collectionMode?: string;
  /**
   * Marqueur de l’enquêteur dans la transcription (ex. « AD : »).
   * S’il est renseigné, remplace la détection automatique pour ce matériau.
   */
  interviewerMarker?: string;
};

export type UnitMaterialInput = {
  id: string;
  observation?: string;
  text?: string;
  extracted?: string;
  toolExtracted?: string;
  visionTranscription?: string;
  toolVisionTranscription?: string;
  extra?: Record<string, unknown>;
  toolType?: string;
  type?: string;
  file?: string;
  filename?: string;
  toolFile?: string;
  tables?: TableSheetStructure[];
  scanned?: boolean;
  extractionStatus?: string;
  pdfPageCount?: number;
  interviewerMarker?: string;
};

/** Hash synchrone portable (FNV-1a 128 bits simulés) — stable front/back. */
export function hashUnitKey(input: string): string {
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x01000193 >>> 0;
  let h3 = 0x811c9dc5 >>> 0;
  let h4 = 0x01000193 >>> 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + (i & 255)), 0x01000193) >>> 0;
    h3 = Math.imul(h3 ^ ((c << 1) + i), 0x01000193) >>> 0;
    h4 = Math.imul(h4 ^ (c ^ (h1 & 255)), 0x01000193) >>> 0;
  }
  return (
    h1.toString(16).padStart(8, "0") +
    h2.toString(16).padStart(8, "0") +
    h3.toString(16).padStart(8, "0") +
    h4.toString(16).padStart(8, "0")
  );
}

type Marker = {
  index: number;
  page?: number;
  sheet?: string;
  label: string;
};

const PAGE_RE = /\[Page\s+(\d+)\]/g;
const SHEET_RE = /Feuille\s+«\s*([^»]+?)\s*»/g;

function findMarkers(text: string): Marker[] {
  const markers: Marker[] = [{ index: 0, label: "Début" }];
  for (const match of text.matchAll(PAGE_RE)) {
    if (match.index === undefined) continue;
    markers.push({
      index: match.index,
      page: Number(match[1]),
      label: `Page ${match[1]}`,
    });
  }
  for (const match of text.matchAll(SHEET_RE)) {
    if (match.index === undefined) continue;
    markers.push({
      index: match.index,
      sheet: match[1].trim(),
      label: `Feuille « ${match[1].trim()} »`,
    });
  }
  markers.sort((a, b) => a.index - b.index || a.label.localeCompare(b.label));
  const dedup: Marker[] = [];
  for (const m of markers) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.index === m.index) {
      dedup[dedup.length - 1] = { ...prev, ...m, label: m.label || prev.label };
    } else dedup.push(m);
  }
  return dedup;
}

/** Frontiers naturelles dans un intervalle [from, to). */
function breakPoints(text: string, from: number, to: number): number[] {
  const points = new Set<number>([from]);
  const slice = text.slice(from, to);
  const patterns = [/\n\n+/g, /\n/g, /(?<=[.!?…])\s+/g];
  for (const re of patterns) {
    for (const match of slice.matchAll(re)) {
      if (match.index === undefined) continue;
      const at = from + match.index + match[0].length;
      if (at > from && at < to) points.add(at);
    }
  }
  points.add(to);
  return [...points].sort((a, b) => a - b);
}

function packRange(
  text: string,
  from: number,
  to: number,
  meta: { page?: number; sheet?: string; label: string },
  materialId: string,
  kind: UnitKind,
): ResearchUnit[] {
  if (to <= from) return [];
  const length = to - from;
  if (length <= UNIT_MAX_CHARS) {
    const unitText = text.slice(from, to);
    if (!unitText.trim()) return [];
    return [makeUnit(materialId, kind, from, to, unitText, meta)];
  }

  const points = breakPoints(text, from, to);
  const units: ResearchUnit[] = [];
  let cursor = from;
  let activeMeta = meta;

  while (cursor < to) {
    const remaining = to - cursor;
    if (remaining <= UNIT_MAX_CHARS) {
      const unitText = text.slice(cursor, to);
      if (unitText.trim())
        units.push(makeUnit(materialId, kind, cursor, to, unitText, activeMeta));
      break;
    }

    const target = cursor + UNIT_MIN_CHARS;
    const limit = Math.min(cursor + UNIT_MAX_CHARS, to);
    let cut = -1;
    for (const p of points) {
      if (p <= cursor) continue;
      if (p < target) continue;
      if (p > limit) break;
      cut = p;
      break;
    }
    if (cut < 0) {
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        if (p > cursor && p <= limit) {
          cut = p;
          break;
        }
      }
    }
    if (cut < 0 || cut <= cursor) cut = limit;

    const unitText = text.slice(cursor, cut);
    if (unitText.trim())
      units.push(makeUnit(materialId, kind, cursor, cut, unitText, activeMeta));
    cursor = cut;
    activeMeta = {
      ...activeMeta,
      label: `${meta.label} (suite)`,
    };
  }
  return units;
}

function makeUnit(
  materialId: string,
  kind: UnitKind,
  start: number,
  end: number,
  text: string,
  meta: { page?: number; sheet?: string; label: string },
): ResearchUnit {
  const id = hashUnitKey(`${materialId}|${start}|${end}|${text}`);
  return {
    id,
    materialId,
    kind,
    start,
    end,
    page: meta.page,
    sheet: meta.sheet,
    label: meta.label,
    text,
  };
}

function inferKind(material: UnitMaterialInput): UnitKind {
  const name = `${material.filename || ""}`.toLowerCase();
  const type = `${material.toolType || ""} ${material.type || ""}`.toLowerCase();
  if (
    material.tables?.length ||
    /\.(xlsx|csv|tsv)$/.test(name) ||
    /tableau|xlsx|csv|tsv|statistique|excel|tableur/.test(type)
  )
    return "table";
  if (
    /\.(png|jpe?g|webp|gif)$/.test(name) ||
    /image|photo|graphique|figure|carte/.test(type) ||
    material.extractionStatus === "empty"
  )
    return "image";
  return "text";
}

function attachTableMeta(
  units: ResearchUnit[],
  tables: TableSheetStructure[] | undefined,
): ResearchUnit[] {
  if (!tables?.length) return units;
  const bySheet = new Map(tables.map((t) => [t.sheet, t]));
  return units.map((u) => {
    if (u.sheet && bySheet.has(u.sheet))
      return { ...u, kind: "table" as const, table: bySheet.get(u.sheet) };
    if (units.length === 1 && tables.length === 1)
      return { ...u, kind: "table" as const, table: tables[0], sheet: tables[0].sheet };
    return u;
  });
}

/**
 * Découpe materialText(m) en unités 3–6 kcar. aux frontières [Page N],
 * « Feuille « … » », paragraphes.
 *
 * La zone vision (transcription IA) est découpée à part et ajoutée à la fin :
 * les unités / offsets du texte auteur restent stables.
 */
export function buildUnits(material: UnitMaterialInput): ResearchUnit[] {
  const materialId = String(material.id || "").trim();
  if (!materialId) return [];
  const kind = inferKind(material);
  const fileId = material.file || material.toolFile;
  const scanned = Boolean(material.scanned);

  // Découpage sur le texte auteur uniquement (hors visionTranscription).
  const baseOnly: UnitMaterialInput = {
    ...material,
    visionTranscription: undefined,
    toolVisionTranscription: undefined,
  };
  let baseText = materialText(baseOnly);
  const fullText = materialText(material);
  const baseLen = materialTextBaseLength(material);

  // Image sans texte : unité visuelle synthétique.
  if (!baseText.trim() && kind === "image" && fileId) {
    const placeholder =
      "[Image — analyse visuelle en attente]\n" +
      (material.observation || "");
    baseText = placeholder.trim();
    const unit = makeUnit(
      materialId,
      "image",
      0,
      baseText.length,
      baseText,
      { label: "Image" },
    );
    return [{ ...unit, fileId, kind: "image" }];
  }

  if (!baseText.trim() && !fullText.trim()) return [];

  const units: ResearchUnit[] = [];

  if (baseText.trim()) {
    const markers = findMarkers(baseText);
    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].index;
      const end = i + 1 < markers.length ? markers[i + 1].index : baseText.length;
      let page = markers[i].page;
      let sheet = markers[i].sheet;
      let label = markers[i].label;
      for (let j = i; j >= 0; j--) {
        if (page === undefined && markers[j].page !== undefined)
          page = markers[j].page;
        if (sheet === undefined && markers[j].sheet !== undefined)
          sheet = markers[j].sheet;
        if (page !== undefined && sheet !== undefined) break;
      }
      if (label === "Début") {
        label =
          page !== undefined
            ? `Page ${page}`
            : sheet
              ? `Feuille « ${sheet} »`
              : "Passage";
      }
      const packed = packRange(
        baseText,
        start,
        end,
        { page, sheet, label },
        materialId,
        kind,
      ).map((u) => ({
        ...u,
        ...(fileId && (scanned || kind === "image")
          ? { fileId, scanned: scanned || undefined }
          : {}),
      }));
      units.push(...packed);
    }
  }

  // Transcription vision : unités après la base (offsets dans materialText complet).
  if (fullText.length > baseLen) {
    const visionStart = baseLen === 0 ? 0 : baseLen + 2; // "\n\n" entre base et vision
    if (visionStart < fullText.length) {
      const visionPacked = packRange(
        fullText,
        visionStart,
        fullText.length,
        { label: "Transcription automatique" },
        materialId,
        kind === "image" ? "image" : "text",
      ).map((u) => ({
        ...u,
        ...(fileId && (scanned || kind === "image")
          ? { fileId, scanned: scanned || undefined }
          : {}),
      }));
      units.push(...visionPacked);
    }
  }

  const mode = materialCollectionModeLabel(material);
  const interview = isInterviewMaterial({
    type: material.type,
    toolType: material.toolType,
    collectionMode: mode,
  });
  const marker = interview
    ? String(material.interviewerMarker || "").trim()
    : "";
  const withMode = attachTableMeta(units, material.tables).map((u) => ({
    ...u,
    ...(mode ? { collectionMode: mode } : {}),
    ...(marker ? { interviewerMarker: marker } : {}),
  }));
  return withMode;
}

export type StoredUnitsPayload = {
  materialId: string;
  textLength: number;
  units: ResearchUnit[];
  updatedAt: string;
};
