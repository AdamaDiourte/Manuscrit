/** Coûts unitaires de collecte / analyse (heures, tout compris). */

export const FIELDWORK_UNIT_HOURS = {
  interview: 6,
  group_interview: 8,
  observation_session: 5,
  questionnaire: 30,
  questionnaire_response: 8,
  document: 0.5,
  secondary_dataset: 25,
  /** Analyse approfondie de données secondaires, par mois. */
  secondary_analysis_month: 140,
  archive_day: 8,
} as const;

export type FieldworkUnit = keyof typeof FIELDWORK_UNIT_HOURS;

export type FieldworkPlanItem = {
  unit: FieldworkUnit;
  quantity: number;
};

/** Part du budget total réservée à la collecte et à l'analyse. */
export const FIELDWORK_SHARE = 0.5;

export const FIELDWORK_UNITS = Object.keys(
  FIELDWORK_UNIT_HOURS,
) as FieldworkUnit[];

export function isFieldworkUnit(value: string): value is FieldworkUnit {
  return value in FIELDWORK_UNIT_HOURS;
}

/** Heures estimées à partir du plan (jamais calculées par le modèle). */
export function estimateFieldworkHours(plan: FieldworkPlanItem[]): number {
  let total = 0;
  for (const item of plan) {
    if (!isFieldworkUnit(item.unit)) continue;
    const q = Number(item.quantity);
    if (!Number.isFinite(q) || q <= 0) continue;
    total += FIELDWORK_UNIT_HOURS[item.unit] * q;
  }
  return Math.round(total * 10) / 10;
}

/** Heures disponibles pour la collecte (= FIELDWORK_SHARE × total). */
export function fieldworkAvailableHours(totalHours: number): number {
  return Math.round(totalHours * FIELDWORK_SHARE * 10) / 10;
}

/** Seuil OVER_BUDGET : disponibles × 1,1. */
export function fieldworkBudgetThreshold(totalHours: number): number {
  return Math.round(fieldworkAvailableHours(totalHours) * 1.1 * 10) / 10;
}

const UNIT_LABEL_FR: Record<FieldworkUnit, string> = {
  interview: "entretien(s)",
  group_interview: "entretien(s) collectif(s)",
  observation_session: "session(s) d'observation",
  questionnaire: "questionnaire(s)",
  questionnaire_response: "tranche(s) de 100 répondants",
  document: "document(s)",
  secondary_dataset: "base(s) secondaire(s)",
  secondary_analysis_month: "mois d'analyse secondaire",
  archive_day: "journée(s) d'archives",
};

export function formatFieldworkPlanSummary(plan: FieldworkPlanItem[]): string {
  return plan
    .filter((p) => isFieldworkUnit(p.unit) && p.quantity > 0)
    .map((p) => `${p.quantity} ${UNIT_LABEL_FR[p.unit]}`)
    .join(", ");
}

/** Libellés pour injection dans le prompt utilisateur. */
export function formatFieldworkUnitCostsForPrompt(): string {
  return [
    `- interview (entretien individuel ~1 h) : ${FIELDWORK_UNIT_HOURS.interview} h`,
    `- group_interview (entretien collectif) : ${FIELDWORK_UNIT_HOURS.group_interview} h`,
    `- observation_session (demi-journée) : ${FIELDWORK_UNIT_HOURS.observation_session} h`,
    `- questionnaire (conception + diffusion + nettoyage, forfait) : ${FIELDWORK_UNIT_HOURS.questionnaire} h`,
    `- questionnaire_response (analyse, par tranche de 100 répondants) : ${FIELDWORK_UNIT_HOURS.questionnaire_response} h`,
    `- document (document de corpus codé) : ${FIELDWORK_UNIT_HOURS.document} h`,
    `- secondary_dataset (prise en main d'une base existante, forfait) : ${FIELDWORK_UNIT_HOURS.secondary_dataset} h`,
    `- secondary_analysis_month (analyse approfondie de données secondaires, par mois) : ${FIELDWORK_UNIT_HOURS.secondary_analysis_month} h`,
    `- archive_day (journée d'archives) : ${FIELDWORK_UNIT_HOURS.archive_day} h`,
  ].join("\n");
}
