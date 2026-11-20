/** In-memory sliding-window rate limiter (no request body logged). */
const hits = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    const retryAfterSec = Math.ceil((recent[0] + windowMs - now) / 1000);
    hits.set(key, recent);
    return { ok: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true };
}

/** Topics generation: 8 req / 10 min (prod) ; plus large hors production pour itérer. */
export function topicsRateLimit(uid: string) {
  const limit = process.env.NODE_ENV === "production" ? 8 : 40;
  return checkRateLimit("topics:" + uid, limit, 10 * 60 * 1000);
}
