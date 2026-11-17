import { env } from "../storage/index";
import { analyze, ENGINE_VERSION } from "../services/research/engine";
import { materialText, questions } from "../../../shared/research/project";
import { reserveAnalysis, releaseAnalysis } from "../services/billing/quotas";

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
    const { projectId, mode, consent, publicQuery } = (await req.json()) as any;
    if (!consent || !["design", "corpus"].includes(mode))
      return reply({ error: "Confirmez les conditions du traitement." }, 400);
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
        : (draft.brief || "").trim();
    const items =
      mode === "corpus"
        ? p.materials.filter((m: any) => !(draft.excluded || []).includes(m.id))
        : p.materials.filter(
            (m: any) =>
              m.type === "Référence bibliographique" ||
              m.type === "Note de lecture",
          );
    const sources = items
      .map((m: any) => ({
        id: m.id,
        type: m.type,
        title: m.title,
        text: materialText(m),
      }))
      .filter((s: any) => s.text.trim())
      .sort((a: any, b: any) => a.id.localeCompare(b.id));
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
    const input = {
      mode,
      brief,
      format: p.type,
      sources,
      publicQuery:
        typeof publicQuery === "string" ? publicQuery.trim().slice(0, 180) : "",
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
    const cached = await bucket.get(key);
    if (cached) return reply(await cached.json());
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
    if (completed) return reply(await completed.json());
    token = await reserveAnalysis(bucket, prefix);
    const result = {
      ...(await analyze(input, config)),
      fingerprint,
      version: ENGINE_VERSION,
      date: new Date().toISOString(),
    };
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
