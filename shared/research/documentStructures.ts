/**
 * Outlines académiques stables par type de projet et par genre de document.
 * L’IA doit suivre scrupuleusement ces sections (ordre et finalité).
 */

export type ProjectTypeId =
  | "licence"
  | "m1"
  | "m2"
  | "pro"
  | "internship"
  | "thesis"
  | "article"
  | "book"
  | "talk"
  | "research_dossier"
  | "reading_sheet"
  | "other";

export type DocumentKind = "research_project" | "work_plan";

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  research_project: "Projet de recherche",
  work_plan: "Plan de travail",
};

export const PROJECT_TYPE_LABELS: Record<ProjectTypeId, string> = {
  licence: "Mémoire Licence",
  m1: "Mémoire recherche M1",
  m2: "Mémoire recherche M2",
  pro: "Mémoire professionnel",
  internship: "Rapport de stage",
  thesis: "Thèse",
  article: "Article scientifique",
  book: "Livre",
  talk: "Communication", // conservé pour archives anciennes
  research_dossier: "Dossier de recherche",
  reading_sheet: "Fiche de lecture",
  other: "Autre projet académique",
};

/** Libellé du document principal selon le type (pas toujours « projet de recherche »). */
export function mainDocumentLabel(projectType: ProjectTypeId): string {
  switch (projectType) {
    case "internship":
      return "Projet de rapport de stage";
    case "article":
      return "Projet d’article";
    case "book":
      return "Projet de livre";
    case "talk":
      return "Projet de communication";
    case "thesis":
      return "Projet de thèse";
    case "research_dossier":
      return "Projet de dossier de recherche";
    case "reading_sheet":
      return "Projet de fiche de lecture";
    case "licence":
    case "m1":
    case "m2":
    case "pro":
      return "Projet de mémoire";
    default:
      return "Projet académique";
  }
}

export function documentKindLabel(
  kind: DocumentKind,
  projectType: ProjectTypeId,
): string {
  return kind === "research_project"
    ? mainDocumentLabel(projectType)
    : "Plan de travail";
}

export type DocumentOutline = {
  projectType: ProjectTypeId;
  kind: DocumentKind;
  title: string;
  guidance: string;
  sections: { id: string; heading: string; intent: string }[];
};

const PROJECT_OUTLINES: Record<ProjectTypeId, DocumentOutline["sections"]> = {
  licence: [
    {
      id: "context",
      heading: "Contexte et intérêt du sujet",
      intent: "Situer le sujet dans la discipline et expliquer pourquoi il mérite d’être traité en licence.",
    },
    {
      id: "problem",
      heading: "Problématique et hypothèses",
      intent: "Formuler une question claire, réaliste pour un mémoire de licence, avec 2 à 3 hypothèses.",
    },
    {
      id: "theory",
      heading: "Repères théoriques",
      intent: "Orienter la lecture (notions, courants) sans inventer de références précises.",
    },
    {
      id: "method",
      heading: "Méthode envisagée",
      intent: "Décrire corpus ou terrain, outils et faisabilité au niveau licence.",
    },
    {
      id: "plan",
      heading: "Plan provisoire du mémoire",
      intent: "Proposer une architecture de chapitres simple et cohérente.",
    },
    {
      id: "schedule",
      heading: "Calendrier de travail",
      intent: "Découper les étapes jusqu’au rendu, en tenant compte du temps disponible.",
    },
    {
      id: "ethics",
      heading: "Points d’attention",
      intent: "Éthique, accès aux sources, limites et précautions pratiques.",
    },
  ],
  m1: [
    {
      id: "context",
      heading: "Contexte scientifique",
      intent: "Positionner le sujet dans un champ de recherche et expliciter l’enjeu.",
    },
    {
      id: "problem",
      heading: "Problématique, questions et hypothèses",
      intent: "Affiner une problématique de niveau M1, avec questions opérationnelles.",
    },
    {
      id: "state",
      heading: "État des lieux documentaire",
      intent: "Indiquer les axes de lecture et mots-clés ; interdiction d’inventer des auteurs ou titres.",
    },
    {
      id: "method",
      heading: "Dispositif méthodologique",
      intent: "Terrain, corpus, méthodes, critères de sélection et analyse.",
    },
    {
      id: "plan",
      heading: "Architecture du mémoire",
      intent: "Plan détaillé des parties et logique argumentative.",
    },
    {
      id: "feasibility",
      heading: "Faisabilité et risques",
      intent: "Accès au terrain, charge de travail, alternatives si blocage.",
    },
    {
      id: "schedule",
      heading: "Calendrier",
      intent: "Jalons de recherche, écriture et relectures.",
    },
  ],
  m2: [
    {
      id: "context",
      heading: "Enjeu de recherche",
      intent: "Montrer la contribution attendue au regard du champ.",
    },
    {
      id: "problem",
      heading: "Problématique et hypothèses",
      intent: "Problématique exigeante mais tenable en M2.",
    },
    {
      id: "state",
      heading: "Cadre théorique et revue de littérature",
      intent: "Axes théoriques et stratégies documentaires ; pas de fausses références.",
    },
    {
      id: "method",
      heading: "Design de recherche",
      intent: "Protocole, échantillon ou corpus, outils d’analyse, critères de validité.",
    },
    {
      id: "contribution",
      heading: "Résultats attendus et apport",
      intent: "Ce que le mémoire peut raisonnablement démontrer.",
    },
    {
      id: "plan",
      heading: "Plan du manuscrit",
      intent: "Structure des chapitres et articulation des analyses.",
    },
    {
      id: "schedule",
      heading: "Planning et livrables",
      intent: "Phases empiriques, rédaction, soutenance.",
    },
    {
      id: "ethics",
      heading: "Éthique et données",
      intent: "Consentement, anonymisation, éventuelle AIPD ou comité d’éthique.",
    },
  ],
  pro: [
    {
      id: "context",
      heading: "Contexte professionnel",
      intent: "Organisation, mission et besoin pratique qui motive le mémoire.",
    },
    {
      id: "problem",
      heading: "Problématique professionnelle",
      intent: "Question utile à l’organisation, formulée de façon analysable.",
    },
    {
      id: "framework",
      heading: "Cadre d’analyse",
      intent: "Concepts et grilles mobilisables sans jargon inutile.",
    },
    {
      id: "method",
      heading: "Démarche d’enquête",
      intent: "Données internes, entretiens, observations, contraintes de confidentialité.",
    },
    {
      id: "deliverables",
      heading: "Livrables et recommandations",
      intent: "Ce que le mémoire doit produire pour le commanditaire.",
    },
    {
      id: "plan",
      heading: "Plan du mémoire professionnel",
      intent: "Structure adaptée au double lectorat académique et professionnel.",
    },
    {
      id: "schedule",
      heading: "Calendrier",
      intent: "Jalons terrain, analyse, rédaction et restitution.",
    },
  ],
  internship: [
    {
      id: "host",
      heading: "Contexte de la structure d’accueil",
      intent: "Présenter le cadre du stage sans inventer d’organisation nominative si non fournie.",
    },
    {
      id: "mission",
      heading: "Mission et objectifs du stage",
      intent: "Clarifier la mission confiée et les objectifs d’apprentissage.",
    },
    {
      id: "problem",
      heading: "Problématique du rapport",
      intent: "Relier une question concrète aux activités du stage.",
    },
    {
      id: "method",
      heading: "Méthode de travail sur le terrain",
      intent: "Outils, observations, documents, échanges utiles au rapport.",
    },
    {
      id: "analysis",
      heading: "Pistes d’analyse",
      intent: "Comment relier pratique de stage et lecture analytique.",
    },
    {
      id: "plan",
      heading: "Plan du rapport de stage",
      intent: "Structure typique : contexte, activités, analyse, bilan.",
    },
    {
      id: "schedule",
      heading: "Organisation du travail",
      intent: "Répartition mission / rédaction pendant et après le stage.",
    },
  ],
  thesis: [
    {
      id: "context",
      heading: "Positionnement de la thèse",
      intent: "Enjeu scientifique et inscription dans un champ.",
    },
    {
      id: "problem",
      heading: "Problématique et hypothèses de travail",
      intent: "Question doctorale, sous-questions et hypothèses exploratoires.",
    },
    {
      id: "state",
      heading: "État de l’art (axes)",
      intent: "Cartographier les axes documentaires ; interdiction d’inventer des publications.",
    },
    {
      id: "method",
      heading: "Dispositif empirique",
      intent: "Terrain, corpus, méthodes, éthique de longue durée.",
    },
    {
      id: "contribution",
      heading: "Contribution attendue",
      intent: "Apport théorique, empirique ou méthodologique raisonnable.",
    },
    {
      id: "plan",
      heading: "Architecture de la thèse",
      intent: "Parties, chapitres et logique de démonstration.",
    },
    {
      id: "schedule",
      heading: "Horizon de travail",
      intent: "Phases sur plusieurs années, jalons et risques.",
    },
  ],
  article: [
    {
      id: "gap",
      heading: "Enjeu et lacune",
      intent: "Ce que l’article cherche à éclairer, sans promesse excessive.",
    },
    {
      id: "question",
      heading: "Question de recherche",
      intent: "Question courte, testable, adaptée à un article.",
    },
    {
      id: "method",
      heading: "Matériel et méthode",
      intent: "Données, corpus, protocole d’analyse.",
    },
    {
      id: "structure",
      heading: "Structure de l’article",
      intent: "Introduction, méthode, résultats, discussion, conclusion.",
    },
    {
      id: "results",
      heading: "Résultats attendus",
      intent: "Ce qui pourra être montré, et ce qui restera hors cadre.",
    },
    {
      id: "schedule",
      heading: "Plan d’écriture",
      intent: "Étapes de rédaction et relecture jusqu’à soumission.",
    },
  ],
  talk: [
    {
      id: "message",
      heading: "Message central",
      intent: "Ce que l’auditoire doit retenir.",
    },
    {
      id: "angle",
      heading: "Angle et cadrage",
      intent: "Problématique courte adaptée à une communication.",
    },
    {
      id: "evidence",
      heading: "Matériau et exemples",
      intent: "Données, cas ou illustrations à mobiliser.",
    },
    {
      id: "outline",
      heading: "Plan de la communication",
      intent: "Déroulement oral minute par minute ou par blocs.",
    },
    {
      id: "supports",
      heading: "Supports",
      intent: "Diapositives, handout, démonstration : choix sobres.",
    },
    {
      id: "schedule",
      heading: "Préparation",
      intent: "Répétitions, timing, questions anticipées.",
    },
  ],
  research_dossier: [
    {
      id: "context",
      heading: "Contexte et objet du dossier",
      intent: "Situer le dossier de recherche, sa commande et son public.",
    },
    {
      id: "problem",
      heading: "Question et angles d’analyse",
      intent: "Clarifier la question directrice et les axes du dossier.",
    },
    {
      id: "sources",
      heading: "Sources et matériaux",
      intent: "Identifier les types de sources à mobiliser, sans inventer de références.",
    },
    {
      id: "method",
      heading: "Démarche de traitement",
      intent: "Expliquer comment les matériaux seront lus, classés et croisés.",
    },
    {
      id: "plan",
      heading: "Plan du dossier",
      intent: "Proposer une architecture claire des parties du dossier.",
    },
    {
      id: "schedule",
      heading: "Calendrier de production",
      intent: "Découper les étapes jusqu’au rendu selon le temps disponible.",
    },
  ],
  reading_sheet: [
    {
      id: "context",
      heading: "Objet de la fiche",
      intent: "Présenter l’œuvre ou le corpus à lire et le cadre de la fiche.",
    },
    {
      id: "problem",
      heading: "Question de lecture",
      intent: "Formuler l’angle de lecture et ce que la fiche doit éclairer.",
    },
    {
      id: "summary",
      heading: "Repères de synthèse",
      intent: "Indiquer les éléments à retenir sans inventer le contenu de l’œuvre.",
    },
    {
      id: "analysis",
      heading: "Pistes d’analyse",
      intent: "Proposer des axes critiques sobres et justifiés.",
    },
    {
      id: "plan",
      heading: "Structure de la fiche",
      intent: "Organiser les rubriques de la fiche de lecture.",
    },
    {
      id: "schedule",
      heading: "Calendrier de lecture et rédaction",
      intent: "Répartir lecture, prises de notes et rédaction selon le délai.",
    },
  ],
  book: [
    {
      id: "context",
      heading: "Objet et lectorat du livre",
      intent:
        "Clarifier le sujet, le public visé et la promesse du manuscrit sans rédiger le livre.",
    },
    {
      id: "problem",
      heading: "Fil conducteur et question directrice",
      intent:
        "Formuler l’argument central et ce que chaque partie doit démontrer.",
    },
    {
      id: "theory",
      heading: "Repères, corpus et références",
      intent:
        "Organiser les matériaux et lectures qui nourriront les chapitres.",
    },
    {
      id: "method",
      heading: "Architecture du livre",
      intent:
        "Proposer une progression de chapitres du simple au complexe, réaliste pour le volume.",
    },
    {
      id: "analysis",
      heading: "Développements et preuves",
      intent:
        "Indiquer comment mobiliser les matériaux dans les chapitres principaux.",
    },
    {
      id: "schedule",
      heading: "Calendrier de rédaction",
      intent:
        "Répartir rédaction, relectures et finalisation jusqu’au rendu déclaré.",
    },
  ],
  other: [
    {
      id: "context",
      heading: "Contexte du projet",
      intent: "Cadre académique et finalité du travail.",
    },
    {
      id: "problem",
      heading: "Question directrice",
      intent: "Formuler clairement ce que le projet doit résoudre.",
    },
    {
      id: "method",
      heading: "Démarche",
      intent: "Méthode, sources et contraintes.",
    },
    {
      id: "plan",
      heading: "Structure du document",
      intent: "Organisation adaptée au type déclaré.",
    },
    {
      id: "schedule",
      heading: "Calendrier",
      intent: "Étapes jusqu’à la livraison.",
    },
  ],
};

/**
 * Plan de travail synthétique (1–2 pages) : carte mentale + tableau de route.
 * Complète le document principal (mémoire, rapport, article…) sans le dupliquer.
 */
const PLAN_BASE: DocumentOutline["sections"] = [
  {
    id: "identity",
    heading: "Carte du parcours",
    intent:
      "Un seul paragraphe directif : livrable à produire, délai de rendu déclaré, temps à consacrer au sujet par semaine, exigence centrale. Nomme clairement le genre (mémoire, rapport de stage, article, etc.). Le planning qui suit doit découler de ces deux contraintes de temps.",
  },
  {
    id: "map",
    heading: "Carte mentale du travail",
    intent:
      "4 à 6 bullets comme branches d’une mind map : actions concrètes pour réussir le livrable. Pas de prose longue. Style clair et impératif (« Faire… », « Stabiliser… »).",
  },
  {
    id: "schedule",
    heading: "Planning de travail proposé",
    intent:
      "Proposer un planning d’organisation concret pour la personne. Remplir le champ table (obligatoire) avec : Période | Objectif | Actions | Livrable | Charge. 4 à 7 lignes max. Les périodes doivent coller au délai de rendu ; la charge de chaque ligne doit rester réaliste au regard du temps hebdomadaire déclaré (ne pas surcharger une semaine). Un court paragraphe d’intro rappelle ces deux balises.",
  },
  {
    id: "priorities",
    heading: "Si le temps manque",
    intent:
      "5 bullets directives : quoi garder, simplifier, reporter. Plan B réaliste selon le délai et le rythme hebdomadaire.",
  },
  {
    id: "checklist",
    heading: "Checklist avant rendu",
    intent:
      "6 à 8 bullets de contrôle adaptés au type de projet (forme, fond, conformité).",
  },
];

const PLAN_OUTLINES: Record<ProjectTypeId, DocumentOutline["sections"]> = {
  licence: PLAN_BASE,
  m1: PLAN_BASE,
  m2: PLAN_BASE,
  pro: PLAN_BASE,
  internship: PLAN_BASE,
  thesis: PLAN_BASE,
  article: PLAN_BASE,
  book: PLAN_BASE,
  talk: PLAN_BASE,
  research_dossier: PLAN_BASE,
  reading_sheet: PLAN_BASE,
  other: PLAN_BASE,
};

export function normalizeProjectType(raw: unknown): ProjectTypeId {
  const value = String(raw ?? "other");
  if (value in PROJECT_TYPE_LABELS) return value as ProjectTypeId;
  return "other";
}

export function getDocumentOutline(
  projectType: ProjectTypeId,
  kind: DocumentKind,
): DocumentOutline {
  const sections =
    kind === "research_project"
      ? PROJECT_OUTLINES[projectType]
      : PLAN_OUTLINES[projectType];
  return {
    projectType,
    kind,
    title:
      kind === "research_project"
        ? `${mainDocumentLabel(projectType)} : ${PROJECT_TYPE_LABELS[projectType]}`
        : `Plan de travail : ${PROJECT_TYPE_LABELS[projectType]}`,
    guidance:
      kind === "research_project"
        ? `Rédige un ${mainDocumentLabel(projectType).toLowerCase()} complet, ancré dans le profil, adapté au genre « ${PROJECT_TYPE_LABELS[projectType]} » (pas un autre type de document).`
        : `Rédige un PLAN DE TRAVAIL SYNTHÉTIQUE (1 à 2 pages maximum), clair et directif, pour aider la personne à s’organiser. Il montre COMMENT réaliser le ${mainDocumentLabel(projectType).toLowerCase()} / ${PROJECT_TYPE_LABELS[projectType].toLowerCase()}. Ancre absolument le planning sur le délai de rendu et le temps à consacrer au sujet par semaine (déclarés dans le formulaire) : répartition des périodes, charge réaliste, jalons jusqu’au rendu. Utilise une carte mentale (bullets) et un TABLEAU de planning. Ne duplique pas le document principal. Pas de prose longue.`,
    sections,
  };
}
