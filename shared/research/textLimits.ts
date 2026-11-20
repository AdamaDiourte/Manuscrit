/** Plafond texte extrait par document (caractères). Configurable via env front. */

export const DEFAULT_MAX_TEXT_CHARS = 3_000_000;

/**
 * Résout le plafond. Côté navigateur : `import.meta.env.VITE_MAX_TEXT_CHARS`.
 * Côté Node : `process.env.MAX_TEXT_CHARS` ou `VITE_MAX_TEXT_CHARS`.
 */
export function resolveMaxTextChars(
  envValue?: string | number | null,
): number {
  const raw =
    envValue !== undefined && envValue !== null
      ? String(envValue).trim()
      : typeof process !== "undefined" && process.env
        ? String(
            process.env.MAX_TEXT_CHARS ||
              process.env.VITE_MAX_TEXT_CHARS ||
              "",
          ).trim()
        : "";
  if (!raw) return DEFAULT_MAX_TEXT_CHARS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_TEXT_CHARS;
}
