import {
  normalizeProjectType,
  type DocumentKind,
  type ProjectTypeId,
} from "./documentStructures";

/** Préfixe fichier pour un plan de travail. */
export const WORK_PLAN_FILENAME_PREFIX = "plan-de-travail";

/** Préfixe fichier du document principal selon le type de projet. */
export function researchProjectFilenamePrefix(
  projectType: ProjectTypeId | string | undefined,
): string {
  const type = normalizeProjectType(projectType);
  switch (type) {
    case "licence":
    case "m1":
    case "m2":
    case "pro":
      return "projet-de-memoire";
    case "thesis":
      return "projet-de-these";
    case "article":
      return "projet-d-article";
    case "internship":
      return "projet-de-rapport-de-stage";
    case "book":
      return "projet-de-livre";
    case "talk":
      return "projet-de-communication";
    case "research_dossier":
      return "projet-de-dossier-de-recherche";
    case "reading_sheet":
      return "projet-de-fiche-de-lecture";
    default:
      return "projet-de-recherche";
  }
}

export function docxFilenamePrefix(
  kind: DocumentKind | "plan" | "schedule" | string,
  projectType?: ProjectTypeId | string,
): string {
  if (kind === "work_plan" || kind === "plan" || kind === "schedule") {
    return WORK_PLAN_FILENAME_PREFIX;
  }
  return researchProjectFilenamePrefix(projectType);
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Slug ASCII minuscules, tirets ; sans préfixe document déjà présent. */
export function slugifyDocTitle(title: string, prefix: string): string {
  let raw = stripDiacritics(String(title || ""))
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const prefixSlug = stripDiacritics(prefix)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  // Évite plan-de-travail-plan-de-travail-…
  while (prefixSlug && (raw === prefixSlug || raw.startsWith(prefixSlug + "-"))) {
    raw = raw.slice(prefixSlug.length).replace(/^-+/, "");
  }
  // Retire aussi « plan de travail : » / « projet de mémoire : » en tête du titre.
  raw = raw
    .replace(
      /^(plan-de-travail|projet-de-recherche|projet-de-memoire|projet-de-these|projet-d-article)-+/,
      "",
    )
    .replace(/^-|-$/g, "");
  return raw;
}

/** Coupe à au plus `max` caractères, à la fin d’un mot (tiret). */
export function truncateSlugAtWord(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const lastDash = cut.lastIndexOf("-");
  if (lastDash >= Math.floor(max * 0.4)) return cut.slice(0, lastDash);
  return cut.replace(/-+$/, "");
}

/** Petits mots à retirer en fin de slug après coupe (accents déjà normalisés). */
const TRAILING_STOPWORDS = new Set([
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "l",
  "d",
  "et",
  "a",
  "en",
  "au",
  "aux",
]);

/** Retire de/du/des/la/… en queue de slug (ex. …-jeunes-adultes-de → …-jeunes-adultes). */
export function stripTrailingStopwords(slug: string): string {
  const parts = slug.split("-").filter(Boolean);
  while (parts.length > 1 && TRAILING_STOPWORDS.has(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join("-");
}

function todayIsoDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Nom de fichier DOCX : `<préfixe>-<titre-slug>` ≤ 60 car. (coupe fin de mot)
 * puis `-AAAA-MM-JJ.docx`. Le préfixe n’est jamais doublé.
 */
export function buildDocxFilename(
  kind: DocumentKind | "plan" | "schedule" | string,
  title: string,
  projectType?: ProjectTypeId | string,
  now = new Date(),
  options?: { prefixOverride?: string },
): string {
  const prefix = (
    options?.prefixOverride ||
    docxFilenamePrefix(kind, projectType)
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const titleSlug = slugifyDocTitle(title, prefix);
  const combined = titleSlug ? `${prefix}-${titleSlug}` : prefix;
  const truncated =
    stripTrailingStopwords(
      truncateSlugAtWord(combined, 60).replace(/-+$/, ""),
    ) || prefix;
  return `${truncated}-${todayIsoDate(now)}.docx`;
}
