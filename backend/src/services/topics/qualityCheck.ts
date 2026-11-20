import type {
  GeneratedTopic,
  TopicAxis,
  TopicWarning,
} from "../../../../shared/research/topicTypes";
import type { PseudonymizedProfile } from "../../../../shared/privacy/buildPseudonymizedProfile";
import {
  estimateFieldworkHours,
  fieldworkAvailableHours,
  fieldworkBudgetThreshold,
  formatFieldworkPlanSummary,
} from "../../../../shared/research/fieldworkCosts";
import { computeTimeBudget } from "../../../../shared/research/timeBudget";
import {
  getProjectLevelGuide,
  minHypothesesFromGuide,
} from "../../../../shared/research/projectLevelGuides";
import { normalizeProjectType } from "../../../../shared/research/documentStructures";
import { clampAtSentence, collectOverLimitFields } from "./textLimits";

export type QualityViolationCode =
  | "BANNED_PHRASE"
  | "TITLE_PROJECT_TYPE"
  | "META_HYPOTHESIS"
  | "CONTEXT_UNSOURCED_FACT"
  | "FAKE_PROFILE_LINK"
  | "GENERIC_KEYWORD"
  | "TOO_SIMILAR"
  | "IMPOSED_THEME_IGNORED"
  | "OVER_BUDGET"
  | "MISSING_TEST"
  | "TOO_LONG"
  | "GENDERED_USER";

export type QualityViolation = {
  code: QualityViolationCode;
  axis?: TopicAxis;
  detail: string;
};

export type QualityCheckResult = {
  violations: QualityViolation[];
  codes: string[];
};

const BANNED_PHRASES = [
  "pratiques et enjeux",
  "lecture maîtrisée",
  "montée en compétence",
  "angle voisin",
  "outils déjà maîtrisés",
  "à partir de votre profil",
  "recenser 15 à 20 sources",
  "note de cadrage",
];

const TITLE_PROJECT_TYPE_RE =
  /\b(mémoire|master|m1|m2|licence|thèse|these|rapport de stage|doctorat)\b/i;

const META_HYPOTHESIS_RE =
  /\b(vous|votre|vos|compétence|apprentissage|calendrier|délai|encadrement|faisabilité|méthode déjà)\b/i;

const YEAR_RE = /\b(1[89]|20)\d{2}\b/;
const PERCENT_RE = /\d+\s*%/;
const BIG_NUMBER_RE = /\b\d{3,}\b/;
const CITATION_RE = /\b[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]+\s*,\s*(1[89]|20)\d{2}\b/;

const GENERIC_KEYWORDS = new Set([
  "méthode",
  "methode",
  "faisabilité",
  "faisabilite",
  "cadrage",
  "angle",
  "compétence",
  "competence",
  "method",
  "feasibility",
  "framing",
  "skill",
  "skills",
]);

/** Mentions genrées de la personne enquêtante (rationale / risks). */
const GENDERED_USER_RE =
  /\b(une\s+stagiaire|un\s+stagiaire|étudiante|etudiante|étudiant|etudiant)\b/i;

const PROFILE_GENDER_RE =
  /\b(genre|sexe|madame|monsieur|mme\b|m\.|mr\b|femme|homme|féminin|masculin|fille|garçon)\b/i;

const STOPWORDS = new Set([
  "le",
  "la",
  "les",
  "un",
  "une",
  "des",
  "de",
  "du",
  "et",
  "ou",
  "en",
  "au",
  "aux",
  "à",
  "a",
  "pour",
  "par",
  "sur",
  "dans",
  "avec",
  "sans",
  "the",
  "of",
  "and",
  "or",
  "in",
  "to",
  "for",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentWords(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(" ")
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function profileCorpus(profile: PseudonymizedProfile): string {
  const parts = [
    ...Object.values(profile.fields),
    ...Object.values(profile.rawValues).map((v) =>
      typeof v === "string" ? v : JSON.stringify(v),
    ),
  ];
  return normalize(parts.join(" "));
}

function valueInProfile(value: string, corpus: string): boolean {
  const n = normalize(value);
  if (!n) return false;
  if (corpus.includes(n)) return true;
  // Allow short fragments (≥ 4 chars) as inclusion check.
  const tokens = n.split(" ").filter((t) => t.length >= 4);
  if (!tokens.length) return corpus.includes(n);
  return tokens.every((t) => corpus.includes(t));
}

function checkTopic(
  topic: GeneratedTopic,
  profile: PseudonymizedProfile,
  corpus: string,
  imposedTheme: string | undefined,
): QualityViolation[] {
  const out: QualityViolation[] = [];
  const axis = topic.axis;
  const haystacks = [
    topic.title,
    topic.research_question,
    ...topic.hypotheses,
    ...topic.feasibility.first_steps,
  ];

  for (const phrase of BANNED_PHRASES) {
    const hit = haystacks.find((h) =>
      normalize(h).includes(normalize(phrase)),
    );
    if (hit)
      out.push({
        code: "BANNED_PHRASE",
        axis,
        detail: `Contient l'expression interdite « ${phrase} ».`,
      });
  }

  if (TITLE_PROJECT_TYPE_RE.test(topic.title))
    out.push({
      code: "TITLE_PROJECT_TYPE",
      axis,
      detail: "Le titre contient un libellé de type de projet.",
    });

  topic.hypotheses.forEach((h, i) => {
    if (META_HYPOTHESIS_RE.test(h))
      out.push({
        code: "META_HYPOTHESIS",
        axis,
        detail: `Hypothèse ${i + 1} : elle parle de la personne ou de la démarche et non de l'objet.`,
      });
  });

  const ctx = topic.context || "";
  if (
    YEAR_RE.test(ctx) ||
    PERCENT_RE.test(ctx) ||
    BIG_NUMBER_RE.test(ctx) ||
    CITATION_RE.test(ctx)
  ) {
    const nums = ctx.match(/\b\d{3,}\b/g) || [];
    const years = ctx.match(YEAR_RE) || [];
    const percents = ctx.match(PERCENT_RE) || [];
    const suspects = [...nums, ...years, ...percents];
    const unsourced = suspects.some((s) => !valueInProfile(s, corpus));
    if (unsourced || CITATION_RE.test(ctx))
      out.push({
        code: "CONTEXT_UNSOURCED_FACT",
        axis,
        detail:
          "Le contexte contient un fait chiffré, une année ou une citation non sourcée dans le profil.",
      });
  }

  for (const link of topic.profile_links || []) {
    if (!valueInProfile(link.profile_value, corpus))
      out.push({
        code: "FAKE_PROFILE_LINK",
        axis,
        detail: `profile_value absente du profil : « ${link.profile_value.slice(0, 80)} ».`,
      });
  }

  for (const kw of [...topic.keywords_fr, ...topic.keywords_en]) {
    const n = normalize(kw);
    if (GENERIC_KEYWORDS.has(n))
      out.push({
        code: "GENERIC_KEYWORD",
        axis,
        detail: `Mot-clé générique interdit : « ${kw} ».`,
      });
  }

  if (imposedTheme) {
    const themeWords = contentWords(imposedTheme);
    const combined = contentWords(
      `${topic.title} ${topic.research_object || ""}`,
    );
    let hit = 0;
    for (const w of themeWords) if (combined.has(w)) hit += 1;
    if (themeWords.size > 0 && hit === 0)
      out.push({
        code: "IMPOSED_THEME_IGNORED",
        axis,
        detail: "Le thème imposé n'apparaît ni dans le titre ni dans research_object.",
      });
  }

  const tests = topic.hypothesis_tests || [];
  const hypCount = topic.hypotheses.length;
  const indexSet = new Set(
    tests
      .map((t) => t.hypothesis_index)
      .filter((i) => Number.isInteger(i) && i >= 0 && i < hypCount),
  );
  if (tests.length !== hypCount || indexSet.size !== hypCount) {
    out.push({
      code: "MISSING_TEST",
      axis,
      detail: `hypothesis_tests doit contenir exactement une entrée par hypothèse (${hypCount} attendue(s), ${tests.length} reçue(s)).`,
    });
  }

  for (const hit of collectOverLimitFields(topic)) {
    out.push({
      code: "TOO_LONG",
      axis,
      detail: `Raccourcis le champ ${hit.field} sous ${hit.max} caractères en gardant son sens (actuellement ${hit.length}).`,
    });
  }

  if (!PROFILE_GENDER_RE.test(corpus)) {
    const genderedFields: Array<{ field: string; text: string }> = [
      { field: "rationale", text: topic.rationale || "" },
      ...(topic.feasibility?.risks || []).map((r, i) => ({
        field: `feasibility.risks[${i}]`,
        text: r,
      })),
    ];
    for (const { field, text } of genderedFields) {
      if (GENDERED_USER_RE.test(text)) {
        out.push({
          code: "GENDERED_USER",
          axis,
          detail: `Le champ ${field} attribue un genre à la personne (« stagiaire » / « étudiant·e ») alors que le profil n'en indique aucun. Reformule de façon neutre.`,
        });
      }
    }
  }

  return out;
}

export function qualityCheck(
  topics: GeneratedTopic[],
  profile: PseudonymizedProfile,
  options?: { rejectedTitles?: string[]; answers?: Record<string, unknown> },
): QualityCheckResult {
  const corpus = profileCorpus(profile);
  const freedom = String(profile.rawValues.topic_freedom || "");
  const imposedTheme =
    freedom === "imposed" &&
    typeof profile.rawValues.imposed_theme === "string" &&
    profile.rawValues.imposed_theme.trim()
      ? profile.rawValues.imposed_theme.trim()
      : undefined;

  const budget = computeTimeBudget(
    options?.answers || profile.rawValues || {},
  );
  const available = fieldworkAvailableHours(budget.totalHours);
  const threshold = fieldworkBudgetThreshold(budget.totalHours);

  const violations: QualityViolation[] = [];
  for (const topic of topics) {
    violations.push(...checkTopic(topic, profile, corpus, imposedTheme));

    const plan = topic.fieldwork_plan || [];
    const hours =
      typeof topic.estimated_hours === "number"
        ? topic.estimated_hours
        : estimateFieldworkHours(plan);
    if (hours > threshold) {
      const summary =
        formatFieldworkPlanSummary(plan) || "plan de collecte";
      violations.push({
        code: "OVER_BUDGET",
        axis: topic.axis,
        detail: `${summary} ≈ ${hours} h pour ${available} h disponibles. Réduisez les quantités ou changez de matériau, sans changer l'objet.`,
      });
    }
  }

  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      const a = topics[i];
      const b = topics[j];
      const titleSim = jaccard(contentWords(a.title), contentWords(b.title));
      const objSim = jaccard(
        contentWords(a.research_object || ""),
        contentWords(b.research_object || ""),
      );
      if (titleSim > 0.5 || objSim > 0.4)
        violations.push({
          code: "TOO_SIMILAR",
          axis: a.axis,
          detail: `Trop similaire à l'axe ${b.axis} (titres Jaccard>${titleSim.toFixed(2)} ou research_object Jaccard>${objSim.toFixed(2)}).`,
        });
    }
  }

  for (const rejected of options?.rejectedTitles || []) {
    for (const topic of topics) {
      if (jaccard(contentWords(topic.title), contentWords(rejected)) > 0.5)
        violations.push({
          code: "TOO_SIMILAR",
          axis: topic.axis,
          detail: "Trop similaire à un titre déjà rejeté.",
        });
    }
  }

  const codes = [...new Set(violations.map((v) => v.code))];
  return { violations, codes };
}

function stripBadContextSentences(
  context: string,
  corpus: string,
): string {
  const sentences = context
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = sentences.filter((s) => {
    if (CITATION_RE.test(s)) return false;
    if (PERCENT_RE.test(s)) return false;
    if (YEAR_RE.test(s)) {
      const years = s.match(YEAR_RE) || [];
      if (years.some((y) => !valueInProfile(y, corpus))) return false;
    }
    if (BIG_NUMBER_RE.test(s)) {
      const nums = s.match(BIG_NUMBER_RE) || [];
      if (nums.some((n) => !valueInProfile(n, corpus))) return false;
    }
    return true;
  });
  const joined = kept.join(" ").trim();
  if (joined) return joined;
  return clampAtSentence(context, 200) || context;
}

/** Dernier recours si la correction LLM laisse encore des violations. */
export function sanitizeAfterFailedCorrection(
  topics: GeneratedTopic[],
  profile: PseudonymizedProfile,
  options?: { answers?: Record<string, unknown> },
): GeneratedTopic[] {
  const corpus = profileCorpus(profile);
  const answers = options?.answers || profile.rawValues || {};
  const guide = getProjectLevelGuide(
    typeof answers.project_type === "string" ? answers.project_type : undefined,
  );
  const minHyp = minHypothesesFromGuide(guide);

  return topics.map((topic) => {
    const profile_links = (topic.profile_links || []).filter((l) =>
      valueInProfile(l.profile_value, corpus),
    );
    const keywords_fr = topic.keywords_fr.filter(
      (k) => !GENERIC_KEYWORDS.has(normalize(k)),
    );
    const keywords_en = topic.keywords_en.filter(
      (k) => !GENERIC_KEYWORDS.has(normalize(k)),
    );

    const warnings: TopicWarning[] = [...(topic.warnings || [])];
    let hypotheses = topic.hypotheses;
    const cleanHyp = topic.hypotheses.filter((h) => !META_HYPOTHESIS_RE.test(h));
    const hadMeta = cleanHyp.length < topic.hypotheses.length;
    if (hadMeta) {
      if (cleanHyp.length >= minHyp) {
        hypotheses = cleanHyp;
      } else {
        warnings.push({
          code: "META_HYPOTHESIS",
          message:
            "Une hypothèse porte encore sur la personne ou la démarche plutôt que sur l'objet : à reformuler.",
        });
      }
    }

    return {
      ...topic,
      hypotheses,
      warnings: dedupeWarnings(warnings),
      context: stripBadContextSentences(topic.context || "", corpus),
      profile_links:
        profile_links.length >= 2
          ? profile_links.slice(0, 4)
          : topic.profile_links,
      keywords_fr:
        keywords_fr.length >= 2 ? keywords_fr : topic.keywords_fr,
      keywords_en:
        keywords_en.length >= 2 ? keywords_en : topic.keywords_en,
      readings: topic.readings || [],
    };
  });
}

function dedupeWarnings(warnings: TopicWarning[]): TopicWarning[] {
  const seen = new Set<string>();
  const out: TopicWarning[] = [];
  for (const w of warnings) {
    if (seen.has(w.code)) continue;
    seen.add(w.code);
    out.push(w);
  }
  return out;
}

/**
 * Ajoute UNDER_SCALE pour une thèse trop légère ;
 * nettoie aussi META_HYPOTHESIS restants si possible.
 */
export function attachTopicWarnings(
  topics: GeneratedTopic[],
  answers: Record<string, unknown>,
): GeneratedTopic[] {
  const projectType = normalizeProjectType(
    typeof answers.project_type === "string" ? answers.project_type : undefined,
  );
  const budget = computeTimeBudget(answers);
  const available = fieldworkAvailableHours(budget.totalHours);
  const underScaleThreshold = available * 0.15;
  const guide = getProjectLevelGuide(
    typeof answers.project_type === "string" ? answers.project_type : undefined,
  );
  const minHyp = minHypothesesFromGuide(guide);

  return topics.map((topic) => {
    const warnings: TopicWarning[] = [...(topic.warnings || [])];
    let hypotheses = topic.hypotheses;

    const cleanHyp = topic.hypotheses.filter((h) => !META_HYPOTHESIS_RE.test(h));
    const hadMeta = cleanHyp.length < topic.hypotheses.length;
    if (hadMeta) {
      if (cleanHyp.length >= minHyp) {
        hypotheses = cleanHyp;
      } else if (!warnings.some((w) => w.code === "META_HYPOTHESIS")) {
        warnings.push({
          code: "META_HYPOTHESIS",
          message:
            "Une hypothèse porte encore sur la personne ou la démarche plutôt que sur l'objet : à reformuler.",
        });
      }
    }

    const hours =
      typeof topic.estimated_hours === "number"
        ? topic.estimated_hours
        : estimateFieldworkHours(topic.fieldwork_plan || []);
    if (
      projectType === "thesis" &&
      hours < underScaleThreshold &&
      !warnings.some((w) => w.code === "UNDER_SCALE")
    ) {
      warnings.push({
        code: "UNDER_SCALE",
        message: "Terrain probablement trop léger pour une thèse",
      });
    }

    return {
      ...topic,
      hypotheses,
      estimated_hours: hours,
      warnings: dedupeWarnings(warnings),
    };
  });
}

export function formatViolationsForCorrection(
  violations: QualityViolation[],
): string {
  return violations
    .map((v) => {
      const axis = v.axis ? `Sujet ${v.axis}` : "Sujets";
      return `${axis} [${v.code}] : ${v.detail}`;
    })
    .join("\n");
}
