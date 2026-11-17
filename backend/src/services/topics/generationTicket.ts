import { createHmac, timingSafeEqual } from "node:crypto";
import type { TopicAxis } from "../../../../shared/research/topicTypes";

export type GenerationTicketPayload = {
  uid: string;
  iat: number;
  rem: number;
  /** Snapshot of topics after last successful call (for single-axis regen merge). */
  topics?: unknown;
};

const TTL_MS = 2 * 60 * 60 * 1000;
const REGENS_INCLUDED = 3;

function secret(env: Record<string, string>) {
  return (
    env.TOPICS_TICKET_SECRET ||
    env.COOKIE_SECRET ||
    env.AI_API_KEY ||
    "dev-topics-ticket"
  );
}

function sign(body: string, env: Record<string, string>) {
  return createHmac("sha256", secret(env)).update(body).digest("base64url");
}

export function issueTicket(
  uid: string,
  env: Record<string, string>,
  topics?: unknown,
  rem = REGENS_INCLUDED,
): string {
  const payload: GenerationTicketPayload = {
    uid,
    iat: Date.now(),
    rem,
    topics,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return body + "." + sign(body, env);
}

export function verifyTicket(
  token: string,
  uid: string,
  env: Record<string, string>,
): GenerationTicketPayload {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw Object.assign(new Error("Jeton invalide."), { status: 400 });
  const expected = sign(body, env);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw Object.assign(new Error("Jeton invalide."), { status: 400 });
  let payload: GenerationTicketPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw Object.assign(new Error("Jeton invalide."), { status: 400 });
  }
  if (payload.uid !== uid)
    throw Object.assign(new Error("Jeton non autorisé."), { status: 403 });
  if (Date.now() - payload.iat > TTL_MS)
    throw Object.assign(new Error("Jeton expiré. Relancez une génération."), {
      status: 400,
    });
  return payload;
}

export function consumeRegen(
  token: string,
  uid: string,
  env: Record<string, string>,
  nextTopics: unknown,
): { payload: GenerationTicketPayload; nextToken: string } {
  const payload = verifyTicket(token, uid, env);
  if (payload.rem <= 0)
    throw Object.assign(
      new Error(
        "Les trois régénérations incluses sont épuisées. Lancez une nouvelle génération (compte pour une analyse).",
      ),
      { status: 429 },
    );
  const nextToken = issueTicket(uid, env, nextTopics, payload.rem - 1);
  return { payload: { ...payload, rem: payload.rem - 1 }, nextToken };
}

export type { TopicAxis };
