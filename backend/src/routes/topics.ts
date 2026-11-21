import { env } from "../storage/index";
import { reserveAnalysis, releaseAnalysis } from "../services/billing/quotas";
import { topicsRateLimit } from "../services/topics/rateLimit";
import {
  validateAnswersPayload,
  validateConsents,
} from "../services/topics/validateAnswers";
import { normalizeTopicAnswers } from "../../../shared/research/topicQuestions";
import {
  startTopicsGenerateJob,
  startTopicsRegenJob,
} from "../services/topics/runTopicsJob";
import {
  getTopicsJob,
  jobPublicView,
} from "../services/topics/topicsJobs";
import { generateTopicDocument } from "../services/topics/generateDocument";
import {
  appendRejectedTitle,
  normalizeTicketSnapshot,
  verifyTicket,
} from "../services/topics/generationTicket";
import {
  getCachedReadings,
  setCachedReadings,
  topicFingerprint,
} from "../services/topics/readingsCache";
import { findReadingsForTopic } from "../services/scholarly/findReadings";
import { z } from "zod";
import { NOTICE_VERSION } from "../../../shared/research/notice";
import type {
  GeneratedTopic,
  LiteratureDensity,
  TopicAxis,
  VerifiedReading,
} from "../../../shared/research/topicTypes";
import type { SourcesStatusMap } from "../services/scholarly/sourceTypes";
import type { GenerateEffort } from "../services/topics/generateAxis";

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

/** Simulation only outside production and when explicitly allowed. */
function acceptSimulate(requested: unknown): boolean {
  return (
    Boolean(requested) &&
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_SIMULATION === "true"
  );
}

async function resolveReadingsForTopic(
  topic: GeneratedTopic,
  answers: Record<string, unknown>,
): Promise<{
  readings: VerifiedReading[];
  rejectedCount: number;
  cached: boolean;
  sources_status: SourcesStatusMap;
  literature_density: LiteratureDensity;
}> {
  const fp = topicFingerprint(topic);
  const fromCache = await getCachedReadings(fp);
  if (fromCache) {
    return {
      readings: fromCache.readings || [],
      rejectedCount: 0,
      cached: true,
      sources_status: fromCache.sources_status || {
        openalex: "ok",
        hal: "ok",
      },
      literature_density:
        fromCache.literature_density ||
        topic.literature_density ||
        "normal",
    };
  }
  const {
    readings,
    rejectedCount,
    cacheable,
    sources_status,
    literature_density,
  } = await findReadingsForTopic(topic, answers);
  if (cacheable) {
    setCachedReadings(fp, readings, { sources_status, literature_density });
  }
  return {
    readings,
    rejectedCount,
    cached: false,
    sources_status,
    literature_density,
  };
}

function acceptEffort(raw: unknown): GenerateEffort | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return undefined;
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
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string; status?: number };
    if (err?.name === "ZodError")
      return reply({ error: "Preuve de consentement invalide." }, 400);
    return reply(
      { error: err.message || "Brouillon refusé." },
      Number.isInteger(err.status) ? (err.status as number) : 400,
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
    const consentMeta = {
      ageOver15: consents.ageOver15,
      noticeAccepted: consents.noticeAccepted,
      retainProfile: consents.retainProfile,
      serviceImprovement: consents.serviceImprovement,
      noticeVersion: NOTICE_VERSION,
    };

    const simulate = acceptSimulate(body.simulate);
    const effort = acceptEffort(body.effort);
    if (!simulate) token = await reserveAnalysis(bucket, prefix);
    const reservedToken = token;
    token = "";
    const job = startTopicsGenerateJob({
      uid,
      answers,
      env: config,
      simulate,
      effort,
      onQuotaRelease: () => {
        if (reservedToken)
          void releaseAnalysis(bucket, prefix, reservedToken);
      },
    });

    console.info(
      JSON.stringify({
        event: "topics.generate",
        uidPseudo: uid.slice(0, 8),
        status: "started",
        at: new Date().toISOString(),
        job_id: job.id.slice(0, 8),
        effort: effort || "low",
        simulated: simulate,
      }),
    );

    return reply({
      job_id: job.id,
      status: "running",
      consents: consentMeta,
      noticeVersion: NOTICE_VERSION,
      persistence: "none",
    });
  } catch (e: unknown) {
    if (token) await releaseAnalysis(bucket, prefix, token);
    const err = e as { name?: string; message?: string; status?: number };
    if (err?.name === "ZodError")
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
        code: Number.isInteger(err.status) ? err.status : 502,
      }),
    );
    return reply(
      { error: err.message || "Génération indisponible." },
      Number.isInteger(err.status) ? (err.status as number) : 502,
    );
  }
}

export async function GET_job(req: Request) {
  const uid = uidOf(req);
  if (!uid) return reply({ error: "Connexion requise." }, 403);
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const jobId = parts[parts.length - 1] || "";
  if (!jobId || jobId.length < 8)
    return reply({ error: "Identifiant de job manquant." }, 400);
  const job = getTopicsJob(jobId, uid);
  if (!job) return reply({ error: "Job introuvable ou expiré." }, 404);
  const view = jobPublicView(job);
  return reply({
    ...view,
    noticeVersion: NOTICE_VERSION,
  });
}

const regenSchema = z.object({
  ticket: z.string().min(10),
  axis: z.enum(["mastery", "ambition", "discovery"]),
  reason: z.enum(["too_far", "too_ambitious", "too_banal", "already_done"]),
  answers: z.record(z.string(), z.unknown()),
  consents: z.unknown(),
  simulate: z.boolean().optional(),
});

const readingsSchema = z.object({
  ticket: z.string().min(10),
  axis: z.enum(["mastery", "ambition", "discovery"]),
  answers: z.record(z.string(), z.unknown()),
  consents: z.unknown().optional(),
});

/** Le client peut envoyer un topic, mais seul l'axe est lu — le contenu vient du ticket. */
const documentSchema = z.object({
  kind: z.enum(["research_project", "work_plan"]),
  ticket: z.string().min(10),
  axis: z.enum(["mastery", "ambition", "discovery"]).optional(),
  topic: z
    .object({
      axis: z.enum(["mastery", "ambition", "discovery"]),
    })
    .passthrough()
    .optional(),
  answers: z.record(z.string(), z.unknown()),
  consents: z.unknown(),
  simulate: z.boolean().optional(),
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
    const snapshot = normalizeTicketSnapshot(current.topics);
    const previousTopics = snapshot?.topics;
    if (!previousTopics || previousTopics.length !== 3)
      return reply({ error: "Sujets précédents introuvables." }, 400);
    const previousTitle = previousTopics.find((t) => t.axis === body.axis)
      ?.title;
    const rejectedTitles = appendRejectedTitle(
      snapshot?.rejectedTitles || [],
      previousTitle,
    );

    const job = startTopicsRegenJob({
      uid,
      answers,
      env: config,
      axis: body.axis,
      reason: body.reason,
      previousTopics,
      rejectedTitles,
      previousTitle,
      profile_analysis: snapshot?.profile_analysis,
      ticket: body.ticket,
      simulate: acceptSimulate(body.simulate),
    });

    console.info(
      JSON.stringify({
        event: "topics.regenerate",
        uidPseudo: uid.slice(0, 8),
        status: "started",
        at: new Date().toISOString(),
        job_id: job.id.slice(0, 8),
        axis: body.axis,
      }),
    );

    return reply({
      job_id: job.id,
      status: "running",
      axis: body.axis,
      noticeVersion: NOTICE_VERSION,
      persistence: "none",
    });
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string; status?: number };
    if (err?.name === "ZodError")
      return reply({ error: "Demande de régénération invalide." }, 400);
    console.info(
      JSON.stringify({
        event: "topics.regenerate",
        uidPseudo: uid.slice(0, 8),
        status: "error",
        at: new Date().toISOString(),
        code: Number.isInteger(err.status) ? err.status : 502,
      }),
    );
    return reply(
      { error: err.message || "Régénération indisponible." },
      Number.isInteger(err.status) ? (err.status as number) : 502,
    );
  }
}

/** Deferred verified readings for one axis (topic from ticket only). */
export async function POST_readings(req: Request) {
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
    const body = readingsSchema.parse(await req.json());
    if (body.consents !== undefined) validateConsents(body.consents);
    const answers = validateAnswersPayload(body.answers);
    const current = verifyTicket(body.ticket, uid, config);
    const snapshot = normalizeTicketSnapshot(current.topics);
    const topic = snapshot?.topics?.find((t) => t.axis === body.axis);
    if (!topic)
      return reply({ error: "Sujet introuvable pour cet axe." }, 404);

    const resolved = await resolveReadingsForTopic(topic, answers);

    console.info(
      JSON.stringify({
        event: "topics.readings",
        uidPseudo: uid.slice(0, 8),
        status: "ok",
        at: new Date().toISOString(),
        axis: body.axis as TopicAxis,
        cached: resolved.cached,
        count: resolved.readings.length,
        rejected: resolved.rejectedCount,
      }),
    );

    return reply({
      axis: body.axis,
      readings: resolved.readings,
      rejectedCount: resolved.rejectedCount,
      sources_status: resolved.sources_status,
      literature_density: resolved.literature_density,
      noticeVersion: NOTICE_VERSION,
    });
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string; status?: number };
    if (err?.name === "ZodError")
      return reply({ error: "Demande de lectures invalide." }, 400);
    console.info(
      JSON.stringify({
        event: "topics.readings",
        uidPseudo: uid.slice(0, 8),
        status: "error",
        at: new Date().toISOString(),
        code: Number.isInteger(err.status) ? err.status : 502,
      }),
    );
    return reply(
      { error: err.message || "Lectures indisponibles." },
      Number.isInteger(err.status) ? (err.status as number) : 502,
    );
  }
}

export async function POST_document(req: Request) {
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
    let body: z.infer<typeof documentSchema>;
    try {
      body = documentSchema.parse(await req.json());
      validateConsents(body.consents);
    } catch (e: unknown) {
      const err = e as { name?: string };
      if (err?.name === "ZodError")
        return reply({ error: "Demande de document invalide." }, 400);
      throw e;
    }
    const answers = validateAnswersPayload(body.answers);
    const current = verifyTicket(body.ticket, uid, config);
    const snapshot = normalizeTicketSnapshot(current.topics);
    const axis =
      body.axis ||
      (body.topic && typeof body.topic.axis === "string"
        ? body.topic.axis
        : undefined);
    if (!axis)
      return reply({ error: "Axe du sujet manquant." }, 400);
    const ticketTopic = snapshot?.topics?.find((t) => t.axis === axis);
    if (!ticketTopic)
      return reply({ error: "Sujet introuvable pour ce jeton." }, 404);

    // Sécurité : ignorer tout contenu topic client — uniquement le ticket.
    const resolved = await resolveReadingsForTopic(ticketTopic, answers);
    const topic: GeneratedTopic = {
      ...ticketTopic,
      literature_density: resolved.literature_density,
      readings: resolved.readings,
    };

    const result = await generateTopicDocument({
      answers,
      topic,
      kind: body.kind,
      env: config,
      simulate: acceptSimulate(body.simulate),
      profile_analysis: snapshot?.profile_analysis,
    });

    console.info(
      JSON.stringify({
        event: "topics.document",
        uidPseudo: uid.slice(0, 8),
        status: "ok",
        at: new Date().toISOString(),
        kind: body.kind,
        model: result.model,
        simulated: result.simulated,
        readings_count: resolved.readings.length,
        cited_count: result.bibliography?.cited.length ?? 0,
      }),
    );

    return reply({
      document: result.document,
      file: result.file,
      model: result.model,
      simulated: result.simulated,
      aiGenerated: !result.simulated,
      bibliography: result.bibliography,
      noticeVersion: NOTICE_VERSION,
    });
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string; status?: number; issues?: unknown[] };
    if (err?.name === "ZodError") {
      console.info(
        JSON.stringify({
          event: "topics.document",
          status: "zod_error",
          issues: Array.isArray(err.issues)
            ? err.issues.slice(0, 5).map((i) => {
                const issue = i as { path?: unknown; code?: string; message?: string };
                return {
                  path: Array.isArray(issue.path) ? issue.path.join(".") : "",
                  code: issue.code || "",
                  message: String(issue.message || "").slice(0, 120),
                };
              })
            : [],
        }),
      );
      return reply(
        { error: "Document généré invalide. Réessayez." },
        502,
      );
    }
    console.info(
      JSON.stringify({
        event: "topics.document",
        uidPseudo: uid.slice(0, 8),
        status: "error",
        at: new Date().toISOString(),
        code: Number.isInteger(err.status) ? err.status : 502,
      }),
    );
    return reply(
      { error: err.message || "Document indisponible." },
      Number.isInteger(err.status) ? (err.status as number) : 502,
    );
  }
}

/**
 * Regénère un Word d’archive (projet / plan) à partir du sujet déjà stocké
 * dans le workspace — sans jeton de session (celui-ci a souvent expiré).
 */
export async function POST_archiveDocument(req: Request) {
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

  const schema = z.object({
    projectId: z.string().min(1).max(120),
    archiveId: z.string().min(1).max(120),
    kind: z.enum(["research_project", "work_plan"]),
  });

  try {
    let body: z.infer<typeof schema>;
    try {
      body = schema.parse(await req.json());
    } catch {
      return reply({ error: "Demande de document invalide." }, 400);
    }

    const prefix = "owners/" + encodeURIComponent(uid) + "/";
    const ws = await env.BUCKET.get(prefix + "workspace");
    if (!ws) return reply({ error: "Espace de travail introuvable." }, 404);
    const data = (await ws.json()) as { projects?: any[] };
    const project = (data.projects || []).find((p) => p?.id === body.projectId);
    if (!project) return reply({ error: "Projet introuvable." }, 404);

    const archive = Array.isArray(project.copilot?.topicArchive)
      ? project.copilot.topicArchive
      : [];
    const entry = archive.find((e: any) => e?.id === body.archiveId);
    if (!entry) return reply({ error: "Sollicitation introuvable." }, 404);
    const topic = entry.chosenTopic as GeneratedTopic | null | undefined;
    if (!topic?.axis || !topic?.title)
      return reply({ error: "Aucun sujet choisi pour cette sollicitation." }, 404);

    // Profil déjà validé à la génération — pas de revalidation bloc 1 stricte.
    const rawAnswers =
      entry.answers && typeof entry.answers === "object"
        ? (entry.answers as Record<string, unknown>)
        : ((project.copilot?.topicAnswers as Record<string, unknown>) || {});
    const answers = normalizeTopicAnswers(rawAnswers);

    const resolved = await resolveReadingsForTopic(topic, answers);
    const enriched: GeneratedTopic = {
      ...topic,
      literature_density: resolved.literature_density,
      readings: resolved.readings.length ? resolved.readings : topic.readings,
    };

    const result = await generateTopicDocument({
      answers,
      topic: enriched,
      kind: body.kind,
      env: config,
      // Même mode que la génération d’origine (simulation déjà produite = resimulation OK).
      simulate: Boolean(entry.simulated),
    });

    console.info(
      JSON.stringify({
        event: "topics.archive_document",
        uidPseudo: uid.slice(0, 8),
        status: "ok",
        at: new Date().toISOString(),
        kind: body.kind,
        model: result.model,
        simulated: result.simulated,
      }),
    );

    return reply({
      file: result.file,
      model: result.model,
      simulated: result.simulated,
      noticeVersion: NOTICE_VERSION,
    });
  } catch (e: unknown) {
    const err = e as { message?: string; status?: number };
    console.info(
      JSON.stringify({
        event: "topics.archive_document",
        uidPseudo: uid.slice(0, 8),
        status: "error",
        at: new Date().toISOString(),
        code: Number.isInteger(err.status) ? err.status : 502,
      }),
    );
    return reply(
      { error: err.message || "Document indisponible." },
      Number.isInteger(err.status) ? (err.status as number) : 502,
    );
  }
}
