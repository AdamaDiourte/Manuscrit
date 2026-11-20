import {
  DEFAULT_MAX_TEXT_CHARS,
  resolveMaxTextChars,
} from "../../../../shared/research/textLimits";

/** Alias historique — même plafond que MAX_TEXT_CHARS. */
export const MAX_TEXT = resolveMaxTextChars(
  typeof import.meta !== "undefined"
    ? (import.meta as ImportMeta & { env?: Record<string, string> }).env
        ?.VITE_MAX_TEXT_CHARS
    : undefined,
);

export const MAX_TEXT_CHARS = MAX_TEXT;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function checkTextSize(characters: number) {
  if (characters > MAX_TEXT_CHARS) {
    throw new Error(
      `Ce texte dépasse ${MAX_TEXT_CHARS.toLocaleString("fr-FR")} caractères (plafond configurable). Divisez le document ou augmentez MAX_TEXT_CHARS / VITE_MAX_TEXT_CHARS.`,
    );
  }
}

export { DEFAULT_MAX_TEXT_CHARS };
