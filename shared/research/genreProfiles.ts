/**
 * Profils de support (genre) — source unique de vérité pour bornes,
 * ambitions et attentes transmises à l’IA et à l’interface.
 */

import {
  normalizeProjectType,
  PROJECT_TYPE_LABELS,
  type ProjectTypeId,
} from "./documentStructures";

export type UsageMateriaux = "exhaustif" | "selectif";

export type GenreProfile = {
  label: string;
  volumeIndicatif: string;
  ambition: string;
  sections: { min: number; max: number };
  sousParties: { active: boolean; min: number; max: number };
  attentesTheorie: string;
  attentesMethode: string;
  usageMateriaux: UsageMateriaux;
  preuvesParSection: { min: number; max: number };
  lectorat: string;
  pointsDeVigilance: string;
};

/** Plafond absolu (tous genres) — schémas Zod / listes. */
export const GENRE_SECTIONS_ABS_MAX = 12;
export const GENRE_SUBSECTIONS_ABS_MAX = 4;

export const GENRE_PROFILES: Record<ProjectTypeId, GenreProfile> = {
  licence: {
    label: PROJECT_TYPE_LABELS.licence,
    volumeIndicatif: "20–40 pages",
    ambition:
      "Initiation à la recherche : question simple et bien délimitée ; l’enjeu est la rigueur et la maîtrise des notions, pas l’originalité.",
    sections: { min: 3, max: 6 },
    sousParties: { active: false, min: 0, max: 0 },
    attentesTheorie:
      "Cadre théorique restreint : notions clés bien définies, quelques références.",
    attentesMethode:
      "Méthode modeste, décrite simplement ; hypothèses facultatives.",
    usageMateriaux: "selectif",
    preuvesParSection: { min: 1, max: 2 },
    lectorat: "Jury de licence ; exigences de clarté et de correction.",
    pointsDeVigilance:
      "Plan simple en deux ou trois parties, sans sous-parties ; ne pas viser l’originalité au détriment de la rigueur.",
  },
  m1: {
    label: PROJECT_TYPE_LABELS.m1,
    volumeIndicatif: "40–80 pages",
    ambition:
      "Souvent étape vers le M2 : état de l’art solide, problématique construite, terrain exploratoire ; résultats pouvant être préliminaires et présentés comme tels.",
    sections: { min: 4, max: 8 },
    sousParties: { active: false, min: 0, max: 0 },
    attentesTheorie: "État de l’art solide et notions articulées à la question.",
    attentesMethode:
      "Terrain exploratoire ; posture réflexive sur l’enquête ; perspectives pour la suite.",
    usageMateriaux: "exhaustif",
    preuvesParSection: { min: 2, max: 3 },
    lectorat: "Jury de Master 1 ; préparation éventuelle au M2.",
    pointsDeVigilance:
      "Assumer le caractère préliminaire des résultats ; ouvrir des perspectives pour la suite.",
  },
  m2: {
    label: PROJECT_TYPE_LABELS.m2,
    volumeIndicatif: "80–150 pages",
    ambition:
      "Problématique originale ; cadre théorique articulé à l’enquête ; hypothèses explicites ; enquête empirique complète ; analyse argumentée et discussion avec la littérature ; limites.",
    sections: { min: 6, max: 10 },
    sousParties: { active: false, min: 0, max: 0 },
    attentesTheorie:
      "Cadre théorique articulé à l’enquête et discussion avec la littérature.",
    attentesMethode:
      "Hypothèses explicites ; enquête empirique complète ; limites assumées.",
    usageMateriaux: "exhaustif",
    preuvesParSection: { min: 2, max: 3 },
    lectorat: "Jury de Master 2 recherche.",
    pointsDeVigilance:
      "Maintenir le lien théorie–enquête ; ne pas éluder les limites ni les contre-exemples.",
  },
  pro: {
    label: PROJECT_TYPE_LABELS.pro,
    volumeIndicatif: "Variable selon l’établissement (souvent 40–80 pages)",
    ambition:
      "Problème issu d’une organisation ; structure contexte → diagnostic → analyse → préconisations ; lien explicite entre théorie et pratique ; posture professionnelle.",
    sections: { min: 5, max: 8 },
    sousParties: { active: false, min: 0, max: 0 },
    attentesTheorie: "Lien explicite entre cadres d’analyse et pratique professionnelle.",
    attentesMethode:
      "Démarche de diagnostic et d’analyse ancrée dans les matériaux de l’organisation.",
    usageMateriaux: "exhaustif",
    preuvesParSection: { min: 2, max: 2 },
    lectorat: "Jury académique et lecteurs professionnels de l’organisation.",
    pointsDeVigilance:
      "Confidentialité de l’organisation ; rester factuel et opérationnel sans inventer de contexte.",
  },
  internship: {
    label: PROJECT_TYPE_LABELS.internship,
    volumeIndicatif: "Variable selon l’établissement",
    ambition:
      "Problème issu d’une organisation ; structure contexte → diagnostic → analyse → préconisations ; lien explicite entre théorie et pratique ; posture professionnelle.",
    sections: { min: 5, max: 8 },
    sousParties: { active: false, min: 0, max: 0 },
    attentesTheorie: "Lien explicite entre cadres d’analyse et pratique de stage.",
    attentesMethode:
      "Démarche de terrain documentée ; analyse des activités et matériaux déposés.",
    usageMateriaux: "exhaustif",
    preuvesParSection: { min: 2, max: 2 },
    lectorat: "Jury académique et structure d’accueil.",
    pointsDeVigilance:
      "Confidentialité de l’organisation ; ne pas inventer missions ni données internes.",
  },
  thesis: {
    label: PROJECT_TYPE_LABELS.thesis,
    volumeIndicatif: "300–500 pages",
    ambition:
      "Contribution originale explicite ; introduction générale développée (état de l’art, problématique, terrain, méthode, annonce du plan) ; chapitres empiriques successifs ; conclusion générale avec apports, limites et perspectives.",
    sections: { min: 6, max: 10 },
    sousParties: { active: true, min: 2, max: 4 },
    attentesTheorie:
      "État de l’art et cadre théorique au niveau doctoral, articulés à la contribution.",
    attentesMethode:
      "Dispositif empirique complet ; possibilité d’une thèse sur articles si l’auteur la signale.",
    usageMateriaux: "exhaustif",
    preuvesParSection: { min: 3, max: 5 },
    lectorat: "Jury doctoral ; communauté scientifique du domaine.",
    pointsDeVigilance:
      "Sous-parties obligatoires (2 à 4 par chapitre) ; 3 à 5 preuves par sous-partie ; signaler une thèse sur articles si déclaré.",
  },
  article: {
    label: PROJECT_TYPE_LABELS.article,
    volumeIndicatif: "8 000–12 000 mots selon la revue",
    ambition:
      "Un argument central et une contribution claire ; introduction avec lacune dans la littérature et apport ; littérature ciblée ; méthode et données concises ; 2 à 3 sous-parties de résultats ; discussion.",
    sections: { min: 5, max: 8 },
    sousParties: { active: true, min: 0, max: 3 },
    attentesTheorie: "Littérature ciblée autour de la lacune et de l’apport.",
    attentesMethode:
      "Méthode et données concises ; structure IMRD pour disciplines quantitatives ou expérimentales, plan argumentatif pour les humanités.",
    usageMateriaux: "selectif",
    preuvesParSection: { min: 2, max: 3 },
    lectorat: "Comité de revue et pairs du domaine.",
    pointsDeVigilance:
      "Usage sélectif : beaucoup de fiches resteront légitimement non utilisées ; choisir les matériaux les plus probants.",
  },
  book: {
    label: PROJECT_TYPE_LABELS.book,
    volumeIndicatif: "Volume livre (souvent 150 pages ou plus)",
    ambition:
      "Lectorat plus large que le jury ; introduction qui accroche et pose l’enjeu ; chapitres relativement autonomes mais reliés par un fil directeur ; appareil méthodologique allégé (introduction ou annexe) ; récits et cas illustratifs privilégiés.",
    sections: { min: 6, max: 12 },
    sousParties: { active: true, min: 2, max: 4 },
    attentesTheorie:
      "Repères et lectures au service du fil directeur, sans appareil excessif.",
    attentesMethode:
      "Appareil méthodologique allégé (introduction ou annexe) ; privilégier récits et cas illustratifs.",
    usageMateriaux: "selectif",
    preuvesParSection: { min: 2, max: 4 },
    lectorat: "Public élargi (au-delà du seul jury académique) ; éditeur éventuel.",
    pointsDeVigilance:
      "Chapitres avec 2 à 4 sous-parties ; 2 à 4 preuves par sous-partie ; usage sélectif du corpus.",
  },
  talk: {
    label: PROJECT_TYPE_LABELS.talk,
    volumeIndicatif: "15–20 minutes",
    ambition: "Une idée forte, 3 à 5 parties ; extraits marquants seulement.",
    sections: { min: 3, max: 5 },
    sousParties: { active: false, min: 0, max: 0 },
    attentesTheorie: "Repères minimaux avant les preuves orales.",
    attentesMethode: "Cadre et méthode très condensés.",
    usageMateriaux: "selectif",
    preuvesParSection: { min: 1, max: 2 },
    lectorat: "Auditoire de colloque ou séminaire.",
    pointsDeVigilance:
      "Usage très sélectif ; 1 à 2 extraits marquants par partie ; une seule idée forte.",
  },
  research_dossier: {
    label: PROJECT_TYPE_LABELS.research_dossier,
    volumeIndicatif: "Dossier court à moyen",
    ambition:
      "Clarifier l’objet, les angles d’analyse et une synthèse ancrée dans les pièces déposées.",
    sections: { min: 3, max: 6 },
    sousParties: { active: false, min: 0, max: 0 },
    attentesTheorie: "Repères utiles au dossier, sans revue exhaustive.",
    attentesMethode: "Critères de sélection et de lecture des pièces.",
    usageMateriaux: "selectif",
    preuvesParSection: { min: 1, max: 2 },
    lectorat: "Encadrant ou commanditaire du dossier.",
    pointsDeVigilance: "Sans sous-parties ; rester proportionné au format dossier.",
  },
  reading_sheet: {
    label: PROJECT_TYPE_LABELS.reading_sheet,
    volumeIndicatif: "Fiche courte",
    ambition:
      "Restituer thèse, structure et lecture critique d’une œuvre à partir des notes déposées.",
    sections: { min: 3, max: 5 },
    sousParties: { active: false, min: 0, max: 0 },
    attentesTheorie: "Notions clés de l’œuvre, sans inventer le contenu.",
    attentesMethode: "Angle de lecture et extraits à mobiliser.",
    usageMateriaux: "selectif",
    preuvesParSection: { min: 1, max: 2 },
    lectorat: "Encadrant ou soi-même (outil de travail).",
    pointsDeVigilance: "Sans sous-parties ; ne pas inventer le contenu de l’œuvre.",
  },
  other: {
    label: PROJECT_TYPE_LABELS.other,
    volumeIndicatif: "Selon le type déclaré par l’auteur",
    ambition:
      "Adapter le plan au genre déclaré ; progression claire ancrée dans les matériaux.",
    sections: { min: 3, max: 8 },
    sousParties: { active: false, min: 0, max: 0 },
    attentesTheorie: "Repères adaptés au type déclaré.",
    attentesMethode: "Démarche adaptée au type déclaré.",
    usageMateriaux: "selectif",
    preuvesParSection: { min: 1, max: 3 },
    lectorat: "Selon le type déclaré.",
    pointsDeVigilance: "Sans sous-parties par défaut ; respecter le volume et les consignes de l’auteur.",
  },
};

export function genreProfileFor(documentType?: string): GenreProfile {
  return GENRE_PROFILES[normalizeProjectType(documentType)];
}

/** Rubrique « Attentes du support visé » pour le brief IA (phrases courtes). */
export function formatGenreExpectations(profile: GenreProfile): string {
  const sous = profile.sousParties.active
    ? `Sous-parties actives : ${profile.sousParties.min} à ${profile.sousParties.max} par section.`
    : "Sans sous-parties.";
  const usage =
    profile.usageMateriaux === "exhaustif"
      ? "Usage exhaustif du corpus : les thèmes importants doivent trouver leur place."
      : "Usage sélectif du corpus : construire autour d’un argument central ; des fiches peuvent rester non utilisées.";
  return [
    `Support : ${profile.label} (${profile.volumeIndicatif}).`,
    `Ambition : ${profile.ambition}`,
    `Sections : ${profile.sections.min} à ${profile.sections.max}. ${sous}`,
    `Théorie : ${profile.attentesTheorie}`,
    `Méthode : ${profile.attentesMethode}`,
    usage,
    `Preuves par section${profile.sousParties.active ? " ou sous-partie" : ""} : ${profile.preuvesParSection.min} à ${profile.preuvesParSection.max}.`,
    `Lectorat : ${profile.lectorat}`,
    `Vigilance : ${profile.pointsDeVigilance}`,
    "Règle : les consignes spécifiques et le volume déclaré par l’auteur priment sur ce profil générique.",
  ].join("\n");
}

/**
 * 2–3 éléments clés pour le récapitulatif UI
 * (ex. « 6 à 10 chapitres avec sous-parties · usage exhaustif du corpus »).
 */
export function genreExpectationsSummary(profile: GenreProfile): string {
  const unit =
    profile.sections.max >= 8 && profile.sousParties.active
      ? "chapitres"
      : "sections";
  const range = `${profile.sections.min} à ${profile.sections.max} ${unit}`;
  const sous = profile.sousParties.active
    ? " avec sous-parties"
    : "";
  const usage =
    profile.usageMateriaux === "exhaustif"
      ? "usage exhaustif du corpus"
      : "usage sélectif du corpus";
  const preuves = `${profile.preuvesParSection.min}–${profile.preuvesParSection.max} preuve${
    profile.preuvesParSection.max > 1 ? "s" : ""
  }/${profile.sousParties.active ? "sous-partie" : "section"}`;
  return `${range}${sous} · ${usage} · ${preuves}`;
}
