/** Plafonds d’unités par analyse selon le forfait (configurables). */

export type PlanId = "free" | "plus" | "pro";

export const UNIT_LIMITS: Record<PlanId, number> = {
  free: 150,
  plus: 1_500,
  pro: 6_000,
};

export function unitLimitForPlan(plan: string | undefined): number {
  if (plan === "plus" || plan === "pro") return UNIT_LIMITS[plan];
  return UNIT_LIMITS.free;
}
