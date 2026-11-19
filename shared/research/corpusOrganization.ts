/**
 * Cadrage et règles du parcours « Organiser mon manuscrit » :
 * projet → consentement → matériaux (mode de recueil sur chaque fiche) → cadrage → plan.
 */

import {
  PROJECT_TYPE_LABELS,
  normalizeProjectType,
  type ProjectTypeId,
} from "./documentStructures";
import type { PhaseRole } from "./workPlan";

/** Ordre : projet → avertissement → dépôt matériaux → cadrage → plan IA. */
export const CORPUS_STEPS = [
  "project",
  "notice",
  "materials",
  "frame",
  "plan",
] as const;

export type CorpusStep = (typeof CORPUS_STEPS)[number];

export const CORPUS_STEP_LABELS: Record<CorpusStep, string> = {
  project: "Projet",
  notice: "Consentement",
  materials: "Matériaux",
  frame: "Cadrage du manuscrit",
  plan: "Plan de rédaction",
};

/** Anciens modes (brouillons) — les modes viennent désormais du type de chaque fiche. */
export const COLLECTION_MODE_OPTIONS = [
  { value: "interview_guide", label: "Grille d’entretien" },
  { value: "interview", label: "Entretien réalisé" },
  { value: "questionnaire", label: "Questionnaire" },
  { value: "questionnaire_answers", label: "Réponses au questionnaire" },
  { value: "observation_guide", label: "Grille d’observation" },
  { value: "observation", label: "Notes d’observation" },
  { value: "reading_notes", label: "Notes de lecture bibliographiques" },
  { value: "archive", label: "Archives/données secondaires" },
  { value: "map", label: "Cartes / SIG" },
  { value: "other_tool", label: "Autre outil" },
  { value: "none", label: "Aucun" },
  { value: "other", label: "Autres" },
] as const;

export const DOCUMENT_TYPE_GROUPS: {
  label: string;
  options: { value: ProjectTypeId; label: string }[];
}[] = [
  {
    label: "Mémoires et doctorat",
    options: [
      { value: "licence", label: PROJECT_TYPE_LABELS.licence },
      { value: "m1", label: PROJECT_TYPE_LABELS.m1 },
      { value: "m2", label: PROJECT_TYPE_LABELS.m2 },
      { value: "pro", label: PROJECT_TYPE_LABELS.pro },
      { value: "thesis", label: PROJECT_TYPE_LABELS.thesis },
    ],
  },
  {
    label: "Article, livre, dossier et fiche",
    options: [
      { value: "article", label: PROJECT_TYPE_LABELS.article },
      { value: "book", label: PROJECT_TYPE_LABELS.book },
      { value: "research_dossier", label: PROJECT_TYPE_LABELS.research_dossier },
      { value: "reading_sheet", label: PROJECT_TYPE_LABELS.reading_sheet },
    ],
  },
  {
    label: "Autres",
    options: [
      { value: "internship", label: PROJECT_TYPE_LABELS.internship },
      { value: "other", label: PROJECT_TYPE_LABELS.other },
    ],
  },
];

export const DISCIPLINE_OPTIONS = [
  "Anthropologie",
  "Droit",
  "Économie",
  "Études urbaines",
  "Géographie",
  "Gestion / management",
  "Histoire",
  "Informatique",
  "Lettres",
  "Linguistique",
  "Philosophie",
  "Psychologie",
  "Santé publique",
  "Science politique",
  "Sciences de l’éducation",
  "Sciences de l’information et de la communication",
  "Sociologie",
  "Statistique",
  "Autre",
].map((label) => ({
  value: label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, ""),
  label,
}));

export const EXPECTED_LENGTH_OPTIONS = [
  { value: "short", label: "Moins de 30 pages" },
  { value: "medium", label: "30 à 80 pages" },
  { value: "long", label: "Plus de 80 pages" },
  { value: "book_volume", label: "Volume livre (environ 150 pages ou plus)" },
  { value: "unknown", label: "Je ne sais pas encore" },
] as const;

/** Temps de rédaction disponible — sert au planning associé au plan. */
export const WRITING_TIME_OPTIONS = [
  { value: "2_weeks", label: "2 semaines", days: 14 },
  { value: "1_month", label: "1 mois", days: 30 },
  { value: "6_weeks", label: "6 semaines", days: 42 },
  { value: "2_months", label: "2 mois", days: 60 },
  { value: "3_months", label: "3 mois", days: 90 },
  { value: "6_months", label: "6 mois", days: 180 },
  { value: "1_year", label: "1 an", days: 365 },
] as const;

/** Présentation du sujet (cadrage) : bornes de longueur. */
export const BRIEF_MIN_CHARS = 80;
export const BRIEF_MAX_CHARS = 2000;

/** Architecture de rédaction typique selon le genre — progressive, du cadrage à la synthèse. */
export const WRITING_STRUCTURES: Record<
  ProjectTypeId,
  { title: string; intent: string; role?: PhaseRole }[]
> = {
  licence: [
    {
      title: "Introduction et mise en contexte",
      intent: "Situer le sujet et le lecteur avant toute analyse fine.",
      role: "intro",
    },
    {
      title: "Problématique et hypothèses",
      intent: "Formuler la question directrice de façon réaliste pour une licence.",
      role: "problem",
    },
    {
      title: "Repères théoriques ou notions clés",
      intent: "Introduire les outils conceptuels nécessaires, sans surcharger.",
      role: "theory",
    },
    {
      title: "Présentation des matériaux et de la méthode",
      intent: "Expliquer comment les données ont été recueillies et seront lues.",
      role: "method",
    },
    {
      title: "Analyses progressives des matériaux",
      intent: "Du constat simple au croisement plus exigeant, en citant le corpus.",
      role: "analysis",
    },
    {
      title: "Discussion, limites et conclusion",
      intent: "Synthétiser sans inventer ; ouvrir sur ce que les données ne couvrent pas.",
      role: "discussion",
    },
  ],
  m1: [
    {
      title: "Introduction et enjeux",
      intent: "Positionner le sujet dans le champ et motiver la lecture.",
      role: "intro",
    },
    {
      title: "Problématique, questions et hypothèses",
      intent: "Opérationnaliser la question pour un mémoire M1.",
      role: "problem",
    },
    {
      title: "Cadre théorique et état des lieux",
      intent: "Mobiliser notes de lecture / références déposées uniquement.",
      role: "theory",
    },
    {
      title: "Dispositif méthodologique",
      intent: "Lier méthode et matériaux réellement disponibles.",
      role: "method",
    },
    {
      title: "Analyses empiriques structurées",
      intent: "Progression simple → complexe ; chaque partie ancrée dans des extraits.",
      role: "analysis",
    },
    {
      title: "Discussion et conclusion",
      intent: "Recouper résultats, limites et apports au regard des données.",
      role: "discussion",
    },
  ],
  m2: [
    {
      title: "Introduction et contribution attendue",
      intent: "Clarifier l’enjeu scientifique du mémoire M2.",
      role: "intro",
    },
    {
      title: "Problématique et hypothèses",
      intent: "Exigence analytique tenable avec le corpus déposé.",
      role: "problem",
    },
    {
      title: "Cadre théorique et revue documentaire",
      intent: "S’appuyer sur les notes / références fournies, sans inventer.",
      role: "theory",
    },
    {
      title: "Design de recherche et corpus",
      intent: "Justifier le protocole à partir des matériaux existants.",
      role: "method",
    },
    {
      title: "Résultats et analyses croisées",
      intent: "Organiser les constats du simple au complexe, multi-matériaux si pertinent.",
      role: "analysis",
    },
    {
      title: "Discussion, limites, perspectives",
      intent: "Déduire strictement des preuves déposées.",
      role: "discussion",
    },
  ],
  pro: [
    {
      title: "Contexte professionnel et besoin",
      intent: "Situer la commande ou la mission sans inventer d’organisation.",
      role: "intro",
    },
    {
      title: "Problématique professionnelle",
      intent: "Question utile et analysable avec les données fournies.",
      role: "problem",
    },
    {
      title: "Cadre d’analyse",
      intent: "Grilles et notions adaptées au double lectorat.",
      role: "theory",
    },
    {
      title: "Démarche et matériaux",
      intent: "Montrer comment les pièces déposées alimentent le raisonnement.",
      role: "method",
    },
    {
      title: "Analyses et constats opérationnels",
      intent: "Progression claire, preuves citées, recommandations ancrées.",
      role: "analysis",
    },
    {
      title: "Livrables, limites et conclusion",
      intent: "Ce que le mémoire peut raisonnablement produire.",
      role: "conclusion",
    },
  ],
  internship: [
    {
      title: "Contexte de la structure et du stage",
      intent: "Cadre d’accueil à partir des éléments fournis uniquement.",
      role: "intro",
    },
    {
      title: "Mission, objectifs et problématique du rapport",
      intent: "Relier activités et question de rapport.",
      role: "problem",
    },
    {
      title: "Méthode de travail sur le terrain",
      intent: "Outils et observations effectivement documentés.",
      role: "fieldwork",
    },
    {
      title: "Analyse des activités et des matériaux",
      intent: "Du descriptif simple à l’interprétation progressive.",
      role: "analysis",
    },
    {
      title: "Bilan, apprentissages et perspectives",
      intent: "Synthèse sans rédaction à la place de l’auteur.",
      role: "conclusion",
    },
  ],
  thesis: [
    {
      title: "Positionnement et introduction générale",
      intent: "Enjeu scientifique et fil directeur de la thèse.",
      role: "intro",
    },
    {
      title: "Problématique, hypothèses et questions",
      intent: "Niveau doctoral, mais ancré dans le corpus disponible.",
      role: "problem",
    },
    {
      title: "État de l’art et cadre théorique",
      intent: "Uniquement à partir des références / notes déposées.",
      role: "theory",
    },
    {
      title: "Dispositif empirique",
      intent: "Matériaux, critères et limites du terrain documenté.",
      role: "method",
    },
    {
      title: "Chapitres d’analyse progressive",
      intent: "Architecture argumentative simple → complexe, preuves citées.",
      role: "analysis",
    },
    {
      title: "Discussion générale et conclusion",
      intent: "Apports, limites, ouverture — sans hallucination.",
      role: "discussion",
    },
  ],
  article: [
    {
      title: "Introduction et enjeu",
      intent: "Accroche scientifique courte, ancrée dans le sujet déclaré.",
      role: "intro",
    },
    {
      title: "Cadre et revue ciblée",
      intent: "Mobiliser les notes / références fournies seulement.",
      role: "theory",
    },
    {
      title: "Méthode et corpus",
      intent: "Transparence sur les matériaux réellement analysables.",
      role: "method",
    },
    {
      title: "Résultats",
      intent: "Constats ordonnés, chaque affirmation liée à une preuve.",
      role: "analysis",
    },
    {
      title: "Discussion et conclusion",
      intent: "Portée, limites, pistes — sans inventer de données.",
      role: "discussion",
    },
  ],
  book: [
    {
      title: "Ouverture et promesse du livre",
      intent: "Situer le sujet, le lectorat et le fil conducteur sans rédiger le manuscrit.",
      role: "intro",
    },
    {
      title: "Problématique et architecture argumentative",
      intent: "Clarifier ce que le livre doit démontrer, chapitre après chapitre.",
      role: "problem",
    },
    {
      title: "Repères, lectures et corpus",
      intent: "Organiser les matériaux et références qui nourriront les chapitres.",
      role: "theory",
    },
    {
      title: "Chapitres de développement",
      intent: "Progression du simple au complexe, chaque partie ancrée dans des preuves.",
      role: "analysis",
    },
    {
      title: "Transitions, synthèse et conclusion",
      intent: "Assurer la cohérence d’ensemble et les limites du propos.",
      role: "discussion",
    },
  ],
  talk: [
    {
      title: "Accroche et enjeu",
      intent: "Message central compréhensible rapidement.",
      role: "intro",
    },
    {
      title: "Cadre et méthode",
      intent: "Repères indispensables avant les preuves.",
      role: "method",
    },
    {
      title: "Résultats illustrés",
      intent: "Quelques extraits forts du corpus, bien choisis.",
      role: "analysis",
    },
    {
      title: "Ouverture et discussion",
      intent: "Ce que l’auditoire doit retenir.",
      role: "discussion",
    },
  ],
  research_dossier: [
    {
      title: "Présentation du dossier et du sujet",
      intent: "Clarifier l’objet et le périmètre.",
      role: "intro",
    },
    {
      title: "Problématique et angles d’analyse",
      intent: "Questions guidant la lecture des pièces.",
      role: "problem",
    },
    {
      title: "Matériaux et critères de sélection",
      intent: "Pourquoi ces documents, comment les lire.",
      role: "method",
    },
    {
      title: "Analyses thématiques progressives",
      intent: "Du simple au complexe, preuves citées.",
      role: "analysis",
    },
    {
      title: "Synthèse et perspectives",
      intent: "Ce que le dossier permet de conclure.",
      role: "conclusion",
    },
  ],
  reading_sheet: [
    {
      title: "Référence et contexte de lecture",
      intent: "Identifier l’ouvrage ou l’article à partir des notes déposées.",
      role: "intro",
    },
    {
      title: "Thèse ou argument principal",
      intent: "Reformuler sans inventer.",
      role: "problem",
    },
    {
      title: "Structure et notions clés",
      intent: "Repères pour la fiche.",
      role: "theory",
    },
    {
      title: "Extraits à mobiliser et discussion critique",
      intent: "Passages précis + lecture critique fondée.",
      role: "discussion",
    },
    {
      title: "Liens avec le projet de l’auteur",
      intent: "Utilité pour le manuscrit en cours.",
      role: "conclusion",
    },
  ],
  other: [
    {
      title: "Introduction et objet",
      intent: "Clarifier le type de document et le sujet.",
      role: "intro",
    },
    {
      title: "Cadre et méthode",
      intent: "Adapter au genre déclaré par l’auteur.",
      role: "method",
    },
    {
      title: "Analyses fondées sur les matériaux",
      intent: "Progression simple → complexe avec preuves.",
      role: "analysis",
    },
    {
      title: "Synthèse et limites",
      intent: "Conclusions strictement dérivées du corpus.",
      role: "conclusion",
    },
  ],
};

export type CorpusFrame = {
  documentType?: string;
  documentTypeOther?: string;
  discipline?: string;
  disciplineOther?: string;
  specialty?: string;
  brief?: string;
  expectedLength?: string;
  /** Temps de rédaction disponible (WRITING_TIME_OPTIONS). */
  writingTime?: string;
  /**
   * Date de démarrage du planning (YYYY-MM-DD).
   * Vide / absent = aujourd’hui au moment du calcul.
   */
  startDate?: string;
  /** Modes de recueil cochés (valeurs de COLLECTION_MODE_OPTIONS). */
  collectionModes?: string[];
  collectionModesOther?: string;
  /** Précision libre si plusieurs modes sont combinés. */
  collectionCombinedNote?: string;
  corpusNoticeAccepted?: boolean;
  corpusAiAccepted?: boolean;
  corpusPrivacyAccepted?: boolean;
  /** Confirmation que le projet actif accueillera données + sorties IA. */
  corpusProjectConfirmed?: boolean;
};

export function disciplineLabel(value?: string, other?: string) {
  if (!value) return "";
  if (value === "autre") return (other || "").trim() || "Autre";
  return (
    DISCIPLINE_OPTIONS.find((d) => d.value === value)?.label || value
  );
}

export function documentTypeLabel(value?: string, other?: string) {
  const id = normalizeProjectType(value);
  if (id === "other" && other?.trim()) return other.trim();
  return PROJECT_TYPE_LABELS[id];
}

export function expectedLengthLabel(value?: string) {
  return (
    EXPECTED_LENGTH_OPTIONS.find((o) => o.value === value)?.label ||
    value ||
    ""
  );
}

export function writingTimeOption(value?: string) {
  return WRITING_TIME_OPTIONS.find((o) => o.value === value);
}

export function writingTimeLabel(value?: string) {
  return writingTimeOption(value)?.label || value || "";
}

export function writingTimeDays(value?: string) {
  return writingTimeOption(value)?.days || 0;
}

export function writingStructureFor(documentType?: string) {
  return WRITING_STRUCTURES[normalizeProjectType(documentType)];
}

export function collectionModeLabels(modes: string[] = [], other?: string) {
  return modes
    .map((value) => {
      if (value === "other")
        return (other || "").trim() || "Autres";
      return (
        COLLECTION_MODE_OPTIONS.find((o) => o.value === value)?.label || value
      );
    })
    .filter(Boolean);
}

/** Modes de recueil déduits des outils et données des fiches. */
export function modesFromMaterials(
  materials: { type?: string; toolType?: string }[] = [],
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const m of materials) {
    for (const label of [(m.toolType || "").trim(), (m.type || "").trim()]) {
      if (!label || label === "Aucun" || seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

/** @deprecated Conservé pour d’anciens brouillons ; préférer modesFromMaterials. */
export function collectionIsComplete(
  frame: CorpusFrame,
  materials: { type?: string }[] = [],
) {
  if (modesFromMaterials(materials).length > 0) return true;
  const modes = Array.isArray(frame.collectionModes)
    ? frame.collectionModes
    : [];
  return modes.length > 0;
}

export function projectIsReady(
  project: { demo?: boolean; title?: string; id?: string } | null | undefined,
  frame: CorpusFrame,
) {
  if (!project || project.demo) return false;
  return Boolean(
    frame.corpusProjectConfirmed && (project.title || "").trim(),
  );
}

/** Brief envoyé au moteur d’analyse (cadrage auteur, sans le texte des matériaux). */
export function buildCorpusBrief(
  frame: CorpusFrame,
  materials: { type?: string }[] = [],
): string {
  const typeLabel = documentTypeLabel(
    frame.documentType,
    frame.documentTypeOther,
  );
  const disc = disciplineLabel(frame.discipline, frame.disciplineOther);
  const length = expectedLengthLabel(frame.expectedLength);
  const time = writingTimeLabel(frame.writingTime);
  const specialty = (frame.specialty || "").trim();
  const summary = (frame.brief || "").trim();
  const modes =
    modesFromMaterials(materials).length > 0
      ? modesFromMaterials(materials)
      : collectionModeLabels(
          frame.collectionModes,
          frame.collectionModesOther,
        );
  const combined = (frame.collectionCombinedNote || "").trim();
  const parts = [
    typeLabel && `Type de manuscrit visé : ${typeLabel}`,
    disc && `Discipline : ${disc}`,
    specialty && `Spécialité / sous-domaine : ${specialty}`,
    length && `Volume prévisionnel : ${length}`,
    time && `Temps de rédaction disponible : ${time}`,
    modes.length > 0 &&
      `Modes de recueil / types de matériaux : ${modes.join(" ; ")}`,
    combined &&
      `Combinaison des modes (précision de l’auteur) :\n${combined}`,
    summary && `Présentation du sujet par l’auteur :\n${summary}`,
  ].filter(Boolean);
  return parts.join("\n\n");
}

export function frameIsComplete(frame: CorpusFrame) {
  const typeOk =
    Boolean(frame.documentType) &&
    (frame.documentType !== "other" ||
      Boolean((frame.documentTypeOther || "").trim()));
  const disciplineOk =
    Boolean(frame.discipline) &&
    (frame.discipline !== "autre" ||
      Boolean((frame.disciplineOther || "").trim()));
  const briefLen = (frame.brief || "").trim().length;
  const summaryOk =
    briefLen >= BRIEF_MIN_CHARS && briefLen <= BRIEF_MAX_CHARS;
  const lengthOk = Boolean(frame.expectedLength);
  const timeOk = Boolean(frame.writingTime && writingTimeOption(frame.writingTime));
  return typeOk && disciplineOk && summaryOk && lengthOk && timeOk;
}

export function noticesAccepted(frame: CorpusFrame) {
  return Boolean(
    frame.corpusNoticeAccepted &&
      frame.corpusAiAccepted &&
      frame.corpusPrivacyAccepted,
  );
}

export function usableMaterials(
  materials: {
    id: string;
    observation?: string;
    text?: string;
    extracted?: string;
    toolExtracted?: string;
    extra?: Record<string, unknown>;
  }[],
  excluded: string[] = [],
) {
  return materials.filter((m) => {
    if (excluded.includes(m.id)) return false;
    const text = [
      m.observation,
      m.text,
      m.extracted,
      m.toolExtracted,
      ...Object.entries(m.extra || {})
        .filter(([, v]) => typeof v === "string" && v)
        .map(([, v]) => v),
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();
    return Boolean(text);
  });
}

export function canRequestWritingPlan(
  frame: CorpusFrame,
  materials: {
    id: string;
    type?: string;
    observation?: string;
    text?: string;
    extracted?: string;
    extra?: Record<string, unknown>;
  }[],
  excluded: string[] = [],
  project?: { demo?: boolean; title?: string; id?: string } | null,
) {
  return (
    (!project || projectIsReady(project, frame)) &&
    noticesAccepted(frame) &&
    frameIsComplete(frame) &&
    usableMaterials(materials, excluded).length > 0
  );
}
