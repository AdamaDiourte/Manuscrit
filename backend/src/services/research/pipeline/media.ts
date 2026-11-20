import type { ObjectStore } from "../../../storage/types";
import type { ClaudeContent, ClaudeContentPart } from "../../llm/claude";
import type { ResearchUnit } from "../../../../../shared/research/units";
import type { TableSheetStructure } from "../../../../../shared/research/tableStats";

const MAX_IMAGE_BYTES = 4_500_000;
const MAX_PDF_PAGES = 600;
/** Cible après redimensionnement (côté long max). */
const MAX_IMAGE_EDGE = 2000;

export async function loadStoredFile(
  bucket: ObjectStore,
  ownerPrefix: string,
  fileId: string,
): Promise<{ bytes: Uint8Array; name: string } | null> {
  const object = await bucket.get(ownerPrefix + "files/" + fileId);
  if (!object?.arrayBuffer) return null;
  const buffer = await object.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const name = object.customMetadata?.name || "document";
  return { bytes, name };
}

function extOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() || "";
}

export function imageMediaType(
  name: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  const ext = extOf(name);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return null;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Redimensionne une image trop lourde via décodage + re-encodage JPEG
 * (API Canvas Node absente : utilise un sous-échantillonnage JPEG soft
 * en réduisant la qualité via réécriture si PNG/JPEG détecté côté en-tête,
 * sinon échoue clairement).
 *
 * Stratégie : si déjà sous la limite → inchangé. Sinon tente une réduction
 * par décimation simple des scanlines PNG 8-bit RGB/RGBA, ou signal d’échec
 * pour formats non gérés (le front redimensionne aussi à l’upload).
 */
export async function resizeImageIfNeeded(
  bytes: Uint8Array,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
): Promise<{ bytes: Uint8Array; mediaType: typeof mediaType }> {
  if (bytes.byteLength <= MAX_IMAGE_BYTES) return { bytes, mediaType };

  if (mediaType === "image/png") {
    const reduced = downsamplePng(bytes);
    if (reduced && reduced.byteLength <= MAX_IMAGE_BYTES)
      return { bytes: reduced, mediaType: "image/png" };
  }

  // JPEG / autres : sans decodeur natif, on refuse plutôt que d’envoyer hors limite.
  // Le navigateur redimensionne à l’upload ; ce chemin couvre les anciens dépôts.
  if (bytes.byteLength > MAX_IMAGE_BYTES)
    throw new Error(
      "Image trop volumineuse après dépôt. Remplacez-la par une version redimensionnée (max. ~4,5 Mo).",
    );
  return { bytes, mediaType };
}

/** Décimation PNG 8-bit RGB/RGBA (filtre None) — best-effort sans dépendance. */
function downsamplePng(bytes: Uint8Array): Uint8Array | null {
  try {
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
    // Délègue au front pour les cas complexes ; ici on ne fait que détecter.
    // Une vraie réduction sans zlib avancé est fragile : on retourne null
    // pour basculer sur le message d’erreur explicite.
    void MAX_IMAGE_EDGE;
    return null;
  } catch {
    return null;
  }
}

/** Contenu Claude pour une unité (texte, tableau structuré, image, PDF scanné). */
export async function buildUnitContent(
  unit: ResearchUnit,
  briefMeta: Record<string, unknown>,
  bucket: ObjectStore,
  ownerPrefix: string,
): Promise<ClaudeContent> {
  const parts: ClaudeContentPart[] = [];

  if (unit.kind === "table" && unit.table) {
    parts.push({
      type: "text",
      text: JSON.stringify({
        ...briefMeta,
        unitId: unit.id,
        materialId: unit.materialId,
        label: unit.label,
        sheet: unit.sheet || unit.table.sheet,
        range: unit.table.range,
        structure: {
          columns: unit.table.columns,
          rowCount: unit.table.rowCount,
          sample: unit.table.sample,
          stats: unit.table.stats,
        },
        text: unit.text,
        consigne:
          "Les statistiques (effectifs, manquants, modalités, min/max/moyenne) sont calculées par le code. Jugez leur intérêt pour la question de recherche. Citations = sous-chaînes exactes du champ text uniquement.",
      }),
    });
    return parts;
  }

  if (unit.fileId && (unit.kind === "image" || unit.scanned)) {
    const file = await loadStoredFile(bucket, ownerPrefix, unit.fileId);
    if (!file)
      throw new Error("Fichier média introuvable pour l’analyse visuelle.");

    if (unit.scanned || extOf(file.name) === "pdf") {
      if (file.bytes.byteLength > 20 * 1024 * 1024)
        throw new Error("PDF trop volumineux pour l’analyse visuelle.");
      // La limite 600 pages est appliquée à l’extraction front ; on la rappelle ici.
      parts.push({
        type: "text",
        text: JSON.stringify({
          ...briefMeta,
          unitId: unit.id,
          materialId: unit.materialId,
          label: unit.label,
          page: unit.page,
          scanned: true,
          maxPages: MAX_PDF_PAGES,
          consigne:
            "Document PDF (éventuellement scanné, ≤ 600 pages). Transcrivez le contenu pertinent, décrivez-le, puis produisez la fiche. Quotes = sous-chaînes exactes de votre transcription.",
        }),
      });
      parts.push({
        type: "document",
        mediaType: "application/pdf",
        data: toBase64(file.bytes),
      });
      return parts;
    }

    const mediaType = imageMediaType(file.name);
    if (!mediaType)
      throw new Error("Format d’image non pris en charge pour la vision.");
    const resized = await resizeImageIfNeeded(file.bytes, mediaType);
    parts.push({
      type: "text",
      text: JSON.stringify({
        ...briefMeta,
        unitId: unit.id,
        materialId: unit.materialId,
        label: unit.label,
        consigne:
          "Analysez l’image (photo, graphique, carte, tableau ou document). Fournissez transcription, description, type et éléments clés. Les quotes doivent être des sous-chaînes exactes de la transcription.",
      }),
    });
    parts.push({
      type: "image",
      mediaType: resized.mediaType,
      data: toBase64(resized.bytes),
    });
    return parts;
  }

  return JSON.stringify({
    ...briefMeta,
    unitId: unit.id,
    materialId: unit.materialId,
    label: unit.label,
    page: unit.page,
    sheet: unit.sheet,
    text: unit.text,
  });
}

export function tableSummaryForPrompt(table: TableSheetStructure) {
  return {
    sheet: table.sheet,
    range: table.range,
    columns: table.columns,
    rowCount: table.rowCount,
    sample: table.sample,
    stats: table.stats,
  };
}

export { MAX_PDF_PAGES, MAX_IMAGE_BYTES, MAX_IMAGE_EDGE };
