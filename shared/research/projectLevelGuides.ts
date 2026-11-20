import {
  normalizeProjectType,
  type ProjectTypeId,
} from "./documentStructures";

export type ProjectLevelGuide = {
  label: string;
  question_type: string;
  hypotheses: string;
  field_scale: string;
  theory_depth: string;
  originality: string;
  deliverable: string;
};

const OTHER_GUIDE: ProjectLevelGuide = {
  label: "Autre projet",
  question_type: "précise et circonscrite",
  hypotheses: "1 à 2",
  field_scale: "terrain ou corpus adapté au temps disponible",
  theory_depth: "notions centrales utiles",
  originality: "rigueur exigée",
  deliverable: "document de recherche",
};

/** Guides de niveau par type de projet — un seul fichier, facile à modifier. */
export const PROJECT_LEVEL_GUIDES: Record<ProjectTypeId, ProjectLevelGuide> = {
  licence: {
    label: "Mémoire Licence",
    question_type: "compréhensive, très circonscrite",
    hypotheses: "1 à 2, exploratoires",
    field_scale:
      "5–8 entretiens, ou 20–40 documents, ou exploitation simple d'une base existante",
    theory_depth: "1 ou 2 notions centrales",
    originality: "non exigée, rigueur exigée",
    deliverable: "mémoire de licence",
  },
  m1: {
    label: "Mémoire recherche M1",
    question_type: "précise, un seul objet",
    hypotheses: "1 à 2",
    field_scale:
      "8–12 entretiens, ou 40–80 documents, ou base secondaire existante",
    theory_depth: "bilan de littérature ciblé",
    originality: "modeste",
    deliverable: "mémoire de master 1",
  },
  m2: {
    label: "Mémoire recherche M2",
    question_type: "problématique articulée à un débat identifié",
    hypotheses: "2 à 3 testables",
    field_scale:
      "15–25 entretiens, ou questionnaire 100–300 répondants, ou 100–300 documents, ou base secondaire",
    theory_depth: "dialogue avec un débat théorique précis",
    originality: "apport réel mais limité",
    deliverable: "mémoire de master 2",
  },
  pro: {
    label: "Mémoire professionnel",
    question_type: "ancrée dans une situation professionnelle",
    hypotheses: "1 à 2, liées à un problème opérationnel",
    field_scale:
      "structure d'accueil si un accès est déclaré, sinon données internes ou publiques",
    theory_depth: "outillage théorique au service de l'analyse",
    originality: "recommandations opérationnelles",
    deliverable: "mémoire ou rapport professionnel",
  },
  internship: {
    label: "Rapport de stage",
    question_type: "ancrée dans une situation professionnelle",
    hypotheses: "1 à 2, liées à un problème opérationnel",
    field_scale:
      "structure d'accueil si un accès est déclaré, sinon données internes ou publiques",
    theory_depth: "outillage théorique au service de l'analyse",
    originality: "recommandations opérationnelles",
    deliverable: "rapport de stage",
  },
  thesis: {
    label: "Thèse / doctorat",
    question_type: "contribution originale à un champ",
    hypotheses: "3 à 4, articulées",
    field_scale: "terrain multi-sources, sur 3 à 4 ans",
    theory_depth: "positionnement dans plusieurs débats",
    originality: "contribution originale démontrée",
    deliverable: "thèse",
  },
  article: {
    label: "Article scientifique",
    question_type: "une seule question, un résultat net",
    hypotheses: "1 à 2",
    field_scale:
      "jeu de données ou terrain déjà disponible de préférence",
    theory_depth: "un débat précis",
    originality: "résultat nouveau et circonscrit",
    deliverable: "article ou chapitre",
  },
  book: {
    label: "Livre",
    question_type: "argument d'ensemble décliné en chapitres",
    hypotheses: "thèse générale",
    field_scale: "sources variées",
    theory_depth: "large",
    originality: "synthèse ou thèse originale",
    deliverable: "ouvrage",
  },
  talk: {
    label: "Communication orale",
    question_type: "une seule question, un résultat net",
    hypotheses: "1 à 2",
    field_scale: "données déjà disponibles de préférence",
    theory_depth: "un débat précis",
    originality: "résultat circonscrit",
    deliverable: "communication",
  },
  research_dossier: {
    label: "Dossier de recherche",
    question_type: "précise, un seul objet",
    hypotheses: "1 à 2",
    field_scale: "corpus ou terrain limité",
    theory_depth: "bilan de littérature ciblé",
    originality: "modeste",
    deliverable: "dossier de recherche",
  },
  reading_sheet: {
    label: "Fiche de lecture",
    question_type: "compréhensive, très circonscrite",
    hypotheses: "1, exploratoire",
    field_scale: "un ouvrage ou un ensemble restreint de textes",
    theory_depth: "1 ou 2 notions centrales",
    originality: "non exigée, rigueur exigée",
    deliverable: "fiche de lecture",
  },
  other: OTHER_GUIDE,
};

export function getProjectLevelGuide(
  projectType: string | undefined,
): ProjectLevelGuide {
  const key = normalizeProjectType(projectType);
  return PROJECT_LEVEL_GUIDES[key] ?? OTHER_GUIDE;
}

/** Nombre minimal d'hypothèses indiqué par le guide (premier entier). */
export function minHypothesesFromGuide(guide: ProjectLevelGuide): number {
  const m = guide.hypotheses.match(/(\d+)/);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
