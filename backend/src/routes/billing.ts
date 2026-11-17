import { env } from "../storage/index";
import { BillingError, currentUsage, limits } from "../services/billing/quotas";
import {
  entitlement,
  isConfigured,
  paymentUrl,
  priceLabels,
} from "../services/billing/stripe";


function owner(req: Request) {
  const user =
    req.headers.get("x-manuscrit-user") ||
    null;
  if (!user || !env.BUCKET)
    throw new BillingError(403, "Connectez-vous à votre espace.");
  return {
    bucket: env.BUCKET,
    prefix: "owners/" + encodeURIComponent(user) + "/",
  };
}
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const failure = (e: unknown) =>
  e instanceof BillingError
    ? json({ error: e.message }, e.status)
    : json({ error: "Le service de facturation est indisponible." }, 503);

export async function GET(req: Request) {
  try {
    const { bucket, prefix } = owner(req);
    const [{ plan, customer }, used, prices] = await Promise.all([
      entitlement(bucket, prefix),
      currentUsage(bucket, prefix),
      priceLabels(),
    ]);
    return json({
      plan,
      customer: Boolean(customer),
      configured: isConfigured(),
      used,
      limit: limits[plan],
      prices,
    });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    const { bucket, prefix } = owner(req);
    const config = env as unknown as Record<string, string>;
    const origin = new URL(config.APP_BASE_URL || req.url).origin;
    if (req.headers.get("Origin") !== origin)
      throw new BillingError(403, "Origine de la demande non autorisée.");
    const { plan } = (await req.json()) as { plan?: string };
    if (plan !== "plus" && plan !== "pro" && plan !== "portal")
      throw new BillingError(400, "Formule inconnue.");
    const url = await paymentUrl(bucket, prefix, plan, origin);
    return json({ url });
  } catch (e) {
    return failure(e);
  }
}
