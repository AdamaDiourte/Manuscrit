export const templates: Record<string, string[]> = {
  Mémoire: [
    "Introduction et problématique",
    "Cadre théorique",
    "Méthodologie",
    "Analyse des résultats",
    "Discussion et conclusion",
  ],
  Thèse: [
    "Problématique et hypothèses",
    "État de la recherche",
    "Dispositif d’enquête",
    "Résultats empiriques",
    "Discussion",
    "Conclusion générale",
  ],
  Article: ["Introduction", "Méthode", "Résultats", "Discussion et conclusion"],
  Livre: [
    "Ouverture et promesse",
    "Fil conducteur",
    "Chapitres de développement",
    "Synthèse et conclusion",
  ],
  /** Conservés pour d’anciens projets déjà créés. */
  "Rapport d’enquête": [
    "Question d’enquête",
    "Terrain et méthode",
    "Résultats",
    "Synthèse et limites",
  ],
  Autre: [
    "Introduction",
    "Cadre et méthode",
    "Analyse",
    "Discussion et conclusion",
  ],
};

/** Options du menu « type / modèle de projet » (ordre d’affichage). */
export const PROJECT_MODEL_OPTIONS = [
  { value: "Mémoire", label: "Mémoire" },
  { value: "Thèse", label: "Thèse" },
  { value: "Article", label: "Article" },
  { value: "Livre", label: "Livre" },
] as const;

export function projectTypeLabel(project: {
  type?: string;
  typeOther?: string;
}) {
  if (project.type === "Autre" && project.typeOther?.trim())
    return `Autre — ${project.typeOther.trim()}`;
  return project.type || "";
}

export type MaterialKind = "outil" | "materiau";

/** Fiches : outils de recueil vs matériaux effectivement recueillis. */
export const MATERIAL_ENTRIES: {
  type: string;
  kind: MaterialKind;
  prefix: string;
}[] = [
  { type: "Grille d’entretien", kind: "outil", prefix: "GRI" },
  { type: "Questionnaire", kind: "outil", prefix: "QST" },
  { type: "Grille d’observation", kind: "outil", prefix: "GOB" },
  { type: "Autre outil", kind: "outil", prefix: "OUT" },
  { type: "Entretien réalisé", kind: "materiau", prefix: "ENT" },
  { type: "Réponses au questionnaire", kind: "materiau", prefix: "REP" },
  { type: "Notes d’observation", kind: "materiau", prefix: "OBS" },
  {
    type: "Notes de lecture bibliographiques",
    kind: "materiau",
    prefix: "LEC",
  },
  { type: "Archives/données secondaires", kind: "materiau", prefix: "ARC" },
  { type: "Cartes / SIG", kind: "materiau", prefix: "MAP" },
  { type: "Autres", kind: "materiau", prefix: "AUT" },
];

export const TOOL_TYPE_OPTIONS = [
  { value: "Aucun", label: "Aucun" },
  ...MATERIAL_ENTRIES.filter((e) => e.kind === "outil").map((e) => ({
    value: e.type,
    label: e.type,
  })),
];

export const DATA_TYPE_OPTIONS = MATERIAL_ENTRIES.filter(
  (e) => e.kind === "materiau",
).map((e) => ({ value: e.type, label: e.type }));

export const MATERIAL_TYPES = MATERIAL_ENTRIES.map((e) => e.type);

export function isNoTool(toolType?: string) {
  return !toolType || toolType === "Aucun";
}

export function materialKind(type?: string): MaterialKind {
  return (
    MATERIAL_ENTRIES.find((e) => e.type === type)?.kind ||
    (type === "Autre outil" ? "outil" : "materiau")
  );
}

export function materialPrefix(type?: string): string {
  return MATERIAL_ENTRIES.find((e) => e.type === type)?.prefix || "MAT";
}

/** @deprecated Conservé pour compatibilité ; préférer MATERIAL_TYPES. */
export const types: Record<string, string[]> = Object.fromEntries(
  MATERIAL_TYPES.map((t) => [t, [] as string[]]),
);
export function makeProject(
  title: string,
  type: string,
  typeOther = "",
) {
  const outline = templates[type] || templates.Autre;
  return {
    id: crypto.randomUUID(),
    title,
    person: "",
    type,
    typeOther: type === "Autre" ? typeOther.trim() : "",
    demo: false,
    chapters: outline.map((chapterTitle, i) => ({
      id: "c" + i,
      title: chapterTitle,
      progress: 0,
      text: "",
      kind: "Section rédigée",
      links: [],
      sections: [],
    })),
    materials: [],
    tasks: [],
    dates: [],
    comments: [],
    versions: [],
  };
}
export const demo: any = {
  id: "exemple",
  title: "Les pratiques numériques étudiantes",
  person: "",
  type: "Mémoire",
  demo: true,
  chapters: templates["Mémoire"].map((title, i) => ({
    id: "c" + i,
    title,
    progress: [100, 75, 50, 25, 0][i],
    text: "",
    kind: "Section rédigée",
    links: [],
    sections: [],
  })),
  materials: [
    {
      title: "Entretien E01 — campus",
      toolType: "Grille d’entretien",
      type: "Entretien réalisé",
    },
    {
      title: "Questionnaire usages — vague 1",
      toolType: "Questionnaire",
      type: "Réponses au questionnaire",
    },
    {
      title: "Observation campus — séance 1",
      toolType: "Grille d’observation",
      type: "Notes d’observation",
    },
    {
      title: "Notes de lecture — usages numériques",
      toolType: "Autre outil",
      type: "Notes de lecture bibliographiques",
      toolUnavailable: true,
    },
  ].map((item, i) => ({
    id: "m" + i,
    ...item,
    toolUnavailable: Boolean(item.toolUnavailable),
    observation: "",
    extra: {},
    text: "",
  })),
  tasks: [
    {
      id: "t1",
      title: "Préciser les critères de recrutement",
      chapter: "c2",
      status: "À compléter",
    },
    {
      id: "t2",
      title: "Vérifier les références du cadre théorique",
      chapter: "c1",
      status: "À vérifier",
    },
    {
      id: "t3",
      title: "Documenter le traitement des non-réponses",
      chapter: "c3",
      status: "À compléter",
    },
  ],
  dates: [
    {
      id: "d1",
      title: "Relecture du cadre théorique",
      date: "2026-11-24",
      chapter: "c1",
    },
    {
      id: "d2",
      title: "Dépôt de la méthodologie",
      date: "2026-12-04",
      chapter: "c2",
    },
    {
      id: "d3",
      title: "Point sur les résultats",
      date: "2026-12-15",
      chapter: "c3",
    },
  ],
  comments: [],
  versions: [],
};
