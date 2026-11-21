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
import { topicQuestions } from "../../../../shared/research/topicQuestions";
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
  | "TITLE_TOO_LONG"
  | "QUESTION_TOO_LONG"
  | "QUESTION_DOUBLE"
  | "SHALLOW_LINKS"
  | "COMPLEX_DESIGN"
  | "GENDERED_USER"
  | "METHOD_TO_LEARN_DROPPED"
  | "PITCH_QUANTITY"
  | "PITCH_REPETITIVE"
  | "MINORS_ETHICS"
  | "ONLINE_ETHICS";

/** Champs profil qui comptent comme liens substantiels (SHALLOW_LINKS). */
const SUBSTANTIAL_PROFILE_FIELDS = [
  "specialty",
  "interest_objects",
  "favorite_courses",
  "liked_aspects",
  "inspiring_concept",
  "past_works",
  "continue_or_avoid_detail",
  "field_access",
  "methods_skills",
  "method_to_learn",
  "imposed_theme",
  "lab_themes",
  "curious_discipline",
] as const;

const COMPLEX_DESIGN_TYPES = new Set(["licence", "m1", "m2", "pro"]);

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

/** Mineurs dans objet / terrain / question. */
const MINORS_MENTION_RE =
  /\b(mineur(?:e?s)?|adolescent(?:e?s)?|coll[eé]gien(?:ne)?s?|lyc[eé]en(?:ne)?s?|[eé]l[eè]ves?|enfant(?:s)?|moins\s+de\s+18(?:\s*ans)?|moins\s+d['']18(?:\s*ans)?)\b/i;

/** Contenu publié en ligne / plateformes. */
const ONLINE_CONTENT_RE =
  /\b(en\s+ligne|plateforme(?:s)?|r[eé]seaux?\s+sociaux?|commentaire(?:s)?|forum(?:s)?|twitter|facebook|instagram|tiktok|youtube|reddit|blog(?:s)?|site(?:s)?\s+web|publications?\s+en\s+ligne|messages?\s+en\s+ligne|fan-?fiction|communautaires?)\b/i;

/** Mentions genrées de la personne enquêtante (labels nominaux). */
const GENDERED_USER_RE =
  /\b(une\s+stagiaire|un\s+stagiaire|étudiante|etudiante|étudiant|etudiant)\b/i;

/** Accord genré après « vous êtes / serez / … » (participe ou adjectif). */
const GENDERED_VOUS_RE =
  /\bvous\s+(êtes|serez|semblez|restez|devenez)\s+(bien\s+|très\s+|déjà\s+|plus\s+)?([a-zàâçéèêëîïôûùüÿœ-]+(?:é|ée|és|ées|eux|euse|if|ive))\b/iu;

/** Adjectifs / participes invariables ou neutres acceptés après « vous êtes ». */
const GENDER_INVARIABLE_WORDS = new Set([
  "capable",
  "libre",
  "autonome",
  "disponible",
  "responsable",
  "accessible",
  "possible",
  "utile",
  "necessaire",
  "nécessaire",
  "apte",
  "digne",
  "credible",
  "crédible",
  "legitime",
  "légitime",
  "prioritaire",
  "volontaire",
  "favorable",
]);

const PROFILE_GENDER_RE =
  /\b(genre|sexe|madame|monsieur|mme\b|m\.|mr\b|femme|homme|féminin|masculin|fille|garçon)\b/i;

/** Seconde interrogation coordonnée dans la question de recherche. */
const QUESTION_DOUBLE_RE =
  /(?:^|[,;:\s])\bet\s+(?:selon\s+)?(?:comment|dans\s+quelle\s+mesure|avec\s+quel(?:le|les|s)?|en\s+quoi|quel(?:le|les|s)?|pourquoi|que)\b/i;

/** Quantité chiffrée ou en mots dans le pitch (hors sigles type M1/M2). */
const PITCH_QUANTITY_WORD_RE =
  /\b(dizaine|vingtaine|trentaine|quarantaine|centaine)s?\b/i;
const PITCH_QUANTITY_UNIT_RE =
  /\b(?:\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|quinze|vingt|trente|quarante|cinquante|soixante|cent)\s+(?:entretiens?|documents?|semaines?|mois|heures?)\b/i;
const PITCH_DIGIT_RE = /(?<![A-Za-zÀ-ÿ])\d+(?![A-Za-zÀ-ÿ])/;

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

function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function hasGenderedVousAccord(text: string): boolean {
  GENDERED_VOUS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(GENDERED_VOUS_RE.source, GENDERED_VOUS_RE.flags);
  while ((m = re.exec(text)) !== null) {
    const adj = (m[3] || "").toLowerCase();
    const stem = adj
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (GENDER_INVARIABLE_WORDS.has(adj) || GENDER_INVARIABLE_WORDS.has(stem))
      continue;
    return true;
  }
  return false;
}

function firstWords(text: string, n: number): string {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, n)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isSubstantialFilled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length >= 2;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return Boolean(value);
}

function substantialFieldValues(
  profile: PseudonymizedProfile,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of SUBSTANTIAL_PROFILE_FIELDS) {
    const raw = profile.rawValues[id];
    if (!isSubstantialFilled(raw)) continue;
    const labeled = profile.fields[id];
    const text =
      typeof labeled === "string" && labeled.trim()
        ? labeled
        : typeof raw === "string"
          ? raw
          : JSON.stringify(raw);
    out.set(id, text);
  }
  return out;
}

function linkMobilizesSubstantial(
  link: { field: string; profile_value: string },
  substantial: Map<string, string>,
): boolean {
  const fieldNorm = normalize(link.field);
  const valueNorm = normalize(link.profile_value);
  if (!valueNorm) return false;
  for (const [id, text] of substantial) {
    const q = topicQuestions.find((item) => item.id === id);
    const labelNorm = q ? normalize(q.label) : "";
    if (labelNorm && (fieldNorm.includes(labelNorm.slice(0, 24)) || labelNorm.includes(fieldNorm.slice(0, 24)))) {
      return true;
    }
    if (fieldNorm.includes(normalize(id).replace(/_/g, " "))) return true;
    const textNorm = normalize(text);
    if (textNorm && (valueNorm.includes(textNorm.slice(0, 40)) || textNorm.includes(valueNorm.slice(0, 40)))) {
      return true;
    }
  }
  return false;
}

function minorsScopeText(topic: GeneratedTopic): string {
  return [
    topic.research_object || "",
    topic.field_or_corpus || "",
    topic.research_question || "",
  ].join("\n");
}

function ethicalNotesCoverMinors(notes: string | null | undefined): boolean {
  if (!notes || !notes.trim()) return false;
  const hasLegalRep =
    /autoris/.test(notes) &&
    /repr[eé]sentant|parent|tuteur|l[eé]gal/i.test(notes);
  const hasEstablishment =
    /(?:accord|autorisation).{0,50}(?:[eé]tablissement|structure|[eé]cole|coll[eè]ge|lyc[eé]e|m[eé]diath[eè]que)|(?:[eé]tablissement|structure|[eé]cole|coll[eè]ge|lyc[eé]e|m[eé]diath[eè]que).{0,50}(?:accord|autorisation|avis)/i.test(
      notes,
    );
  const hasAgeAdapted =
    /information.{0,40}adapt[eé]e.{0,20}[aâ]ge|adapt[eé]e\s+[aà]\s+l['']?[aâ]ge|[aâ]ge\s+des\s+(?:participant|enfant|mineur)/i.test(
      notes,
    );
  return hasLegalRep && hasEstablishment && hasAgeAdapted;
}

function ethicalNotesCoverOnline(notes: string | null | undefined): boolean {
  if (!notes || !notes.trim()) return false;
  const hasPublic =
    /espaces?\s+publics?|donn[eé]es?\s+publiques?|contenu(?:s)?\s+public(?:s)?/i.test(
      notes,
    );
  const hasTos =
    /conditions?\s+d['']utilisation|conditions?\s+g[eé]n[eé]rales|CGU|ToS/i.test(
      notes,
    );
  const hasPseudo =
    /pseudonymi(?:sation|ser)|anonymi(?:sation|ser).{0,30}d[eè]s\s+la\s+collecte|d[eè]s\s+la\s+collecte.{0,30}(?:pseudonymi|anonymi)/i.test(
      notes,
    );
  const hasNoLiteral =
    /citation\s+litt[eé]rale|moteur\s+de\s+recherche|non\s+retrouvable|pas\s+de\s+citation\s+verbatim|aucune\s+citation/i.test(
      notes,
    );
  const hasSensitiveCaution =
    /opinions?\s+politiques?|religieux|religieuse|sant[eé]|article\s*9|donn[eé]es?\s+sensibles?/i.test(
      notes,
    );
  return (
    hasPublic && hasTos && hasPseudo && hasNoLiteral && hasSensitiveCaution
  );
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

  const title = topic.title || "";
  const colonCount = (title.match(/:/g) || []).length;
  if (wordCount(title) > 15 || title.length > 110 || colonCount > 1) {
    out.push({
      code: "TITLE_TOO_LONG",
      axis,
      detail:
        "Raccourcis le titre (≤ 15 mots, ≤ 110 caractères, au plus un « : »).",
    });
  }

  const question = topic.research_question || "";
  const qMarks = (question.match(/\?/g) || []).length;
  if (wordCount(question) > 30 || qMarks > 1) {
    out.push({
      code: "QUESTION_TOO_LONG",
      axis,
      detail:
        "Une seule question interrogative de 30 mots au plus (un seul « ? »).",
    });
  }
  if (QUESTION_DOUBLE_RE.test(question)) {
    out.push({
      code: "QUESTION_DOUBLE",
      axis,
      detail:
        "La question contient une seconde interrogation coordonnée (« et comment… », « et avec quels… », etc.). Une seule interrogation ; le second niveau va dans les hypothèses.",
    });
  }

  const pitch = topic.pitch || "";
  if (
    PITCH_DIGIT_RE.test(pitch) ||
    PITCH_QUANTITY_WORD_RE.test(pitch) ||
    PITCH_QUANTITY_UNIT_RE.test(pitch)
  ) {
    out.push({
      code: "PITCH_QUANTITY",
      axis,
      detail:
        "Retirez du pitch toute quantité (chiffre, vingtaine, N entretiens ou semaines). Ces chiffres restent dans les détails du projet.",
    });
  }

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
  const covered = new Set<number>();
  for (const t of tests) {
    const i = t.hypothesis_index;
    if (Number.isInteger(i) && i >= 0 && i < hypCount) covered.add(i);
  }
  for (let i = 0; i < hypCount; i++) {
    if (!covered.has(i)) {
      out.push({
        code: "MISSING_TEST",
        axis,
        detail: `hypothesis_index=${i}`,
      });
    }
  }
  if (
    tests.length !== hypCount &&
    covered.size === hypCount &&
    hypCount > 0
  ) {
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
      { field: "pitch", text: topic.pitch || "" },
      ...(topic.stakes || []).map((s, i) => ({
        field: `stakes[${i}]`,
        text: s,
      })),
      ...(topic.leads || []).map((s, i) => ({
        field: `leads[${i}]`,
        text: s,
      })),
      ...(topic.feasibility?.risks || []).map((r, i) => ({
        field: `feasibility.risks[${i}]`,
        text: r,
      })),
    ];
    for (const { field, text } of genderedFields) {
      if (GENDERED_USER_RE.test(text) || hasGenderedVousAccord(text)) {
        out.push({
          code: "GENDERED_USER",
          axis,
          detail: `Le champ ${field} accorde un genre à la personne. Reformule de façon neutre (« ce stage vous place au bon endroit », « vous avez accès à… »).`,
        });
      }
    }
  }

  const minorsHaystack = minorsScopeText(topic);
  if (MINORS_MENTION_RE.test(minorsHaystack)) {
    if (!ethicalNotesCoverMinors(topic.ethical_notes)) {
      out.push({
        code: "MINORS_ETHICS",
        axis,
        detail:
          "Enquête auprès de mineurs : ethical_notes doit mentionner l'autorisation des représentants légaux, l'accord de l'établissement ou de la structure, et l'information adaptée à l'âge.",
      });
    }
  }

  const onlineHaystack = [
    minorsHaystack,
    topic.method || "",
    ...(topic.leads || []),
  ].join("\n");
  if (ONLINE_CONTENT_RE.test(onlineHaystack)) {
    if (!ethicalNotesCoverOnline(topic.ethical_notes)) {
      out.push({
        code: "ONLINE_ETHICS",
        axis,
        detail:
          "Contenus en ligne : ethical_notes doit indiquer espaces publics uniquement, respect des conditions d'utilisation, pseudonymisation dès la collecte, aucune citation littérale retrouvable par un moteur de recherche, et prudence pour opinions politiques/religieuses et santé.",
      });
    }
  }

  const substantial = substantialFieldValues(profile);
  if (substantial.size >= 2) {
    const mobilized = (topic.profile_links || []).filter((link) =>
      linkMobilizesSubstantial(link, substantial),
    ).length;
    if (mobilized < 2) {
      out.push({
        code: "SHALLOW_LINKS",
        axis,
        detail:
          "Le profil a au moins 2 champs substantiels renseignés : mobilisez-en au moins 2 dans profile_links (intérêts, terrain, méthodes, cours…).",
      });
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
  const answers = options?.answers || profile.rawValues || {};
  const learnValues = methodToLearnValues(answers);
  const learnOther =
    typeof answers.method_to_learn_other === "string"
      ? answers.method_to_learn_other
      : undefined;

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

    if (topic.axis === "ambition" && learnValues.length) {
      const missing = learnValues.filter(
        (v) => !methodMentionsLearnTarget(topic.method || "", v, learnOther),
      );
      if (missing.length) {
        violations.push({
          code: "METHOD_TO_LEARN_DROPPED",
          axis: "ambition",
          detail:
            "La méthode à apprendre déclarée dans le profil doit figurer comme méthode d'analyse à part entière dans method (pas seulement comme outil exploratoire). Réintégrez-la sans alléger le dispositif tant que le budget d'heures le permet.",
        });
      }
    }

    const projectType = normalizeProjectType(
      typeof answers.project_type === "string" ? answers.project_type : undefined,
    );
    if (COMPLEX_DESIGN_TYPES.has(projectType)) {
      const units = new Set(
        (topic.fieldwork_plan || []).map((p) => p.unit).filter(Boolean),
      );
      if (units.size > 2) {
        violations.push({
          code: "COMPLEX_DESIGN",
          axis: topic.axis,
          detail: `Plus de 2 unités différentes dans fieldwork_plan (${[...units].join(", ")}) pour un ${projectType} : simplifiez le dispositif.`,
        });
      }
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
      const pitchA = firstWords(a.pitch || "", 4);
      const pitchB = firstWords(b.pitch || "", 4);
      if (pitchA && pitchB && pitchA === pitchB) {
        violations.push({
          code: "PITCH_REPETITIVE",
          axis: a.axis,
          detail: `Les pitchs ${a.axis} et ${b.axis} commencent par les mêmes 4 mots. Commencez chaque pitch différemment.`,
        });
      }
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
    const cleaned = dropMetaHypotheses(topic, minHyp);
    if (cleaned.warning) warnings.push(cleaned.warning);

    return {
      ...topic,
      hypotheses: cleaned.hypotheses,
      hypothesis_tests: cleaned.hypothesis_tests,
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

function dropMetaHypotheses(
  topic: GeneratedTopic,
  minHyp: number,
): {
  hypotheses: string[];
  hypothesis_tests: GeneratedTopic["hypothesis_tests"];
  warning?: TopicWarning;
} {
  const keepMask = topic.hypotheses.map((h) => !META_HYPOTHESIS_RE.test(h));
  const hadMeta = keepMask.some((ok) => !ok);
  if (!hadMeta) {
    return {
      hypotheses: topic.hypotheses,
      hypothesis_tests: topic.hypothesis_tests || [],
    };
  }
  const cleanHyp = topic.hypotheses.filter((_, i) => keepMask[i]);
  if (cleanHyp.length < minHyp) {
    return {
      hypotheses: topic.hypotheses,
      hypothesis_tests: topic.hypothesis_tests || [],
      warning: {
        code: "META_HYPOTHESIS",
        message:
          "Une hypothèse porte encore sur la personne ou la démarche plutôt que sur l'objet : à reformuler.",
      },
    };
  }
  const indexMap = new Map<number, number>();
  let next = 0;
  keepMask.forEach((ok, oldIdx) => {
    if (ok) {
      indexMap.set(oldIdx, next);
      next += 1;
    }
  });
  const hypothesis_tests = (topic.hypothesis_tests || [])
    .filter((t) => indexMap.has(t.hypothesis_index))
    .map((t) => ({
      ...t,
      hypothesis_index: indexMap.get(t.hypothesis_index)!,
    }));
  return { hypotheses: cleanHyp, hypothesis_tests };
}

function dedupeWarnings(warnings: TopicWarning[]): TopicWarning[] {
  const seen = new Set<string>();
  const out: TopicWarning[] = [];
  for (const w of warnings) {
    const key = `${w.code}::${w.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

const REMAINING_DEFECT_LABELS: Record<string, string> = {
  BANNED_PHRASE: "expression interdite",
  TITLE_PROJECT_TYPE: "type de projet dans le titre",
  CONTEXT_UNSOURCED_FACT: "fait non sourcé dans le contexte",
  FAKE_PROFILE_LINK: "lien au profil non vérifié",
  GENERIC_KEYWORD: "mot-clé trop générique",
  TOO_SIMILAR: "sujet trop proche d'un autre",
  IMPOSED_THEME_IGNORED: "thème imposé non repris",
  OVER_BUDGET: "plan de terrain trop lourd",
  TITLE_TOO_LONG: "titre trop long ou trop chargé",
  QUESTION_TOO_LONG: "question trop longue ou double",
  QUESTION_DOUBLE: "question à double interrogation",
  PITCH_QUANTITY: "quantité dans le pitch",
  PITCH_REPETITIVE: "pitchs qui commencent pareil",
  SHALLOW_LINKS: "liens au profil trop superficiels",
  COMPLEX_DESIGN: "dispositif trop complexe pour le niveau",
  GENDERED_USER: "formulation genrée",
  METHOD_TO_LEARN_DROPPED: "méthode à apprendre absente de l'axe ambition",
  TESTABILITY: "hypothèse difficile à tester",
  ORIGINALITY: "apport trop faible pour le niveau",
  UNSUPPORTED_CLAIM: "affirmation non soutenue par le profil",
  VAGUE_OBJECT: "objet trop vague",
  METHOD_MISMATCH: "méthode inadaptée à l'hypothèse",
  OVERLAP: "chevauchement avec un autre sujet",
  CLARITY: "titre ou question peu clairs",
  RELEVANCE: "sujet peu ancré dans le profil",
  INCONSISTENT: "discours incohérent avec le sujet",
  ETHICS: "problème d'éthique du recrutement ou des données",
  MINORS_ETHICS: "précautions éthiques manquantes pour les mineurs",
  ONLINE_ETHICS: "précautions éthiques manquantes pour les contenus en ligne",
};

/** Motifs de détection pour method_to_learn (valeur → regex sur method). */
const METHOD_TO_LEARN_PATTERNS: Record<string, RegExp> = {
  interviews: /\bentretien/i,
  observation: /\bobservation/i,
  survey: /questionnaire|enqu[eê]te/i,
  desc_stats: /statistique\s+descriptive|descriptiv/i,
  infer_stats:
    /r[eé]gression|statistique\s+inf[eé]rentielle|mod[eè]le\s+logistique|anova|khi-?deux/i,
  content_analysis: /analyse\s+de\s+contenu|analyse\s+du\s+discours|discours/i,
  archives: /\barchives?\b/i,
  lit_review: /revue\s+de\s+litt[eé]rature|litt[eé]rature\s+secondaire/i,
  gis: /cartograph|sig\b|g[eé]omatique/i,
  experiment: /exp[eé]riment/i,
  nlp: /analyse\s+textuelle|lexicom[eé]tr|sp[eé]cificit[eé]s|classification\s+de\s+segments|traitement\s+automatique|nlp|textometr/i,
  programming: /programmation|script|python|r\b|stata/i,
};

function methodToLearnValues(answers: Record<string, unknown>): string[] {
  const raw = answers.method_to_learn;
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

function methodMentionsLearnTarget(
  method: string,
  value: string,
  otherText?: string,
): boolean {
  const hay = `${method} ${otherText || ""}`;
  if (value === "other") {
    const other = (otherText || "").trim();
    if (!other) return true;
    const tokens = other
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4);
    if (!tokens.length) return true;
    const norm = hay
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return tokens.some((t) => norm.includes(t));
  }
  const re = METHOD_TO_LEARN_PATTERNS[value];
  if (re) return re.test(hay);
  // Valeur inconnue : recherche littérale assouplie.
  const needle = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, " ");
  return hay
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .includes(needle);
}

/**
 * Transforme les violations QC encore présentes après correction
 * en avertissements visibles sur la carte.
 * TOO_LONG / TITLE_TOO_LONG / QUESTION_TOO_LONG / PITCH_REPETITIVE :
 * journal uniquement (pas de carte).
 * COMPLEX_DESIGN : avertissement carte, jamais de correction LLM.
 */
export function attachRemainingDefectWarnings(
  topics: GeneratedTopic[],
  violations: QualityViolation[],
): GeneratedTopic[] {
  return topics.map((topic) => {
    const axisViolations = violations.filter(
      (v) => !v.axis || v.axis === topic.axis,
    );
    const warnings: TopicWarning[] = [...(topic.warnings || [])];

    for (const v of axisViolations) {
      if (v.code === "TOO_LONG") {
        console.info(
          JSON.stringify({
            event: "topics.quality",
            code: "TOO_LONG",
            axis: topic.axis,
            detail: v.detail.slice(0, 120),
          }),
        );
        continue;
      }
      if (v.code === "TITLE_TOO_LONG") {
        console.info(
          JSON.stringify({
            event: "topics.quality",
            code: "TITLE_TOO_LONG_KEPT",
            axis: topic.axis,
            detail: v.detail.slice(0, 120),
          }),
        );
        continue;
      }
      if (v.code === "QUESTION_TOO_LONG") {
        console.info(
          JSON.stringify({
            event: "topics.quality",
            code: "QUESTION_TOO_LONG_KEPT",
            axis: topic.axis,
            detail: v.detail.slice(0, 120),
          }),
        );
        continue;
      }
      if (v.code === "PITCH_REPETITIVE") {
        console.info(
          JSON.stringify({
            event: "topics.quality",
            code: "PITCH_REPETITIVE",
            axis: topic.axis,
            detail: v.detail.slice(0, 120),
          }),
        );
        continue;
      }
      if (v.code === "META_HYPOTHESIS") {
        // déjà traité dans attachTopicWarnings / sanitize
        if (!warnings.some((w) => w.code === "META_HYPOTHESIS")) {
          warnings.push({
            code: "META_HYPOTHESIS",
            message:
              "Une hypothèse porte encore sur la personne ou la démarche plutôt que sur l'objet : à reformuler.",
          });
        }
        continue;
      }
      if (v.code === "MISSING_TEST") {
        const m = /hypothesis_index=(\d+)/.exec(v.detail);
        if (m) {
          const n = Number(m[1]) + 1;
          const message = `Test de l'hypothèse ${n} à préciser`;
          if (!warnings.some((w) => w.message === message)) {
            warnings.push({ code: "MISSING_TEST", message });
          }
        } else {
          const message = "Test de l'hypothèse à préciser";
          if (!warnings.some((w) => w.code === "MISSING_TEST" && w.message === message)) {
            warnings.push({ code: "MISSING_TEST", message });
          }
        }
        continue;
      }
      if (v.code === "COMPLEX_DESIGN") {
        const message =
          "Dispositif riche pour ce type de travail : vous pourrez le simplifier en gardant une source principale.";
        if (!warnings.some((w) => w.code === "COMPLEX_DESIGN")) {
          warnings.push({ code: "COMPLEX_DESIGN", message });
        }
        continue;
      }
      // Libellé lisible : préfère le détail QC quand il est déjà formulé.
      const label =
        REMAINING_DEFECT_LABELS[v.code] ||
        v.code.toLowerCase().replace(/_/g, " ");
      const detail = (v.detail || "").trim();
      const message =
        detail.length >= 12
          ? detail
          : `Point à vérifier : ${label}`;
      if (!warnings.some((w) => w.message === message)) {
        warnings.push({ code: "REMAINING_DEFECT", message });
      }
    }

    return { ...topic, warnings: dedupeWarnings(warnings) };
  });
}

/**
 * Défauts bloquants de relecture non corrigés (passage inchangé) → carte.
 */
export function attachUncorrectedReviewWarnings(
  topics: GeneratedTopic[],
  corrections: Array<{
    axis: TopicAxis;
    code: string;
    severity: string;
    explanation: string;
    before: unknown;
    after: unknown;
  }>,
): GeneratedTopic[] {
  return topics.map((topic) => {
    const warnings: TopicWarning[] = [...(topic.warnings || [])];
    const relevant = corrections.filter(
      (c) =>
        c.axis === topic.axis &&
        c.severity === "blocking" &&
        JSON.stringify(c.before) === JSON.stringify(c.after),
    );
    for (const c of relevant) {
      // Consigne modèle / journal uniquement — jamais affiché à l'étudiant.
      if (
        c.code === "TITLE_TOO_LONG" ||
        c.code === "QUESTION_TOO_LONG" ||
        c.code === "PITCH_REPETITIVE"
      ) {
        console.info(
          JSON.stringify({
            event: "topics.quality",
            code:
              c.code === "TITLE_TOO_LONG"
                ? "TITLE_TOO_LONG_KEPT"
                : c.code === "QUESTION_TOO_LONG"
                  ? "QUESTION_TOO_LONG_KEPT"
                  : "PITCH_REPETITIVE",
            axis: topic.axis,
          }),
        );
        continue;
      }
      const label =
        REMAINING_DEFECT_LABELS[c.code] ||
        c.code.toLowerCase().replace(/_/g, " ");
      const explanation = (c.explanation || "").trim();
      const message = explanation
        ? explanation
        : `Point à vérifier : ${label}`;
      if (!warnings.some((w) => w.message === message)) {
        warnings.push({ code: "REMAINING_DEFECT", message });
      }
    }
    return { ...topic, warnings: dedupeWarnings(warnings) };
  });
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
    const cleaned = dropMetaHypotheses(topic, minHyp);
    if (
      cleaned.warning &&
      !warnings.some((w) => w.code === "META_HYPOTHESIS")
    ) {
      warnings.push(cleaned.warning);
    }

    const plan = topic.fieldwork_plan || [];
    const hours =
      typeof topic.estimated_hours === "number"
        ? topic.estimated_hours
        : estimateFieldworkHours(plan);
    const hasSecondaryDataset = plan.some(
      (p) => p.unit === "secondary_dataset" || p.unit === "secondary_analysis_month",
    );
    if (
      projectType === "thesis" &&
      !hasSecondaryDataset &&
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
      hypotheses: cleaned.hypotheses,
      hypothesis_tests: cleaned.hypothesis_tests,
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
