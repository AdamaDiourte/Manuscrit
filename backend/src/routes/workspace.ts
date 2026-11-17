import { env } from "../storage/index";
import { limitedBody, BodyLimit } from "../http/boundedBody";
import { changeValue, BillingError } from "../services/billing/storage";

function storage(req: Request) {
  const user =
    req.headers.get("x-manuscrit-user") ||
    null;
  return user && env.BUCKET
    ? { bucket: env.BUCKET, prefix: "owners/" + encodeURIComponent(user) + "/" }
    : null;
}
export async function GET(req: Request) {
  const s = storage(req);
  if (!s) return new Response(null, { status: 403 });
  const file = new URL(req.url).searchParams.get("file");
  if (file && !/^(?:[a-f0-9-]{36}|[a-f0-9]{64})$/.test(file))
    return new Response(null, { status: 400 });
  const obj = await s.bucket.get(
    s.prefix + (file ? "files/" + file : "workspace"),
  );
  if (file)
    return obj
      ? new Response(obj.body, {
          headers: {
            "content-disposition":
              "attachment; filename*=UTF-8''" +
              encodeURIComponent(obj.customMetadata?.name || "document"),
            "content-type": "application/octet-stream",
            "cache-control": "private,no-store",
          },
        })
      : new Response(null, { status: 404 });
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
    const { data, rev, attested } = JSON.parse(
      new TextDecoder().decode(await limitedBody(req, 8 * 1024 * 1024)),
    );
    if (attested !== true) return new Response(null, { status: 422 });
    if (!data?.projects?.length) return new Response(null, { status: 400 });
    const obj = await s.bucket.put(
      s.prefix + "workspace",
      JSON.stringify(data),
      { onlyIf: rev ? { etagMatches: rev } : { etagDoesNotMatch: "*" } },
    );
    return obj
      ? Response.json({ rev: obj.etag })
      : new Response(null, { status: 409 });
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
