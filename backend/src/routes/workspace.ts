import { env } from "../storage/index";
import { limitedBody, BodyLimit } from "../http/boundedBody";
import { changeValue, BillingError } from "../services/billing/storage";
import { purgeRemovedProjects } from "../services/research/purgeProject";
import { scheduleOrphanTextCleanup } from "../services/research/cleanupOrphanTexts";
import {
  externalizeProjectMaterialTexts,
  fingerprintMaterialTexts,
  isTextContentHash,
  loadMaterialTexts,
  saveMaterialTexts,
} from "../services/research/persistMaterialTexts";
import { materialText } from "../../../shared/research/project";
import { resolveMaxTextChars } from "../../../shared/research/textLimits";

function storage(req: Request) {
  const user =
    req.headers.get("x-manuscrit-user") ||
    null;
  return user && env.BUCKET
    ? { bucket: env.BUCKET, prefix: "owners/" + encodeURIComponent(user) + "/" }
    : null;
}

function materialIdOk(id: string) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(id);
}

/** UUID ou hash SHA-256 hex — refuse chemins, "../", "/" et "\". */
function fileIdOk(id: string) {
  return /^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{64})$/.test(
    id,
  );
}

function materialIdFromUrl(req: Request): string | null {
  const parts = new URL(req.url).pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const textsAt = parts.indexOf("texts");
  if (textsAt < 0 || !parts[textsAt + 1]) return null;
  return parts[textsAt + 1];
}
export async function GET(req: Request) {
  const s = storage(req);
  if (!s) return new Response(null, { status: 403 });
  const url = new URL(req.url);
  const file = url.searchParams.get("file");
  const textId = url.searchParams.get("text");
  if (textId) {
    // UUID ou id court (ex. matériaux démo m1) — pas de / ni ..
    if (!materialIdOk(textId)) return new Response(null, { status: 400 });
    const hashParam = url.searchParams.get("hash");
    if (hashParam && !isTextContentHash(hashParam))
      return new Response(null, { status: 400 });
    const stored = await loadMaterialTexts(
      s.bucket,
      s.prefix,
      textId,
      hashParam,
    );
    if (!stored) return new Response(null, { status: 404 });
    const hash =
      stored.hash ||
      fingerprintMaterialTexts({
        extracted: stored.extracted || "",
        toolExtracted: stored.toolExtracted || "",
        tables: stored.tables,
      });
    return Response.json(
      {
        extracted: stored.extracted || "",
        toolExtracted: stored.toolExtracted || "",
        tables: stored.tables || [],
        hash,
      },
      { headers: { "Cache-Control": "private,no-store" } },
    );
  }
  // (1) Identifiant strict : pas de chemin / traversal. (2) Clé sous
  // owners/<uid>/files/<id> uniquement — autre uid ⇒ objet absent ⇒ 404.
  // (3) Aucun journal du nom ni du contenu ici.
  if (file && !fileIdOk(file)) return new Response(null, { status: 400 });
  const obj = await s.bucket.get(
    s.prefix + (file ? "files/" + file : "workspace"),
  );
  if (file) {
    if (!obj) return new Response(null, { status: 404 });
    const name = obj.customMetadata?.name || "document";
    const isDocx = /\.docx$/i.test(name);
    return new Response(obj.body, {
      headers: {
        "content-disposition":
          "attachment; filename*=UTF-8''" + encodeURIComponent(name),
        "content-type": isDocx
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/octet-stream",
        "cache-control": "private,no-store",
      },
    });
  }
  return Response.json(
    { data: obj ? await obj.json() : null, rev: obj?.etag || "" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: Request) {
  const s = storage(req);
  if (!s) return new Response(null, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL((env as any).APP_BASE_URL || req.url).origin)
    return new Response(null, { status: 403 });
  try {
    if (new URL(req.url).searchParams.has("upload")) {
      if (req.headers.get("X-Deposit-Attested") !== "yes")
        return new Response(null, { status: 422 });
      const bytes = await limitedBody(req, 20 * 1024 * 1024);
      const name = (
        new URL(req.url).searchParams.get("name") || "document"
      ).slice(0, 200);
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const id = Array.from(hash, (x) => x.toString(16).padStart(2, "0")).join(
        "",
      );
      const key = s.prefix + "files/" + id;
      if (!(await s.bucket.head(key))) {
        // Reserve capacity before writing. A retry of the same file reuses its reservation.
        await changeValue<Record<string, number>>(
          s.bucket,
          s.prefix + "upload-capacity",
          {},
          (used) => {
            if (id in used) return used;
            if (
              Object.keys(used).length >= 500 ||
              Object.values(used).reduce((a, b) => a + b, 0) + bytes.length >
                512 * 1024 * 1024
            )
              throw new BillingError(413, "Limite de stockage atteinte.");
            return { ...used, [id]: bytes.length };
          },
        );
        await s.bucket.put(key, bytes, {
          onlyIf: { etagDoesNotMatch: "*" },
          customMetadata: { name, attestedAt: new Date().toISOString() },
        });
      }
      return Response.json({ id });
    }
    // Filet anciens clients : textes inline encore acceptés puis externalisés.
    const { data, rev, attested } = JSON.parse(
      new TextDecoder().decode(await limitedBody(req, 16 * 1024 * 1024)),
    );
    if (attested !== true) return new Response(null, { status: 422 });
    if (!data?.projects?.length) return new Response(null, { status: 400 });
    const previousObj = await s.bucket.get(s.prefix + "workspace");
    const previous = previousObj
      ? await previousObj.json<{
          projects?: Array<{ id?: string; materials?: Array<{ id?: string }> }>;
        }>()
      : null;
    const writeLog = await externalizeProjectMaterialTexts(
      s.bucket,
      s.prefix,
      data,
    );
    const obj = await s.bucket.put(
      s.prefix + "workspace",
      JSON.stringify(data),
      { onlyIf: rev ? { etagMatches: rev } : { etagDoesNotMatch: "*" } },
    );
    if (!obj) return new Response(null, { status: 409 });
    // Purge jobs / map de pseudonymisation / vision / unités des projets retirés.
    try {
      await purgeRemovedProjects(s.bucket, s.prefix, previous, data);
    } catch {
      /* la sauvegarde workspace a réussi ; purge best-effort */
    }
    // Textes / vision orphelins : arrière-plan (réessai à la prochaine save si échec).
    scheduleOrphanTextCleanup(s.bucket, s.prefix, data, writeLog);
    return Response.json({ rev: obj.etag });
  } catch (e) {
    return new Response(null, {
      status:
        e instanceof BodyLimit
          ? 413
          : e instanceof BillingError
            ? e.status
            : e instanceof SyntaxError
              ? 400
              : 500,
    });
  }
}

/**
 * PUT /api/workspace/texts/:materialId
 * Persistance dédiée des textes extraits (hors JSON workspace).
 */
export async function PUT_text(req: Request) {
  const s = storage(req);
  if (!s) return new Response(null, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL((env as any).APP_BASE_URL || req.url).origin)
    return new Response(null, { status: 403 });
  const materialId = materialIdFromUrl(req);
  if (!materialId || !materialIdOk(materialId))
    return new Response(null, { status: 400 });
  const maxBytes = resolveMaxTextChars();
  try {
    const raw = await limitedBody(req, maxBytes);
    const body = JSON.parse(new TextDecoder().decode(raw)) as {
      extracted?: unknown;
      toolExtracted?: unknown;
      tables?: unknown;
      /** Hash du contenu déjà connu (repli pour fusion partielle). */
      baseHash?: unknown;
    };
    const baseHash =
      typeof body.baseHash === "string" && isTextContentHash(body.baseHash)
        ? body.baseHash
        : null;
    const existing = await loadMaterialTexts(
      s.bucket,
      s.prefix,
      materialId,
      baseHash,
    );
    const payload = {
      extracted:
        typeof body.extracted === "string"
          ? body.extracted
          : existing?.extracted || "",
      toolExtracted:
        typeof body.toolExtracted === "string"
          ? body.toolExtracted
          : existing?.toolExtracted || "",
      tables: Array.isArray(body.tables)
        ? body.tables
        : existing?.tables,
    };
    const saved = await saveMaterialTexts(
      s.bucket,
      s.prefix,
      materialId,
      payload,
    );
    const length = materialText({
      extracted: payload.extracted,
      toolExtracted: payload.toolExtracted,
      tables: payload.tables,
    } as any).length;
    return Response.json(
      { textStored: true, length, hash: saved.hash },
      { headers: { "Cache-Control": "private,no-store" } },
    );
  } catch (e) {
    return new Response(null, {
      status:
        e instanceof BodyLimit
          ? 413
          : e instanceof SyntaxError
            ? 400
            : 500,
    });
  }
}
