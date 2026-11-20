import { env } from "../storage/index";
import { analyze, ENGINE_VERSION } from "../services/research/engine";
import {
  materialCode,
  materialText,
  questions,
} from "../../../shared/research/project";
import {
  canRequestWritingPlan,
  documentTypeLabel,
  writingStructureFor,
  writingTimeDays,
  writingTimeLabel,
} from "../../../shared/research/corpusOrganization";
import {
  buildProjectContext,
  formatProjectContext,
  materialCollectionModeLabel,
  pseudonymizeProjectContext,
} from "../../../shared/research/projectContext";
import { hydrateMaterialsTexts } from "../services/research/persistMaterialTexts";
import { hydrateMaterialsVision } from "../services/research/pipeline/persistVision";
import { simulateCorpusPlan } from "../../../shared/research/simulateCorpusPlan";
import {
  buildWorkPlan,
  findSubmissionEndDate,
} from "../../../shared/research/workPlan";
import {
  buildWritingSchedule,
  workPlanToWritingSchedule,
} from "../../../shared/research/writingSchedule";
import { buildCorpusPlanDocx } from "../services/research/buildCorpusPlanDocx";
import {
  assertUnitQuota,
  reserveAnalysis,
  releaseAnalysis,
} from "../services/billing/quotas";
import {
  getClaudeSettings,
  isLlmConfigured,
  syncAiFingerprintParts,
} from "../services/llm/claude";
import {
  emptyCoverage,
  publicJobView,
  readJob,
  updateJob,
  writeJob,
  type JobMode,
  type ResearchJob,
} from "../services/research/jobs";
import { enqueueResearchJob } from "../services/research/worker";
import { buildUnits } from "../../../shared/research/units";
import { BillingError } from "../services/billing/storage";
import { deletePseudonymMap } from "../services/research/pipeline/pseudonym";

const CORPUS_SYNC_LIMIT = 120_000;

function researchPipelineEnabled(): boolean {
  const raw = String(
    (env as unknown as Record<string, string>).RESEARCH_PIPELINE ||
      process.env.RESEARCH_PIPELINE ||
      "",
  )
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function resolveJobMode(preferBatch: boolean, unitCount: number): JobMode {
  const { batchThreshold, capabilities } = getClaudeSettings();
  if (
    preferBatch &&
    capabilities.batch &&
    unitCount > batchThreshold
  )
    return "batch";
  return "realtime";
}

type ScheduleOpts = {
  writingTime?: string;
  documentType?: string;
  documentTypeOther?: string;
  startDate?: string;
  endDate?: string;
  weeklyTime?: string;
};

/** Accepte encore une string (= writingTime) pour ne pas casser les appels existants. */
function withWritingSchedule(
  result: any,
  writingTimeOrOpts?: string | ScheduleOpts,
) {
  const opts: ScheduleOpts =
    typeof writingTimeOrOpts === "string"
      ? { writingTime: writingTimeOrOpts }
      : writingTimeOrOpts || {};
  const writingTime = opts.writingTime;
  const hasSchedule = Boolean(result?.schedule?.items?.length);
  const hasWorkPlan = Boolean(result?.workPlan?.phases?.length);
  if (hasSchedule && hasWorkPlan) return result;

  const sections = result?.sections || [];
  const workPlan =
    result?.workPlan?.phases?.length
      ? result.workPlan
      : buildWorkPlan({
          writingTime,
          totalDays: writingTimeDays(writingTime) || undefined,
          durationLabel: writingTimeLabel(writingTime) || undefined,
          documentType: opts.documentType,
          documentTypeOther: opts.documentTypeOther,
          startDate: opts.startDate,
          endDate: opts.endDate,
          weeklyTime: opts.weeklyTime,
          sections,
        });

  const schedule =
    hasSchedule
      ? result.schedule
      : workPlan
        ? workPlanToWritingSchedule(workPlan, writingTimeLabel(writingTime))
        : buildWritingSchedule({
            writingTime,
            writingTimeDays: writingTimeDays(writingTime),
            writingTimeLabel: writingTimeLabel(writingTime),
            sections,
            documentType: opts.documentType,
            documentTypeOther: opts.documentTypeOther,
            startDate: opts.startDate,
            endDate: opts.endDate,
            weeklyTime: opts.weeklyTime,
          });

  if (!schedule && !workPlan) return result;
  return {
    ...result,
    ...(schedule ? { schedule } : {}),
    ...(workPlan ? { workPlan } : {}),
  };
}

function scheduleOptsFromProject(p: any, draft: any): ScheduleOpts {
  return {
    writingTime: draft?.writingTime,
    documentType: draft?.documentType,
    documentTypeOther: draft?.documentTypeOther,
    startDate: draft?.startDate || undefined,
    endDate: findSubmissionEndDate(p?.dates),
  };
}

const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private,no-store" },
  });
export async function POST(req: Request) {
  const uid =
    req.headers.get("x-manuscrit-user") ||
    null;
  const bucket = env.BUCKET,
    config = env as unknown as Record<string, string>;
  if (!uid || !bucket) return reply({ error: "Connexion requise." }, 403);
  if (
    req.headers.get("origin") &&
    req.headers.get("origin") !== new URL(config.APP_BASE_URL || req.url).origin
  )
    return reply({ error: "Origine refusée." }, 403);
  const prefix = "owners/" + encodeURIComponent(uid) + "/";
  let token = "",
    lockKey = "",
    etag = "";
  try {
    const body = (await req.json()) as any;
    const {
      projectId,
      mode,
      consent,
      publicQuery,
      simulate,
      revisionFeedback,
      previousPlan,
    } = body;
    const preferBatch =
      body?.pipelineMode === "batch" ||
      body?.batch === true ||
      body?.modeEconomique === true;
    const wantPseudonymize = Boolean(body?.pseudonymize);
    const pseudonymNames = Array.isArray(body?.pseudonymNames)
      ? body.pseudonymNames
          .map((n: unknown) => String(n || "").trim())
          .filter(Boolean)
          .slice(0, 200)
      : [];
    if (!consent || !["design", "corpus"].includes(mode))
      return reply({ error: "Confirmez les conditions du traitement." }, 400);
    const revision =
      typeof revisionFeedback === "string"
        ? revisionFeedback.replace(/\s+/g, " ").trim().slice(0, 1200)
        : "";
    const previousSections = Array.isArray(previousPlan)
      ? previousPlan
          .slice(0, 12)
          .map((s: any) => ({
            title: String(s?.title || "").trim().slice(0, 220),
            advice: String(s?.advice || "").trim().slice(0, 600),
          }))
          .filter((s: { title: string }) => s.title)
      : [];
    if (revision && revision.length < 12)
      return reply(
        {
          error:
            "Précisez en quelques mots ce que le prochain plan doit mieux prendre en compte (au moins 12 caractères).",
        },
        400,
      );
    const ws = await bucket.get(prefix + "workspace");
    const p = (await ws?.json<any>())?.projects.find(
      (x: any) => x.id === projectId,
    );
    if (!p) return reply({ error: "Enregistrez d’abord le projet." }, 404);
    p.materials = await hydrateMaterialsTexts(
      bucket,
      prefix,
      p.materials || [],
    );
    p.materials = await hydrateMaterialsVision(bucket, prefix, p.materials);
    const draft = p.copilot || {};
    let projectCtx =
      mode === "corpus"
        ? buildProjectContext(p, draft, {
            revisionFeedback: revision,
            previousPlan: previousSections,
          })
        : null;
    if (mode === "corpus" && wantPseudonymize && projectCtx)
      projectCtx = pseudonymizeProjectContext(projectCtx, pseudonymNames);
    const brief =
      mode === "design"
        ? questions
            .filter(([k]) => draft[k]?.trim())
            .map(([k, q]) => q + "\n" + draft[k])
            .join("\n\n")
        : formatProjectContext(projectCtx!, {
            includeRevision: Boolean(revision),
          }) ||
          (draft.brief || "").trim();
    const items =
      mode === "corpus"
        ? p.materials.filter((m: any) => !(draft.excluded || []).includes(m.id))
        : p.materials.filter(
            (m: any) =>
              m.type === "Référence bibliographique" ||
              m.type === "Note de lecture" ||
              m.type === "Notes de lecture bibliographiques",
          );
    const sources = items
      .map((m: any) => ({
        id: m.id,
        type: m.type,
        title: `${materialCode(m)} · ${m.title}`,
        code: materialCode(m),
        text: materialText(m),
        collectionMode: materialCollectionModeLabel(m),
        interviewerMarker: String(m.interviewerMarker || "").trim() || undefined,
      }))
      .filter((s: any) => s.text.trim())
      .sort((a: any, b: any) => a.id.localeCompare(b.id));
    if (
      mode === "corpus" &&
      !canRequestWritingPlan(draft, p.materials, draft.excluded || [], p)
    )
      return reply(
        {
          error:
            "Avant un plan de rédaction : créez un projet (hors exemple), acceptez les conditions, déposez au moins un matériau avec son mode de recueil et du texte exploitable, puis renseignez le type de manuscrit, la discipline, la présentation du sujet et le volume.",
        },
        422,
      );
    if (!brief || (mode === "corpus" && !sources.length))
      return reply(
        {
          error:
            "Renseignez le projet et ajoutez du contenu lisible aux fiches à analyser.",
        },
        422,
      );
    if (mode === "corpus" && sources.length !== items.length)
      return reply(
        {
          error:
            "Certaines fiches ne contiennent aucun texte exploitable. Ajoutez une transcription, une description ou les valeurs du tableau avant de relancer.",
        },
        422,
      );
    const corpusChars = sources.reduce(
      (n: number, s: any) => n + s.text.length,
      brief.length,
    );
    if (corpusChars > CORPUS_SYNC_LIMIT) {
      if (!(mode === "corpus" && researchPipelineEnabled()))
        return reply(
          {
            error:
              "Ce corpus dépasse 120 000 caractères par analyse. Sélectionnez moins de fiches ou fractionnez le matériau.",
          },
          413,
        );

      const jobId = crypto.randomUUID();
      const now = new Date().toISOString();
      let billingToken = "";
      const forceSimulation =
        Boolean(simulate) || !isLlmConfigured(config);

      const materialById = new Map(
        (p.materials || []).map((m: any) => [m.id, m]),
      );
      let unitCount = 0;
      for (const s of sources) {
        const full = {
          id: s.id,
          extracted: s.text,
          ...(materialById.get(s.id) || {}),
        };
        unitCount += buildUnits(full).length;
      }
      const jobMode = resolveJobMode(Boolean(preferBatch), unitCount);
      try {
        await assertUnitQuota(bucket, prefix, unitCount);
      } catch (e) {
        if (e instanceof BillingError)
          return reply({ error: e.message }, e.status);
        throw e;
      }

      if (!forceSimulation)
        billingToken = await reserveAnalysis(bucket, prefix);

      const jobBrief =
        (projectCtx
          ? formatProjectContext(projectCtx)
          : brief) || brief;
      const job: ResearchJob = {
        id: jobId,
        projectId,
        status: "queued",
        step: "queued",
        progress: { done: 0, total: 0 },
        mode: jobMode,
        createdAt: now,
        updatedAt: now,
        materialIds: sources.map((s: { id: string }) => s.id),
        coverage: emptyCoverage(),
        billingToken: billingToken || undefined,
        brief: jobBrief,
        format:
          documentTypeLabel(draft.documentType, draft.documentTypeOther) ||
          p.type,
        writingStructure: writingStructureFor(draft.documentType),
        request: {
          mode,
          consent: true,
          simulate: forceSimulation,
          publicQuery:
            typeof publicQuery === "string"
              ? publicQuery.trim().slice(0, 180)
              : "",
          revisionFeedback: revision,
          previousPlan: previousSections,
          preferBatch: Boolean(preferBatch),
          pseudonymize: wantPseudonymize,
          pseudonymNames,
        },
      };
      const created = await writeJob(bucket, prefix, job);
      if (!created) {
        if (billingToken)
          await releaseAnalysis(bucket, prefix, billingToken);
        return reply(
          { error: "Impossible de créer la tâche d’analyse. Réessayez." },
          503,
        );
      }
      enqueueResearchJob(prefix, jobId);
      return reply({ jobId }, 202);
    }
    const format =
      mode === "corpus"
        ? documentTypeLabel(draft.documentType, draft.documentTypeOther) ||
          p.type
        : p.type;
    const input = {
      mode,
      brief,
      format,
      sources,
      documentType: mode === "corpus" ? draft.documentType : undefined,
      writingStructure:
        mode === "corpus" ? writingStructureFor(draft.documentType) : undefined,
      publicQuery:
        typeof publicQuery === "string" ? publicQuery.trim().slice(0, 180) : "",
      revisionFeedback: mode === "corpus" ? revision : "",
      previousPlan: mode === "corpus" ? previousSections : [],
    };
    const [syncEndpoint, syncModel] = syncAiFingerprintParts(config);
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify([
          ENGINE_VERSION,
          syncModel,
          syncEndpoint,
          input,
        ]),
      ),
    );
    const fingerprint = Array.from(new Uint8Array(bytes), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join("");
    const key = prefix + "research/" + fingerprint;
    const wantSimulation = Boolean(simulate) || !isLlmConfigured(config);
    const scheduleOpts = scheduleOptsFromProject(p, draft);
    if (mode === "corpus" && wantSimulation) {
      const simulated = {
        ...simulateCorpusPlan({
          format,
          brief,
          writingTime: draft.writingTime,
          documentType: draft.documentType,
          documentTypeOther: draft.documentTypeOther,
          startDate: scheduleOpts.startDate,
          endDate: scheduleOpts.endDate,
          sources,
          writingStructure: writingStructureFor(draft.documentType),
          revisionFeedback: revision,
          previousPlan: previousSections,
        }),
        fingerprint: "simulation-" + fingerprint.slice(0, 16),
        version: ENGINE_VERSION,
        date: new Date().toISOString(),
      };
      return reply(withWritingSchedule(simulated, scheduleOpts));
    }
    const cached = await bucket.get(key);
    if (cached)
      return reply(withWritingSchedule(await cached.json(), scheduleOpts));
    if (!isLlmConfigured(config))
      return reply(
        {
          error:
            "Le service IA n’est pas encore configuré. Votre cadrage et vos matériaux sont enregistrés.",
        },
        503,
      );
    lockKey = key + ".lock";
    const previous = await bucket.head(lockKey);
    if (previous && Date.now() - previous.uploaded.getTime() < 15 * 60 * 1000)
      return reply(
        {
          error:
            "Une analyse identique est en cours. Réessayez dans un instant.",
        },
        409,
      );
    const lock = await bucket.put(lockKey, crypto.randomUUID(), {
      onlyIf: previous
        ? { etagMatches: previous.etag }
        : { etagDoesNotMatch: "*" },
    });
    if (!lock) return reply({ error: "Analyse déjà en cours." }, 409);
    etag = lock.etag;
    const completed = await bucket.get(key);
    if (completed)
      return reply(withWritingSchedule(await completed.json(), scheduleOpts));
    token = await reserveAnalysis(bucket, prefix);
    const result = withWritingSchedule(
      {
        ...(await analyze(input, config)),
        fingerprint,
        version: ENGINE_VERSION,
        date: new Date().toISOString(),
        simulated: false,
      },
      scheduleOpts,
    );
    await bucket.put(key, JSON.stringify(result));
    token = "";
    return reply(result);
  } catch (e: any) {
    if (token) await releaseAnalysis(bucket!, prefix, token);
    return reply(
      {
        error: e.message || "Analyse indisponible. Votre corpus est conservé.",
      },
      Number.isInteger(e.status) ? e.status : 502,
    );
  } finally {
    if (etag && (await bucket!.head(lockKey))?.etag === etag)
      await bucket!.delete(lockKey);
  }
}

/** Export Word du plan de rédaction déjà produit (simulé ou IA). */
export async function POST_planDocx(req: Request) {
  const uid =
    req.headers.get("x-manuscrit-user") ||
    null;
  if (!uid) return reply({ error: "Connexion requise." }, 403);
  if (
    req.headers.get("origin") &&
    req.headers.get("origin") !==
      new URL(
        (env as unknown as Record<string, string>).APP_BASE_URL || req.url,
      ).origin
  )
    return reply({ error: "Origine refusée." }, 403);

  try {
    const body = (await req.json()) as {
      kind?: "plan" | "schedule";
      projectTitle?: string;
      documentLabel?: string;
      documentType?: string;
      plan?: {
        simulated?: boolean;
        date?: string;
        model?: string;
        sections?: {
          title?: string;
          advice?: string;
          thesis?: string;
          evidence?: { id?: string; quote?: string }[];
          subsections?: {
            title?: string;
            thesis?: string;
            advice?: string;
            evidence?: { id?: string; quote?: string }[];
          }[];
        }[];
        gaps?: string[];
        themes?: {
          themeId?: string;
          label?: string;
          emergent?: boolean;
          fragile?: boolean;
          materialCount?: number;
        }[];
        schedule?: {
          label?: string;
          totalDays?: number;
          items?: {
            title?: string;
            dayStart?: number;
            dayEnd?: number;
            share?: string;
            advice?: string;
          }[];
        } | null;
        workPlan?: unknown;
      };
      materials?: { id: string; title?: string; type?: string }[];
    };
    const kind = body.kind === "schedule" ? "schedule" : "plan";
    const plan = body.plan;
    if (!plan) return reply({ error: "Aucun document à exporter." }, 400);
    if (kind === "plan" && !plan.sections?.length)
      return reply({ error: "Aucun plan à exporter." }, 400);
    const hasScheduleItems = Boolean(plan.schedule?.items?.length);
    const hasWorkPlan = Boolean(
      plan.workPlan &&
        typeof plan.workPlan === "object" &&
        Array.isArray((plan.workPlan as { phases?: unknown }).phases) &&
        ((plan.workPlan as { phases: unknown[] }).phases || []).length,
    );
    if (kind === "schedule" && !hasScheduleItems && !hasWorkPlan)
      return reply({ error: "Aucun planning à exporter." }, 400);

    const materials = Array.isArray(body.materials) ? body.materials : [];
    const enrichEvidence = (
      list: { id?: string; quote?: string; source?: string }[] = [],
    ) =>
      list.map((ev) => {
        const m = materials.find((x) => x.id === ev.id);
        return {
          ...ev,
          code: m?.type
            ? materialCode({ id: m.id, type: m.type })
            : undefined,
          title: m?.title,
        };
      });
    const sections = (plan.sections || []).map((s) => ({
      ...s,
      evidence: enrichEvidence(s.evidence),
      subsections: (s.subsections || []).map((sub) => ({
        ...sub,
        evidence: enrichEvidence(sub.evidence),
      })),
    }));

    const file = await buildCorpusPlanDocx({
      kind,
      projectTitle: body.projectTitle,
      documentLabel: body.documentLabel,
      documentType: body.documentType,
      simulated: Boolean(plan.simulated),
      date: plan.date,
      model: plan.model,
      sections,
      gaps: kind === "plan" ? plan.gaps : undefined,
      themes: kind === "plan" ? plan.themes : undefined,
      schedule: kind === "schedule" ? plan.schedule : undefined,
      workPlan: kind === "schedule" ? (plan.workPlan as any) : undefined,
    });

    return reply({
      file: {
        filename: file.filename,
        mimeType: file.mimeType,
        base64: file.buffer.toString("base64"),
      },
    });
  } catch (e: any) {
    return reply(
      { error: e.message || "Export Word impossible." },
      Number.isInteger(e.status) ? e.status : 502,
    );
  }
}

function jobAuth(req: Request): { uid: string; prefix: string } | Response {
  const uid = req.headers.get("x-manuscrit-user") || null;
  const bucket = env.BUCKET;
  const config = env as unknown as Record<string, string>;
  if (!uid || !bucket) return reply({ error: "Connexion requise." }, 403);
  if (
    req.headers.get("origin") &&
    req.headers.get("origin") !== new URL(config.APP_BASE_URL || req.url).origin
  )
    return reply({ error: "Origine refusée." }, 403);
  return { uid, prefix: "owners/" + encodeURIComponent(uid) + "/" };
}

function jobIdFromUrl(req: Request, suffix?: string): string | null {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  // .../api/research/jobs/:id[/cancel]
  const jobsAt = parts.indexOf("jobs");
  if (jobsAt < 0 || !parts[jobsAt + 1]) return null;
  if (suffix && parts[jobsAt + 2] !== suffix) return null;
  if (!suffix && parts[jobsAt + 2]) return null;
  return parts[jobsAt + 1];
}

/**
 * GET /api/research/capabilities
 * Capacités UI (mode lot) — pas de secrets ni d’identifiants fournisseur.
 */
export async function GET_capabilities(req: Request) {
  const auth = jobAuth(req);
  if (auth instanceof Response) return auth;
  const settings = getClaudeSettings();
  return reply({
    batch: Boolean(settings.capabilities.batch),
    batchThreshold: settings.batchThreshold,
  });
}

/** GET /api/research/jobs/:id */
export async function GET_job(req: Request) {
  const auth = jobAuth(req);
  if (auth instanceof Response) return auth;
  const jobId = jobIdFromUrl(req);
  if (!jobId) return reply({ error: "Identifiant de tâche manquant." }, 400);
  const current = await readJob(env.BUCKET!, auth.prefix, jobId);
  if (!current) return reply({ error: "Tâche introuvable." }, 404);
  return reply(publicJobView(current.job));
}

/** POST /api/research/jobs/:id/cancel */
export async function POST_cancelJob(req: Request) {
  const auth = jobAuth(req);
  if (auth instanceof Response) return auth;
  const jobId = jobIdFromUrl(req, "cancel");
  if (!jobId) return reply({ error: "Identifiant de tâche manquant." }, 400);
  const bucket = env.BUCKET!;
  const updated = await updateJob(bucket, auth.prefix, jobId, (job) => {
    if (job.status === "done" || job.status === "cancelled") return job;
    if (job.status === "failed") return job;
    return {
      ...job,
      status: "cancelled",
      step: "cancelled",
      error: "Analyse annulée.",
    };
  });
  if (!updated) return reply({ error: "Tâche introuvable." }, 404);
  if (updated.billingToken) {
    await releaseAnalysis(bucket, auth.prefix, updated.billingToken);
    await updateJob(bucket, auth.prefix, jobId, (job) => ({
      ...job,
      billingToken: undefined,
    }));
  }
  await deletePseudonymMap(bucket, auth.prefix, jobId);
  return reply(publicJobView(updated));
}
