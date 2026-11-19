import { env } from "../storage/index";
import { analyze, ENGINE_VERSION } from "../services/research/engine";
import {
  materialCode,
  materialText,
  questions,
} from "../../../shared/research/project";
import {
  buildCorpusBrief,
  canRequestWritingPlan,
  documentTypeLabel,
  writingStructureFor,
  writingTimeDays,
  writingTimeLabel,
} from "../../../shared/research/corpusOrganization";
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
import { reserveAnalysis, releaseAnalysis } from "../services/billing/quotas";

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
    const {
      projectId,
      mode,
      consent,
      publicQuery,
      simulate,
      revisionFeedback,
      previousPlan,
    } = (await req.json()) as any;
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
    const draft = p.copilot || {};
    const brief =
      mode === "design"
        ? questions
            .filter(([k]) => draft[k]?.trim())
            .map(([k, q]) => q + "\n" + draft[k])
            .join("\n\n")
        : buildCorpusBrief(draft, p.materials || []) ||
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
    if (
      sources.reduce((n: number, s: any) => n + s.text.length, brief.length) >
      120000
    )
      return reply(
        {
          error:
            "Ce corpus dépasse 120 000 caractères par analyse. Sélectionnez moins de fiches ou fractionnez le matériau.",
        },
        413,
      );
    const format =
      mode === "corpus"
        ? documentTypeLabel(draft.documentType, draft.documentTypeOther) ||
          p.type
        : p.type;
    const input = {
      mode,
      brief:
        mode === "corpus" && revision
          ? `${brief}\n\nDemande de révision du plan précédent :\n${revision}`
          : brief,
      format,
      sources,
      writingStructure:
        mode === "corpus" ? writingStructureFor(draft.documentType) : undefined,
      publicQuery:
        typeof publicQuery === "string" ? publicQuery.trim().slice(0, 180) : "",
      revisionFeedback: mode === "corpus" ? revision : "",
      previousPlan: mode === "corpus" ? previousSections : [],
    };
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify([
          ENGINE_VERSION,
          config.AI_MODEL,
          config.AI_BASE_URL,
          input,
        ]),
      ),
    );
    const fingerprint = Array.from(new Uint8Array(bytes), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join("");
    const key = prefix + "research/" + fingerprint;
    const wantSimulation =
      Boolean(simulate) ||
      !config.AI_MODEL ||
      !config.AI_BASE_URL ||
      !config.AI_API_KEY;
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
    if (!config.AI_MODEL || !config.AI_BASE_URL || !config.AI_API_KEY)
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
      plan?: {
        simulated?: boolean;
        date?: string;
        model?: string;
        sections?: {
          title?: string;
          advice?: string;
          evidence?: { id?: string; quote?: string }[];
        }[];
        gaps?: string[];
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
    const sections = (plan.sections || []).map((s) => ({
      ...s,
      evidence: (s.evidence || []).map((ev) => {
        const m = materials.find((x) => x.id === ev.id);
        return {
          ...ev,
          code: m?.type
            ? materialCode({ id: m.id, type: m.type })
            : undefined,
          title: m?.title,
        };
      }),
    }));

    const file = await buildCorpusPlanDocx({
      kind,
      projectTitle: body.projectTitle,
      documentLabel: body.documentLabel,
      simulated: Boolean(plan.simulated),
      date: plan.date,
      model: plan.model,
      sections,
      gaps: kind === "plan" ? plan.gaps : undefined,
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
