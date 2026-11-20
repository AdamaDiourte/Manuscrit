/** Durées de conservation configurables (jours). */

const DAY_MS = 24 * 60 * 60 * 1000;

function resolveDays(envName: string, fallback: number): number {
  const raw =
    typeof process !== "undefined" && process.env
      ? String(process.env[envName] || "").trim()
      : "";
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Cache d’analyses synchrones `research/{fingerprint}` — défaut 90 jours. */
export function researchCacheMaxAgeMs(): number {
  return resolveDays("RESEARCH_CACHE_MAX_DAYS", 90) * DAY_MS;
}

/** Tâches terminées `jobs/{jobId}` — défaut 30 jours. */
export function jobRetentionMaxAgeMs(): number {
  return resolveDays("JOB_RETENTION_DAYS", 30) * DAY_MS;
}

export { DAY_MS };
