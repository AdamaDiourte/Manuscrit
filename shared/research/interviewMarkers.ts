/**
 * Détection des tours de parole de l’enquêteur dans une transcription.
 * « E : » et les initiales seules sont exclus (ambiguïté enquêté / enquêteur).
 */

/** Marqueurs automatiques sans ambiguïté (insensible à la casse). */
export const AUTO_INTERVIEWER_MARKERS = [
  "Q",
  "Question",
  "Enquêteur",
  "Enquêtrice",
  "Intervieweur",
  "Chercheur",
  "Chercheuse",
] as const;

/**
 * Type, outil ou mode de recueil relevant de l’entretien
 * (entretien, grille d’entretien, récit de vie, focus group, etc.).
 */
const INTERVIEW_MATERIAL_RE =
  /entretien|focus[\s_-]*group|r[ée]cit[\s_-]*de[\s_-]*vie|life[\s_-]*stor(?:y|ies)|interview/i;

export type InterviewMaterialLike = {
  type?: string;
  toolType?: string;
  collectionMode?: string;
};

/** True si le matériau relève de l’entretien (type, outil ou mode de recueil). */
export function isInterviewMaterial(m?: InterviewMaterialLike | null): boolean {
  if (!m) return false;
  return [m.type, m.toolType, m.collectionMode]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .some((part) => INTERVIEW_MATERIAL_RE.test(part));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Regex ancrée en début de ligne / de quote ; espace optionnel avant « : ». */
export function interviewerPrefixRegex(customMarker?: string): RegExp {
  const custom = String(customMarker || "").trim();
  if (custom) {
    const label = custom.replace(/\s*[:：]\s*$/u, "").trim();
    if (!label) return /a^/; // jamais
    return new RegExp(`^${escapeRegExp(label)}\\s*[:：]`, "iu");
  }
  const alts = AUTO_INTERVIEWER_MARKERS.map(escapeRegExp).join("|");
  return new RegExp(`^(?:${alts})\\s*[:：]`, "iu");
}

/**
 * True si la quote semble provenir d’un tour enquêteur.
 * Si `customMarker` est fourni, il remplace entièrement la détection automatique.
 */
export function looksLikeInterviewerTurn(
  quote: string,
  fullText: string,
  customMarker?: string,
): boolean {
  const trimmed = String(quote || "").trim();
  if (!trimmed) return false;
  const re = interviewerPrefixRegex(customMarker);
  if (re.test(trimmed)) return true;
  const start = fullText.indexOf(quote);
  if (start < 0) return false;
  const lineStart = fullText.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const linePrefix = fullText
    .slice(lineStart, start + Math.min(64, quote.length))
    .trimStart();
  return re.test(linePrefix);
}

/**
 * Filtre les quotes d’enquêteur. Si plus de 80 % seraient rejetées,
 * conserve tout et signale `aborted` (marqueur probablement faux).
 */
export function filterInterviewerQuotes(
  quotes: string[],
  fullText: string,
  customMarker?: string,
): { quotes: string[]; aborted: boolean; rejectedCount: number } {
  const list = (quotes || []).filter((q) => q && q.length >= 3);
  if (!list.length)
    return { quotes: [], aborted: false, rejectedCount: 0 };
  const rejected = list.filter((q) =>
    looksLikeInterviewerTurn(q, fullText, customMarker),
  );
  const ratio = rejected.length / list.length;
  if (ratio > 0.8)
    return { quotes: list, aborted: true, rejectedCount: rejected.length };
  const kept = list.filter(
    (q) => !looksLikeInterviewerTurn(q, fullText, customMarker),
  );
  return {
    quotes: kept,
    aborted: false,
    rejectedCount: rejected.length,
  };
}
