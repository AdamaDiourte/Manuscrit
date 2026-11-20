/**
 * Correspondance discipline_main → identifiants OpenAlex `fields`
 * (source : GET https://api.openalex.org/fields — 2026-11-20).
 * Ne pas inventer d’identifiants.
 */
export type OpenAlexFieldId = number;

/** Champs OpenAlex utiles pour les SHS et disciplines voisines. */
export const OPENALEX_FIELD = {
  socialSciences: 33,
  artsAndHumanities: 12,
  psychology: 32,
  economics: 20,
  business: 14,
  computerScience: 17,
  decisionSciences: 18,
  medicine: 27,
  healthProfessions: 36,
  environmentalScience: 23,
  earthAndPlanetary: 19,
  mathematics: 26,
} as const;

/**
 * Mappe une valeur `discipline_main` (slug questionnaire) vers 1–3 field ids OpenAlex.
 */
export const DISCIPLINE_TO_OPENALEX_FIELDS: Record<string, OpenAlexFieldId[]> = {
  anthropologie: [OPENALEX_FIELD.socialSciences, OPENALEX_FIELD.artsAndHumanities],
  droit: [OPENALEX_FIELD.socialSciences],
  economie: [OPENALEX_FIELD.economics, OPENALEX_FIELD.socialSciences],
  etudes_urbaines: [OPENALEX_FIELD.socialSciences, OPENALEX_FIELD.environmentalScience],
  geographie: [OPENALEX_FIELD.socialSciences, OPENALEX_FIELD.earthAndPlanetary],
  gestion_management: [OPENALEX_FIELD.business, OPENALEX_FIELD.socialSciences],
  histoire: [OPENALEX_FIELD.artsAndHumanities, OPENALEX_FIELD.socialSciences],
  informatique: [OPENALEX_FIELD.computerScience],
  lettres: [OPENALEX_FIELD.artsAndHumanities],
  linguistique: [OPENALEX_FIELD.artsAndHumanities, OPENALEX_FIELD.socialSciences],
  philosophie: [OPENALEX_FIELD.artsAndHumanities],
  psychologie: [OPENALEX_FIELD.psychology],
  sante_publique: [OPENALEX_FIELD.medicine, OPENALEX_FIELD.healthProfessions, OPENALEX_FIELD.socialSciences],
  science_politique: [OPENALEX_FIELD.socialSciences],
  sciences_de_l_education: [OPENALEX_FIELD.socialSciences],
  sciences_de_l_information_et_de_la_communication: [
    OPENALEX_FIELD.socialSciences,
    OPENALEX_FIELD.computerScience,
  ],
  sociologie: [OPENALEX_FIELD.socialSciences],
  statistique: [OPENALEX_FIELD.mathematics, OPENALEX_FIELD.decisionSciences, OPENALEX_FIELD.socialSciences],
  autre: [OPENALEX_FIELD.socialSciences, OPENALEX_FIELD.artsAndHumanities],
};

/** Disciplines SHS → filtre HAL level0_domain_s:shs (pas domain_s:shs*). */
export const SHS_DISCIPLINES = new Set([
  "anthropologie",
  "droit",
  "economie",
  "etudes_urbaines",
  "geographie",
  "gestion_management",
  "histoire",
  "lettres",
  "linguistique",
  "philosophie",
  "psychologie",
  "science_politique",
  "sciences_de_l_education",
  "sciences_de_l_information_et_de_la_communication",
  "sociologie",
]);

export function openAlexFieldsForDiscipline(
  disciplineMain: unknown,
): OpenAlexFieldId[] {
  const key = String(disciplineMain || "")
    .trim()
    .toLowerCase();
  return DISCIPLINE_TO_OPENALEX_FIELDS[key] || [
    OPENALEX_FIELD.socialSciences,
  ];
}

export function isShsDiscipline(disciplineMain: unknown): boolean {
  return SHS_DISCIPLINES.has(String(disciplineMain || "").trim().toLowerCase());
}
