/**
 * Seuils méthodologiques indicatifs — à ajuster sans toucher aux prompts.
 * Injectés en clair dans la génération et la relecture.
 */
export const METHOD_THRESHOLDS = {
  /** Sous ce nombre de personnes/cas : pas de comparaison de fréquences entre sous-groupes. */
  MIN_CASES_FOR_GROUP_FREQUENCY: 30,
  /** Documents codés par groupe comparé pour un test de proportions ou un khi-deux. */
  MIN_DOCS_PER_GROUP_FOR_TESTS: 50,
  /** Taille approximative de corpus (mots) pour une statistique textuelle. */
  MIN_WORDS_TEXTUAL_STATS: 30_000,
  /** Mots minimum par sous-corpus comparé en statistique textuelle. */
  MIN_WORDS_PER_SUBCORPUS: 8_000,
  /** Estimation du volume d'un entretien d'une heure transcrit. */
  WORDS_PER_INTERVIEW_HOUR: 8_000,
  /** Effectif attendu minimal par case dans une comparaison quantitative. */
  MIN_EXPECTED_PER_CELL: 30,
} as const;

export type MethodThresholdKey = keyof typeof METHOD_THRESHOLDS;

/**
 * Règle de l'unité d'analyse, avec les seuils substitués.
 * Pour le prompt de génération et celui du relecteur.
 */
export function formatUnitOfAnalysisRule(): string {
  const t = METHOD_THRESHOLDS;
  return [
    "Ce qui compte, c'est l'unité d'analyse comparée.",
    `- Personnes ou cas (entretiens, observations, études de cas) : en dessous de ${t.MIN_CASES_FOR_GROUP_FREQUENCY}, pas de comparaison de fréquences entre sous-groupes. On compare des cas contrastés, ou chaque personne avec elle-même.`,
    `- Statistique textuelle sur des transcriptions ou des textes (lexicométrie, spécificités, classification de segments) : légitime si le corpus dépasse environ ${t.MIN_WORDS_TEXTUAL_STATS} mots (un entretien d'une heure ≈ ${t.WORDS_PER_INTERVIEW_HOUR} mots). Les comparaisons entre sous-corpus sont légitimes si chacun dépasse environ ${t.MIN_WORDS_PER_SUBCORPUS} mots.`,
    `- Documents codés (avis, articles, publications, notices) : tests de proportions ou khi-deux légitimes si chaque groupe comparé compte au moins ${t.MIN_DOCS_PER_GROUP_FOR_TESTS} documents.`,
    `- Enquête par questionnaire ou base de données : comparaisons et modèles légitimes si l'effectif attendu par case ou par modalité atteint ${t.MIN_EXPECTED_PER_CELL}. Estime cet effectif avant de conclure à des cases vides.`,
  ].join("\n");
}

/** Bloc court pour rappel des seuils numériques dans les prompts. */
export function formatMethodThresholdsSummary(): string {
  const t = METHOD_THRESHOLDS;
  return [
    `Seuils méthodologiques (indicatif) :`,
    `- comparaison de fréquences entre sous-groupes de personnes/cas : ≥ ${t.MIN_CASES_FOR_GROUP_FREQUENCY} cas ;`,
    `- test de proportions / khi-deux sur documents codés : ≥ ${t.MIN_DOCS_PER_GROUP_FOR_TESTS} documents par groupe ;`,
    `- statistique textuelle : corpus ≈ ≥ ${t.MIN_WORDS_TEXTUAL_STATS} mots (≈ ${t.WORDS_PER_INTERVIEW_HOUR} mots / h d'entretien) ;`,
    `- sous-corpus en statistique textuelle : ≥ ${t.MIN_WORDS_PER_SUBCORPUS} mots chacun ;`,
    `- effectif attendu par case (questionnaire / base) : ≥ ${t.MIN_EXPECTED_PER_CELL}.`,
  ].join("\n");
}
