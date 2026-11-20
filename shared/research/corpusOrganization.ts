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

/** Consignes spécifiques (établissement, directeur, revue, éditeur). */
export const SPECIFIC_INSTRUCTIONS_MAX = 1000;

export type WritingStructureSection = {
  title: string;
  intent: string;
  role?: PhaseRole;
  /** Sous-parties indicatives si le profil de support les prévoit. */
  subsections?: { title: string; intent: string }[];
};

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

/** Sélecteurs UI — périmètre produit uniquement (pas les types legacy). */
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
    label: "Article, chapitre et livre",
    options: [
      { value: "article", label: PROJECT_TYPE_LABELS.article },
      { value: "book", label: PROJECT_TYPE_LABELS.book },
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

/**
 * Architecture typique selon le genre — alignée sur GENRE_PROFILES
 * (nombre de sections / sous-parties dans les bornes du profil).
 */
export const WRITING_STRUCTURES: Record<
  ProjectTypeId,
  WritingStructureSection[]
> = {
  /** 3–6 sections, sans sous-parties. */
  licence: [
    {
      title: "Introduction et mise en contexte",
      intent: "Situer le sujet et le lecteur avant toute analyse fine.",
      role: "intro",
    },
    {
      title: "Problématique et notions clés",
      intent:
        "Question simple et délimitée ; notions indispensables, sans surcharger.",
      role: "problem",
    },
    {
      title: "Matériaux, méthode et analyses",
      intent:
        "Décrire modestement la méthode puis analyser le corpus du simple au croisé.",
      role: "analysis",
    },
    {
      title: "Discussion, limites et conclusion",
      intent:
        "Synthétiser sans inventer ; l’enjeu est la rigueur, pas l’originalité.",
      role: "discussion",
    },
  ],
  /** 4–8 sections, sans sous-parties. */
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
      intent: "État de l’art solide à partir des notes / références déposées.",
      role: "theory",
    },
    {
      title: "Dispositif méthodologique et terrain exploratoire",
      intent: "Lier méthode et matériaux ; posture réflexive sur l’enquête.",
      role: "method",
    },
    {
      title: "Analyses empiriques structurées",
      intent:
        "Résultats pouvant être préliminaires ; progression simple → complexe.",
      role: "analysis",
    },
    {
      title: "Discussion, perspectives et conclusion",
      intent: "Limites, apports et perspectives pour la suite (souvent le M2).",
      role: "discussion",
    },
  ],
  /** 6–10 sections, sans sous-parties. */
  m2: [
    {
      title: "Introduction et contribution attendue",
      intent: "Clarifier l’enjeu scientifique du mémoire M2.",
      role: "intro",
    },
    {
      title: "Problématique et hypothèses",
      intent: "Problématique originale ; hypothèses explicites.",
      role: "problem",
    },
    {
      title: "Cadre théorique et revue documentaire",
      intent: "Cadre articulé à l’enquête, sans inventer de références.",
      role: "theory",
    },
    {
      title: "Design de recherche et corpus",
      intent: "Justifier le protocole à partir des matériaux existants.",
      role: "method",
    },
    {
      title: "Résultats empiriques",
      intent: "Enquête complète ; constats ordonnés et ancrés.",
      role: "fieldwork",
    },
    {
      title: "Analyses croisées",
      intent: "Du simple au complexe ; multi-matériaux si pertinent.",
      role: "analysis",
    },
    {
      title: "Discussion avec la littérature",
      intent: "Analyse argumentée au regard des travaux cités dans le corpus.",
      role: "discussion",
    },
    {
      title: "Limites, perspectives et conclusion",
      intent: "Apports, limites et ouvertures — sans hallucination.",
      role: "conclusion",
    },
  ],
  /** 5–8 sections : contexte → diagnostic → analyse → préconisations. */
  pro: [
    {
      title: "Contexte professionnel et besoin",
      intent: "Situer l’organisation et la commande sans inventer.",
      role: "intro",
    },
    {
      title: "Problématique professionnelle",
      intent: "Problème issu de l’organisation, analysable avec les données.",
      role: "problem",
    },
    {
      title: "Cadre d’analyse (théorie–pratique)",
      intent: "Lien explicite entre grilles théoriques et pratique.",
      role: "theory",
    },
    {
      title: "Diagnostic à partir des matériaux",
      intent: "Démarche et pièces déposées ; vigilance confidentialité.",
      role: "method",
    },
    {
      title: "Analyse et constats opérationnels",
      intent: "Progression claire, preuves citées.",
      role: "analysis",
    },
    {
      title: "Préconisations, limites et conclusion",
      intent: "Recommandations ancrées ; ce que le mémoire peut produire.",
      role: "conclusion",
    },
  ],
  /** 5–8 sections : même logique professionnelle. */
  internship: [
    {
      title: "Contexte de la structure et du stage",
      intent: "Cadre d’accueil à partir des éléments fournis uniquement.",
      role: "intro",
    },
    {
      title: "Mission, objectifs et problématique",
      intent: "Relier activités et question du rapport.",
      role: "problem",
    },
    {
      title: "Repères d’analyse (théorie–pratique)",
      intent: "Lien explicite entre cadres et pratique de stage.",
      role: "theory",
    },
    {
      title: "Diagnostic et méthode de terrain",
      intent: "Outils et observations documentés ; confidentialité.",
      role: "fieldwork",
    },
    {
      title: "Analyse des activités et des matériaux",
      intent: "Du descriptif simple à l’interprétation progressive.",
      role: "analysis",
    },
    {
      title: "Préconisations, bilan et perspectives",
      intent: "Livrables réalistes sans rédaction à la place de l’auteur.",
      role: "conclusion",
    },
  ],
  /** 6–10 chapitres avec 2–4 sous-parties. */
  thesis: [
    {
      title: "Introduction générale",
      intent:
        "État de l’art, problématique, terrain, méthode, annonce du plan ; contribution originale.",
      role: "intro",
      subsections: [
        { title: "Enjeu et état de l’art", intent: "Situer la contribution." },
        {
          title: "Problématique, terrain et méthode",
          intent: "Annoncer le dispositif et le plan.",
        },
      ],
    },
    {
      title: "Cadre théorique",
      intent: "Concepts et débats mobilisés, ancrés dans les notes déposées.",
      role: "theory",
      subsections: [
        { title: "Concepts structurants", intent: "Définir et articuler." },
        { title: "Débats et positionnement", intent: "Situer l’apport." },
      ],
    },
    {
      title: "Dispositif empirique",
      intent: "Matériaux, critères, limites ; thèse sur articles si signalée.",
      role: "method",
      subsections: [
        { title: "Corpus et critères", intent: "Décrire le réel disponible." },
        { title: "Limites du dispositif", intent: "Assumer ce qui manque." },
      ],
    },
    {
      title: "Chapitre empirique 1",
      intent: "Premier volet d’analyse progressive.",
      role: "analysis",
      subsections: [
        { title: "Constat", intent: "Ce que montrent les matériaux." },
        { title: "Interprétation", intent: "Lien avec les hypothèses." },
      ],
    },
    {
      title: "Chapitre empirique 2",
      intent: "Deuxième volet ; croiser et complexifier.",
      role: "analysis",
      subsections: [
        { title: "Convergences", intent: "Ce qui se confirme." },
        { title: "Tensions", intent: "Contre-exemples et nuances." },
      ],
    },
    {
      title: "Chapitre empirique 3",
      intent: "Approfondissement et synthèse partielle.",
      role: "analysis",
      subsections: [
        { title: "Cas ou axes croisés", intent: "Monter en généralité." },
        { title: "Discussion intermédiaire", intent: "Préparer la conclusion." },
      ],
    },
    {
      title: "Discussion générale",
      intent: "Apports au regard de la littérature et des hypothèses.",
      role: "discussion",
      subsections: [
        { title: "Apports", intent: "Ce que la thèse établit." },
        { title: "Limites", intent: "Ce qui reste hors cadre." },
      ],
    },
    {
      title: "Conclusion générale",
      intent: "Apports, limites et perspectives.",
      role: "conclusion",
      subsections: [
        { title: "Bilan", intent: "Répondre à la question de recherche." },
        { title: "Perspectives", intent: "Ouvertures raisonnables." },
      ],
    },
  ],
  /** 5–8 sections ; sous-parties surtout pour les résultats. */
  article: [
    {
      title: "Introduction : lacune et apport",
      intent: "Argument central, lacune dans la littérature, contribution claire.",
      role: "intro",
    },
    {
      title: "Littérature ciblée",
      intent: "Revue sélective autour de la lacune.",
      role: "theory",
    },
    {
      title: "Méthode et données",
      intent: "Protocole et corpus concis (IMRD ou plan argumentatif selon la discipline).",
      role: "method",
    },
    {
      title: "Résultats",
      intent: "2 à 3 sous-parties de résultats ; matériaux les plus probants seulement.",
      role: "analysis",
      subsections: [
        { title: "Résultat 1", intent: "Premier constat ancré." },
        { title: "Résultat 2", intent: "Deuxième constat ou nuance." },
        { title: "Résultat 3 (optionnel)", intent: "Approfondissement si pertinent." },
      ],
    },
    {
      title: "Discussion",
      intent: "Portée, limites, dialogue avec la littérature.",
      role: "discussion",
    },
    {
      title: "Conclusion",
      intent: "Apport résumé et pistes — sans inventer de données.",
      role: "conclusion",
    },
  ],
  /** 6–12 chapitres avec 2–4 sous-parties. */
  book: [
    {
      title: "Ouverture : enjeu et promesse",
      intent: "Accrocher un lectorat plus large que le jury ; poser le fil directeur.",
      role: "intro",
      subsections: [
        { title: "Scène ou cas d’ouverture", intent: "Accroche narrative." },
        { title: "Enjeu et promesse du livre", intent: "Ce que le lecteur gagnera." },
      ],
    },
    {
      title: "Fil conducteur et question",
      intent: "Clarifier l’argument central chapitre après chapitre.",
      role: "problem",
      subsections: [
        { title: "Question directrice", intent: "Formuler sans jargon excessif." },
        { title: "Architecture du livre", intent: "Annoncer le parcours." },
      ],
    },
    {
      title: "Repères et lectures",
      intent: "Repères utiles ; appareil méthodologique allégé.",
      role: "theory",
      subsections: [
        { title: "Repères conceptuels", intent: "Notions pour le lecteur." },
        { title: "Corpus et sources", intent: "Ce qui nourrit les chapitres." },
      ],
    },
    {
      title: "Chapitre de développement 1",
      intent: "Premier volet ; récit ou cas illustratif.",
      role: "analysis",
      subsections: [
        { title: "Cas ou récit", intent: "Illustration concrète." },
        { title: "Lecture", intent: "Ce que le cas montre." },
      ],
    },
    {
      title: "Chapitre de développement 2",
      intent: "Deuxième volet ; monter en complexité.",
      role: "analysis",
      subsections: [
        { title: "Cas ou récit", intent: "Deuxième illustration." },
        { title: "Croisement", intent: "Lien avec le fil directeur." },
      ],
    },
    {
      title: "Chapitre de développement 3",
      intent: "Troisième volet ; tensions et nuances.",
      role: "analysis",
      subsections: [
        { title: "Tensions", intent: "Ce qui résiste." },
        { title: "Synthèse partielle", intent: "Avancer l’argument." },
      ],
    },
    {
      title: "Synthèse et conclusion",
      intent: "Cohérence d’ensemble, limites du propos, ouverture.",
      role: "discussion",
      subsections: [
        { title: "Bilan", intent: "Ce que le livre établit." },
        { title: "Limites et ouvertures", intent: "Honnêteté et perspectives." },
      ],
    },
  ],
  /** 3–5 parties, sans sous-parties. */
  talk: [
    {
      title: "Accroche et idée forte",
      intent: "Message central compréhensible en quelques minutes.",
      role: "intro",
    },
    {
      title: "Cadre minimal",
      intent: "Repères indispensables avant les preuves.",
      role: "method",
    },
    {
      title: "Preuves illustrées",
      intent: "1 à 2 extraits marquants seulement.",
      role: "analysis",
    },
    {
      title: "Ouverture pour l’auditoire",
      intent: "Ce qu’il faut retenir ; discussion courte.",
      role: "discussion",
    },
  ],
  /** Profils courts, sans sous-parties. */
  research_dossier: [
    {
      title: "Présentation du dossier et du sujet",
      intent: "Clarifier l’objet et le périmètre.",
      role: "intro",
    },
    {
      title: "Angles d’analyse et matériaux",
      intent: "Questions guidant la lecture des pièces.",
      role: "problem",
    },
    {
      title: "Analyses thématiques",
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
      title: "Référence et contexte",
      intent: "Identifier l’ouvrage à partir des notes déposées.",
      role: "intro",
    },
    {
      title: "Thèse et notions clés",
      intent: "Reformuler sans inventer le contenu.",
      role: "theory",
    },
    {
      title: "Extraits et lecture critique",
      intent: "Passages précis + discussion fondée.",
      role: "discussion",
    },
    {
      title: "Utilité pour le projet",
      intent: "Liens avec le manuscrit en cours.",
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
  /**
   * Question de recherche (facultatif).
   * Prioritaire sur `chosenTopic.research_question` dans ProjectContext.
   */
  researchQuestion?: string;
  /**
   * Éléments de cadrage optionnels (parcours « Organiser mon manuscrit »,
   * indépendants du parcours sujet).
   * Prioritaires sur `chosenTopic` dans ProjectContext.
   */
  workingTitle?: string;
  /** Une hypothèse par ligne, ou tableau. */
  hypotheses?: string | string[];
  method?: string;
  fieldOrCorpus?: string;
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
  /**
   * Consignes spécifiques (établissement, directeur, revue, éditeur).
   * Texte libre ≤ SPECIFIC_INSTRUCTIONS_MAX ; primauté sur le profil générique.
   */
  specificInstructions?: string;
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
    /** Texte extrait externalisé (ObjectStore texts/). */
    textStored?: boolean;
    textLength?: number;
  }[],
  excluded: string[] = [],
) {
  return materials.filter((m) => {
    if (excluded.includes(m.id)) return false;
    // Texte extrait externalisé (ObjectStore) : longueur connue ou simple flag.
    if (m.textStored && Number(m.textLength) > 0) return true;
    if (m.textStored) {
      const local = [m.observation, m.text]
        .filter(Boolean)
        .join("\n\n")
        .trim();
      if (local) return true;
    }
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
