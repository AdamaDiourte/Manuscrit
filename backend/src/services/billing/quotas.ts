import type {ObjectStore} from "../../storage/types";
import { unitLimitForPlan } from "../../../../shared/research/unitLimits";
import { entitlement, type Plan } from "./stripe";
import { BillingError, changeValue, readValue } from "./storage";
export { BillingError } from "./storage";

export const limits: Record<Plan, number> = { free: 1, plus: 20, pro: 60 };
export { unitLimitForPlan };
const month = () => new Date().toISOString().slice(0, 7);
const usageKey = (prefix: string, period: string) =>
  prefix + "billing/usage/" + period;
export const currentUsage = async (bucket: ObjectStore, prefix: string) =>
  (await readValue<string[]>(bucket, usageKey(prefix, month()), [])).value
    .length;

export async function reserveAnalysis(bucket: ObjectStore, prefix: string) {
  const { plan } = await entitlement(bucket, prefix);
  const period = month();
  const token = period + "/" + crypto.randomUUID();
  await changeValue<string[]>(
    bucket,
    usageKey(prefix, period),
    [],
    (tokens) => {
      if (tokens.length >= limits[plan])
        throw new BillingError(
          429,
          "Votre quota mensuel d’analyses est atteint.",
        );
      return [...tokens, token];
    },
  );
  return token;
}

export async function releaseAnalysis(
  bucket: ObjectStore,
  prefix: string,
  token: string,
) {
  if (!/^\d{4}-\d{2}\/[a-f0-9-]{36}$/.test(token)) return;
  await changeValue<string[]>(
    bucket,
    usageKey(prefix, token.slice(0, 7)),
    [],
    (tokens) =>
      tokens.includes(token)
        ? tokens.filter((value) => value !== token)
        : tokens,
  );
}

/** Vérifie le plafond d’unités du forfait (pipeline async). */
export async function assertUnitQuota(
  bucket: ObjectStore,
  prefix: string,
  unitCount: number,
) {
  const { plan } = await entitlement(bucket, prefix);
  const max = unitLimitForPlan(plan);
  if (unitCount > max)
    throw new BillingError(
      413,
      `Ce corpus représente environ ${unitCount} unités ; votre forfait (${plan}) autorise ${max} unités par analyse.`,
    );
}
