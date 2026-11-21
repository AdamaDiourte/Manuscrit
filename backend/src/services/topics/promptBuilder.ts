import type {
  GeneratedTopic,
  ProfileAnalysis,
  RegenReason,
  TopicAxis,
} from "../../../../shared/research/topicTypes";
import { REGEN_REASON_LABELS } from "../../../../shared/research/topicTypes";
import { computeTimeBudget } from "../../../../shared/research/timeBudget";
import {
  fieldworkAvailableHours,
  formatFieldworkUnitCostsForPrompt,
} from "../../../../shared/research/fieldworkCosts";
import {
  getProjectLevelGuide,
  type ProjectLevelGuide,
} from "../../../../shared/research/projectLevelGuides";
import type { PseudonymizedProfile } from "../../../../shared/privacy/buildPseudonymizedProfile";
import { RESEARCH_TOPICS_SYSTEM } from "../../prompts/researchTopicsSystem";
import {
  formatMethodThresholdsSummary,
  formatUnitOfAnalysisRule,
  METHOD_THRESHOLDS,
} from "../../../../shared/research/methodThresholds";
import type { AnglePlanItem } from "./planAngles";
import { parseFieldAccessWeeks } from "./textLimits";

function injectMethodThresholds(text: string): string {
  let out = text;
  for (const [key, value] of Object.entries(METHOD_THRESHOLDS)) {
    out = out.replaceAll(`{{${key}}}`, String(value));
  }
  return out;
}

export function systemPrompt(): string {
  return injectMethodThresholds(RESEARCH_TOPICS_SYSTEM);
}

const PROFILE_THEMES: Array<{ title: string; ids: string[] }> = [
  {
    title: "projet",
    ids: [
      "project_type",
      "project_type_other",
      "discipline_main",
      "discipline_main_other",
      "specialty",
      "topic_freedom",
      "imposed_by",
      "imposed_theme",
      "lab_themes",
      "writing_language",
      "writing_language_other",
      "expected_length",
    ],
  },
  {
    title: "formation et goûts",
    ids: [
      "disciplines_studied",
      "favorite_courses",
      "liked_aspects",
      "disliked_courses",
      "inspiring_concept",
      "curious_discipline",
      "interest_objects",
      "past_works",
      "continue_or_avoid",
      "continue_or_avoid_detail",
    ],
  },
  {
    title: "méthodes",
    ids: [
      "methods_skills",
      "software",
      "method_to_learn",
      "method_to_learn_other",
    ],
  },
  {
    title: "contraintes",
    ids: ["deadline_range", "weekly_time"],
  },
  {
    title: "accès",
    ids: ["field_access"],
  },
];

function formatGuide(guide: ProjectLevelGuide): string {
  return [
    `Niveau : ${guide.label}`,
    `Type de question : ${guide.question_type}`,
    `Hypothèses : ${guide.hypotheses}`,
    `Échelle du terrain/corpus : ${guide.field_scale}`,
    `Cadre théorique : ${guide.theory_depth}`,
    `Originalité : ${guide.originality}`,
    `Livrable : ${guide.deliverable}`,
  ].join("\n");
}

function formatProfileByTheme(fields: Record<string, string>): string {
  const used = new Set<string>();
  const blocks: string[] = [];
  for (const theme of PROFILE_THEMES) {
    const lines = theme.ids
      .map((id) => fields[id])
      .filter((v): v is string => Boolean(v));
    for (const id of theme.ids) used.add(id);
    if (lines.length) {
      blocks.push(`### ${theme.title}\n${lines.join("\n")}`);
    }
  }
  const rest = Object.entries(fields)
    .filter(([id]) => !used.has(id))
    .map(([, v]) => v);
  if (rest.length) blocks.push(`### autres\n${rest.join("\n")}`);
  return blocks.join("\n\n") || "(profil vide)";
}

function projectTypeFromAnswers(
  answers: Record<string, unknown>,
): string | undefined {
  return typeof answers.project_type === "string"
    ? answers.project_type
    : undefined;
}

const AXIS_DEFINITIONS: Record<TopicAxis, string> = {
  mastery:
    "mastery (Maîtrise) : mobilise surtout les strengths. Méthode déjà maîtrisée, terrain ou données facilement accessibles. Le sujet doit sembler faisable dès demain.",
  ambition:
    "ambition (Ambition) : sert les interests et intègre au moins une méthode de wants_to_learn si elle est renseignée, en restant tenable dans le budget de temps.",
  discovery:
    "discovery (Découverte) : ouvre un angle nouveau, de préférence par la discipline voisine indiquée, sur un objet lié aux interests. L'ouverture reste bornée par les constraints.",
};

function sharedPromptHeader(input: {
  profile: PseudonymizedProfile;
  answers: Record<string, unknown>;
}): string[] {
  const guide = getProjectLevelGuide(projectTypeFromAnswers(input.answers));
  const budget = computeTimeBudget(input.answers);
  const available = fieldworkAvailableHours(budget.totalHours);
  const accessWeeks = parseFieldAccessWeeks(input.answers.field_access);
  const lines = [
    "## Profil",
    formatProfileByTheme(input.profile.fields),
    "## Informations manquantes",
    input.profile.missing_fields.length
      ? input.profile.missing_fields.map((m) => `- ${m}`).join("\n")
      : "(aucune)",
    "## Guide de niveau",
    formatGuide(guide),
    "## Budget de temps",
    `${budget.label} (${budget.weeks} semaines, ${budget.hoursPerWeek} h/semaine, total ${budget.totalHours} h)`,
    "## Collecte et analyse (plafond)",
    `Heures disponibles pour la collecte et l'analyse : ${available} h (soit la moitié du budget total).`,
    "Coûts unitaires (heures, tout compris) :",
    formatFieldworkUnitCostsForPrompt(),
    "Dimensionne fieldwork_plan pour rester sous ce plafond.",
    "## Unité d'analyse (seuils)",
    formatUnitOfAnalysisRule(),
    formatMethodThresholdsSummary(),
  ];
  if (accessWeeks != null) {
    lines.push(
      "## Fenêtre d'accès au terrain",
      `L'accès déclaré dure environ ${accessWeeks} semaines. Cette contrainte ne s'applique qu'aux sujets dont field_or_corpus repose réellement sur cet accès (ex. stage, structure d'accueil). Un terrain en ligne ou un corpus indépendant de cet accès n'est pas borné par cette fenêtre.`,
    );
  }
  return lines;
}

export function buildUserPrompt(input: {
  profile: PseudonymizedProfile;
  answers: Record<string, unknown>;
}): string {
  return [
    ...sharedPromptHeader(input),
    "## Consigne",
    "Appelle l'outil propose_topics.",
  ].join("\n\n");
}

/** Prompt pour un seul axe (génération parallèle). */
export function buildAxisUserPrompt(input: {
  profile: PseudonymizedProfile;
  answers: Record<string, unknown>;
  axis: TopicAxis;
  avoidTopics?: Array<
    Pick<GeneratedTopic, "axis" | "title" | "research_object">
  >;
  anglePlan?: AnglePlanItem;
  otherAngles?: AnglePlanItem[];
}): string {
  const lines = [
    ...sharedPromptHeader(input),
    "## Axe demandé",
    `Génère uniquement l'axe ${input.axis}.`,
    AXIS_DEFINITIONS[input.axis],
  ];
  if (input.anglePlan) {
    lines.push(
      "## Angle imposé pour cet axe",
      `Développe cet objet : ${input.anglePlan.research_object}`,
      `Matériau principal : ${input.anglePlan.material}`,
      `Angle : ${input.anglePlan.angle}`,
      "Respecte cet objet et cet angle ; ne les remplace pas par un autre sujet.",
    );
  }
  if (input.otherAngles?.length) {
    lines.push(
      "## Angles réservés aux autres axes (ne pas les reprendre)",
      input.otherAngles
        .map(
          (a) =>
            `- ${a.axis} : objet « ${a.research_object} » — matériau : ${a.material} — angle : ${a.angle}`,
        )
        .join("\n"),
    );
  }
  if (input.avoidTopics?.length) {
    lines.push(
      "## Titres et objets à éviter (trop similaires)",
      input.avoidTopics
        .map(
          (t) =>
            `- ${t.axis} : « ${t.title} » — objet : ${t.research_object || "(non précisé)"}`,
        )
        .join("\n"),
    );
  }
  if (input.axis === "mastery") {
    lines.push(
      "## Consigne",
      "Appelle l'outil propose_topic pour l'axe mastery. Remplis aussi profile_analysis et personalization_level.",
    );
  } else {
    lines.push(
      "## Consigne",
      `Appelle l'outil propose_topic pour un seul sujet avec axis = ${input.axis}. Ne fournis pas profile_analysis.`,
    );
  }
  return lines.join("\n\n");
}

const REGEN_INSTRUCTIONS: Record<RegenReason, string> = {
  too_far:
    "Appuie-toi sur au moins 3 éléments différents du profil, et uniquement sur des éléments présents.",
  too_ambitious:
    "Réduis l'échelle du terrain d'un cran dans le guide de niveau, une seule méthode, objet plus étroit.",
  too_banal:
    "Garde le niveau de faisabilité mais change d'objet ou d'angle pour une question moins attendue dans la discipline.",
  already_done:
    "Change d'objet empirique, pas seulement de formulation.",
};

export function buildRegenUserPrompt(input: {
  profile: PseudonymizedProfile;
  answers: Record<string, unknown>;
  axis: TopicAxis;
  reason: RegenReason;
  keptTopics: Array<Pick<GeneratedTopic, "axis" | "title" | "research_object">>;
  rejectedTitles: string[];
  previousTitle?: string;
}): string {
  const kept = input.keptTopics
    .filter((t) => t.axis !== input.axis)
    .map(
      (t) =>
        `- ${t.axis} : « ${t.title} » — objet : ${t.research_object || "(non précisé)"}`,
    )
    .join("\n");
  const rejected =
    input.rejectedTitles.length > 0
      ? input.rejectedTitles.map((t) => `- ${t}`).join("\n")
      : "(aucun)";

  return [
    ...sharedPromptHeader({
      profile: input.profile,
      answers: input.answers,
    }),
    "## Régénération",
    `Axe à régénérer : ${input.axis}`,
    `Motif : ${REGEN_REASON_LABELS[input.reason]}`,
    REGEN_INSTRUCTIONS[input.reason],
    input.previousTitle
      ? `Titre précédent à remplacer : ${input.previousTitle}`
      : "",
    "## Sujets conservés (ne pas les dupliquer)",
    kept || "(aucun)",
    "## Titres déjà rejetés pour cet axe (ne pas les reproduire)",
    rejected,
    "## Consigne",
    "Appelle l'outil propose_topic pour un seul sujet, avec axis = " +
      input.axis +
      ".",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildCorrectionUserPrompt(input: {
  baseUserPrompt: string;
  previousOutput: unknown;
  violationListFr: string;
}): string {
  return [
    input.baseUserPrompt,
    "## Sortie précédente à corriger",
    JSON.stringify(input.previousOutput),
    "## Violations à corriger (uniquement ces points)",
    input.violationListFr,
    "## Consigne",
    "Corrige uniquement les points listés ci-dessus, puis rappelle l'outil propose_topics (ou propose_topic si un seul sujet).",
  ].join("\n\n");
}

/**
 * Correction « patch » : ne renvoie que les champs modifiés.
 */
export function buildPatchCorrectionUserPrompt(input: {
  axis: TopicAxis;
  topic: GeneratedTopic;
  violationListFr: string;
  extraInstruction?: string;
}): string {
  return [
    `## Axe ${input.axis} — correction ciblée`,
    "Ne réécris pas tout le sujet. Renvoie uniquement les champs à modifier via l'outil patch_topic.",
    "## Sujet actuel",
    JSON.stringify(input.topic),
    "## Violations à corriger (uniquement ces points)",
    input.violationListFr,
    input.extraInstruction || "",
    "## Consigne",
    "Corrige uniquement les points listés. Si tu utilises patch_topic, renvoie { fields: { <nom_du_champ>: <nouvelle_valeur> } } avec seulement les champs changés. Sinon appelle propose_topic avec le sujet corrigé.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildOverlapPatchUserPrompt(input: {
  axis: TopicAxis;
  topic: GeneratedTopic;
  otherTopics: Array<
    Pick<GeneratedTopic, "axis" | "title" | "research_object" | "field_or_corpus">
  >;
  explanation: string;
}): string {
  return buildCrossBlockingPatchUserPrompt({
    ...input,
    issues: [{ code: "OVERLAP", explanation: input.explanation }],
  });
}

/** Correction ciblée pour tout bloquant de relecture croisée (OVERLAP, ETHICS…). */
export function buildCrossBlockingPatchUserPrompt(input: {
  axis: TopicAxis;
  topic: GeneratedTopic;
  otherTopics: Array<
    Pick<GeneratedTopic, "axis" | "title" | "research_object" | "field_or_corpus">
  >;
  issues: Array<{ code: string; explanation: string }>;
  /** @deprecated prefer issues */
  explanation?: string;
}): string {
  const others = input.otherTopics
    .map(
      (t) =>
        `- ${t.axis} : objet « ${t.research_object || t.title} » — terrain : ${(t.field_or_corpus || "").slice(0, 160)}`,
    )
    .join("\n");
  const issues = input.issues?.length
    ? input.issues
    : input.explanation
      ? [{ code: "OVERLAP", explanation: input.explanation }]
      : [];
  const violationListFr = issues
    .map((i) => `${i.code} : ${i.explanation}`)
    .join("\n");
  const hasOverlap = issues.some((i) => i.code === "OVERLAP");
  const extra: string[] = [];
  if (hasOverlap) {
    extra.push(
      "## Autres axes (objets à éviter)",
      others,
      "Pour OVERLAP : change research_object et field_or_corpus (et si besoin title, research_question, hypotheses, hypothesis_tests) pour écarter clairement les objets et terrains des deux autres axes.",
    );
  }
  if (issues.some((i) => i.code === "ETHICS" || i.code === "MINORS_ETHICS")) {
    extra.push(
      "Pour ETHICS / mineurs : corrige ethical_notes, leads et le recrutement (pas de fichier d'usagers ; autorisations si mineurs).",
    );
  }
  if (issues.some((i) => i.code === "ONLINE_ETHICS")) {
    extra.push(
      "Pour contenus en ligne : ethical_notes doit couvrir espaces publics, CGU, pseudonymisation dès la collecte, pas de citation littérale retrouvable, prudence opinions/santé.",
    );
  }
  if (
    issues.some((i) =>
      ["INCONSISTENT", "METHOD_MISMATCH", "TESTABILITY", "CLARITY", "RELEVANCE"].includes(
        i.code,
      ),
    )
  ) {
    extra.push(
      "Aligne pitch, stakes, leads, question, hypothèses, terrain et méthode pour lever l'incohérence ou l'inadéquation signalée.",
    );
  }
  extra.push(
    "Ne régénère pas un sujet entièrement différent du cahier des charges de l'axe. Corrige uniquement les points listés.",
  );
  return buildPatchCorrectionUserPrompt({
    axis: input.axis,
    topic: input.topic,
    violationListFr,
    extraInstruction: extra.join("\n"),
  });
}

export type { ProfileAnalysis };
