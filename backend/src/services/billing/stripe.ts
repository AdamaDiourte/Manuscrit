import type {ObjectStore} from "../../storage/types";
import { env } from "../../storage/index";
import { BillingError, changeValue, readValue } from "./storage";

export type PaidPlan = "plus" | "pro";
export type Plan = "free" | PaidPlan;
const config = env as unknown as Record<string, string>;
const priceId = (plan: PaidPlan) =>
  config[plan === "plus" ? "STRIPE_PRICE_PLUS" : "STRIPE_PRICE_PRO"];
export const isConfigured = () =>
  Boolean(
    config.STRIPE_SECRET_KEY &&
      priceId("plus") &&
      priceId("pro") &&
      priceId("plus") !== priceId("pro"),
  );
const accountKey = (prefix: string) =>
  prefix +
  "billing/" +
  (config.STRIPE_SECRET_KEY?.includes("_test_") ? "test" : "live") +
  "/account";
type Account = {
  customer?: string;
  checkout?: { token: string; plan: PaidPlan; validUntil: number };
};
const readAccount = (bucket: ObjectStore, prefix: string) =>
  readValue<Account>(bucket, accountKey(prefix), {});

async function stripe<T>(
  resource: string,
  body?: Record<string, string>,
  key?: string,
): Promise<T> {
  if (!isConfigured())
    throw new BillingError(503, "Les paiements ne sont pas encore activés.");
  let response: Response;
  try {
    response = await fetch("https://api.stripe.com/v1/" + resource, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + config.STRIPE_SECRET_KEY,
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body ? new URLSearchParams(body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new BillingError(
      503,
      "Stripe est temporairement inaccessible. Réessayez dans un instant.",
    );
  }
  if (!response.ok)
    throw new BillingError(
      503,
      "Stripe n’a pas pu traiter cette demande. Vérifiez la configuration du paiement ou réessayez.",
    );
  return response.json() as Promise<T>;
}

interface Subscription {
  items: { data: { price: { id: string } }[] };
}
export async function entitlement(
  bucket: ObjectStore,
  prefix: string,
): Promise<{ plan: Plan; customer?: string }> {
  const {
    value: { customer },
  } = await readAccount(bucket, prefix);
  if (!customer) return { plan: "free" };
  // Confirm rights directly with Stripe, including renewals and cancellations while the private site is closed.
  const lists = await Promise.all(
    ["active", "trialing"].map((status) =>
      stripe<{ data: Subscription[] }>(
        "subscriptions?" +
          new URLSearchParams({ customer, status, limit: "100" }),
      ),
    ),
  );
  const ids = lists.flatMap((list) =>
    list.data.flatMap((subscription) =>
      subscription.items.data.map((item) => item.price.id),
    ),
  );
  return {
    customer,
    plan: ids.includes(priceId("pro"))
      ? "pro"
      : ids.includes(priceId("plus"))
        ? "plus"
        : "free",
  };
}

let cachedPrices:
  | { key: string; until: number; values: Record<PaidPlan, string | null> }
  | undefined;
export async function priceLabels(): Promise<Record<PaidPlan, string | null>> {
  if (!isConfigured()) return { plus: null, pro: null };
  const key = [priceId("plus"), priceId("pro")].join("|");
  if (cachedPrices?.key === key && cachedPrices.until > Date.now())
    return cachedPrices.values;
  const values: Record<PaidPlan, string | null> = { plus: null, pro: null };
  await Promise.all(
    (["plus", "pro"] as const).map(async (plan) => {
      const price = await stripe<{
        active: boolean;
        unit_amount: number | null;
        currency: string;
        recurring?: { interval: string; interval_count: number };
      }>("prices/" + encodeURIComponent(priceId(plan)));
      if (
        !price.active ||
        price.unit_amount === null ||
        price.recurring?.interval !== "month" ||
        price.recurring.interval_count !== 1 ||
        price.currency !== "eur"
      )
        throw new BillingError(
          503,
          "Les formules doivent utiliser deux tarifs mensuels actifs en euros.",
        );
      values[plan] = new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
      }).format(price.unit_amount / 100);
    }),
  );
  cachedPrices = { key, until: Date.now() + 300000, values };
  return values;
}

export async function paymentUrl(
  bucket: ObjectStore,
  prefix: string,
  plan: PaidPlan | "portal",
  origin: string,
) {
  let { customer, plan: current } = await entitlement(bucket, prefix);
  if (plan === "portal" || current !== "free") {
    if (!customer)
      throw new BillingError(400, "Aucun compte de facturation associé.");
    return (
      await stripe<{ url: string }>("billing_portal/sessions", {
        customer,
        return_url: origin + "/?billing=return",
      })
    ).url;
  }
  await priceLabels();
  if (!customer) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(origin + "/" + prefix),
    );
    const key = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const created = await stripe<{ id: string }>(
      "customers",
      { "metadata[workspace_hash]": key },
      "manuscrit-customer-" + key,
    );
    const account = await changeValue<Account>(
      bucket,
      accountKey(prefix),
      {},
      (a) => (a.customer ? a : { ...a, customer: created.id }),
    );
    customer = account.customer!;
  }
  // One open Checkout per account. Reuse its idempotency key even across network retries.
  const now = Date.now();
  const account = await changeValue<Account>(
    bucket,
    accountKey(prefix),
    {},
    (a) => {
      if (a.checkout && a.checkout.validUntil > now) {
        if (a.checkout.plan !== plan)
          throw new BillingError(
            409,
            "Une session de paiement est déjà ouverte pour l’autre formule. Terminez-la ou attendez son expiration (31 minutes).",
          );
        return a;
      }
      return {
        ...a,
        checkout: {
          token: crypto.randomUUID(),
          plan,
          validUntil: (Math.floor(now / 1000) + 1860) * 1000,
        },
      };
    },
  );
  const checkout = account.checkout!;
  const result = await stripe<{ url: string }>(
    "checkout/sessions",
    {
      mode: "subscription",
      customer,
      "line_items[0][price]": priceId(plan),
      "line_items[0][quantity]": "1",
      success_url: origin + "/?billing=return",
      cancel_url: origin + "/?billing=return",
      expires_at: String(checkout.validUntil / 1000),
    },
    "manuscrit-checkout-" + checkout.token,
  );
  return result.url;
}
