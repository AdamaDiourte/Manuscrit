import { env } from "../storage/index";
import { reserveAnalysis, releaseAnalysis } from "../services/billing/quotas";
import { topicsRateLimit } from "../services/topics/rateLimit";
import {
  validateAnswersPayload,
  validateConsents,
} from "../services/topics/validateAnswers";
import { generateTopics } from "../services/topics/generate";
import {
  consumeRegen,
  issueTicket,
  verifyTicket,
} from "../services/topics/generationTicket";
import { z } from "zod";
import { NOTICE_VERSION } from "../../../shared/research/notice";

const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private,no-store" },
  });

function uidOf(req: Request) {
  return req.headers.get("x-manuscrit-user");
}

function configOf() {
  return env as unknown as Record<string, string>;
}

/**
 * Étape A: no server-side profile/results persistence.
 * Draft storage arrives in étape D (with AES-GCM). Until then:
 * - without retain consent → 403
 * - with retain consent → 501
 */
export async function POST_draft(req: Request) {
  const uid = uidOf(req);
  if (!uid) return reply({ error: "Connexion requise." }, 403);
  let body: { consents?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Demande invalide." }, 400);
  }
  try {
    const consents = validateConsents(body.consents);
    if (!consents.retainProfile.value)
      return reply(
        {
          error:
            "La sauvegarde serveur du profil exige le consentement « Conserver mon profil ».",
        },
        403,
      );
    return reply(
      {
        error:
          "La conservation du profil sur le serveur sera disponible prochainement (chiffrement et purge).",
        noticeVersion: NOTICE_VERSION,
      },
      501,
    );
  } catch (e: any) {
    if (e?.name === "ZodError")
      return reply({ error: "Preuve de consentement invalide." }, 400);
    return reply(
      { error: e.message || "Brouillon refusé." },
      Number.isInteger(e.status) ? e.status : 400,
    );
  }
}

export async function POST_generate(req: Request) {
  const uid = uidOf(req);
  const bucket = env.BUCKET;
  const config = configOf();
  if (!uid || !bucket) return reply({ error: "Connexion requise." }, 403);

  const limited = topicsRateLimit(uid);
  if (!limited.ok)
    return reply(
      {
        error: "Trop de demandes. Réessayez dans quelques minutes.",
        retryAfterSec: limited.retryAfterSec,
      },
      429,
    );

  let token = "";
  const prefix = "owners/" + encodeURIComponent(uid) + "/";
  try {
    const body = await req.json();
    const consents = validateConsents(body.consents);
    const answers = validateAnswersPayload(body.answers);
    // Consent proof is acknowledged in the response only (no DB write in étape A).
    const consentMeta = {
      ageOver15: consents.ageOver15,
      noticeAccepted: consents.noticeAccepted,
      retainProfile: consents.retainProfile,
      serviceImprovement: consents.serviceImprovement,
      noticeVersion: NOTICE_VERSION,
    };

    token = await reserveAnalysis(bucket, prefix);
    const result = await generateTopics(answers, config);
    const ticket = issueTicket(uid, config, result.topics, 3);
    token = "";
    // Technical metadata only — never log answers or prompts.
    console.info(
      JSON.stringify({
        event: "topics.generate",
        uidPseudo: uid.slice(0, 8),
        status: "ok",
        at: new Date().toISOString(),
        tokens: result.tokens ?? null,
        model: result.model,
      }),
    );
    return reply({
      topics: result.topics,
      model: result.model,
      ticket,
      regenerationsRemaining: 3,
      aiGenerated: true,
      consents: consentMeta,
      noticeVersion: NOTICE_VERSION,
      persistence: "none",
    });
  } catch (e: any) {
    if (token) await releaseAnalysis(bucket, prefix, token);
    if (e?.name === "ZodError")
      return reply(
        { error: "La réponse de l’IA ou les consentements sont invalides." },
        502,
      );
    console.info(
      JSON.stringify({
        event: "topics.generate",
        uidPseudo: uid.slice(0, 8),
        status: "error",
        at: new Date().toISOString(),
        code: Number.isInteger(e.status) ? e.status : 502,
      }),
    );
    return reply(
      { error: e.message || "Génération indisponible." },
      Number.isInteger(e.status) ? e.status : 502,
    );
  }
}

const regenSchema = z.object({
  ticket: z.string().min(10),
  axis: z.enum(["mastery", "ambition", "discovery"]),
  reason: z.enum(["too_far", "too_ambitious", "too_banal", "already_done"]),
  answers: z.record(z.string(), z.unknown()),
  consents: z.unknown(),
});

export async function POST_regenerate(req: Request) {
  const uid = uidOf(req);
  const config = configOf();
  if (!uid) return reply({ error: "Connexion requise." }, 403);

  const limited = topicsRateLimit(uid);
  if (!limited.ok)
    return reply(
      {
        error: "Trop de demandes. Réessayez dans quelques minutes.",
        retryAfterSec: limited.retryAfterSec,
      },
      429,
    );

  try {
    const body = regenSchema.parse(await req.json());
    validateConsents(body.consents);
    const answers = validateAnswersPayload(body.answers);
    const current = verifyTicket(body.ticket, uid, config);
    if (current.rem <= 0)
      return reply(
        {
          error:
            "Les trois régénérations incluses sont épuisées. Lancez une nouvelle génération (compte pour une analyse).",
        },
        429,
      );
    const previousTopics = Array.isArray(current.topics)
      ? (current.topics as any[])
      : undefined;
    const previousTitle = previousTopics?.find((t) => t.axis === body.axis)
      ?.title as string | undefined;

    const result = await generateTopics(answers, config, {
      axis: body.axis,
      reason: body.reason,
      previousTitle,
      previousTopics: previousTopics as any,
    });
    const { nextToken, payload } = consumeRegen(
      body.ticket,
      uid,
      config,
      result.topics,
    );

    console.info(
      JSON.stringify({
        event: "topics.regenerate",
        uidPseudo: uid.slice(0, 8),
        status: "ok",
        at: new Date().toISOString(),
        axis: body.axis,
        rem: payload.rem,
        tokens: result.tokens ?? null,
      }),
    );

    return reply({
      topics: result.topics,
      model: result.model,
      ticket: nextToken,
      regenerationsRemaining: payload.rem,
      aiGenerated: true,
      noticeVersion: NOTICE_VERSION,
      persistence: "none",
    });
  } catch (e: any) {
    if (e?.name === "ZodError")
      return reply({ error: "Demande de régénération invalide." }, 400);
    console.info(
      JSON.stringify({
        event: "topics.regenerate",
        uidPseudo: uid.slice(0, 8),
        status: "error",
        at: new Date().toISOString(),
        code: Number.isInteger(e.status) ? e.status : 502,
      }),
    );
    return reply(
      { error: e.message || "Régénération indisponible." },
      Number.isInteger(e.status) ? e.status : 502,
    );
  }
}
