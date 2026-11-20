/**
 * Pseudonymisation optionnelle avant envoi IA.
 * E-mails, téléphones, et noms fournis → [PERS_n].
 */

export type PseudonymMap = Record<string, string>; // token → original

const EMAIL_RE =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE =
  /(?:\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}/g;

export function pseudonymizeText(
  text: string,
  names: string[] = [],
  existing: PseudonymMap = {},
): { text: string; map: PseudonymMap } {
  const map: PseudonymMap = { ...existing };
  const reverse = new Map<string, string>();
  for (const [token, original] of Object.entries(map))
    reverse.set(original, token);

  let next = Object.keys(map).length + 1;
  function tokenFor(original: string): string {
    const hit = reverse.get(original);
    if (hit) return hit;
    const token = `[PERS_${next++}]`;
    map[token] = original;
    reverse.set(original, token);
    return token;
  }

  let out = String(text || "");
  out = out.replace(EMAIL_RE, (m) => tokenFor(m));
  out = out.replace(PHONE_RE, (m) => tokenFor(m));

  const sortedNames = [...names]
    .map((n) => String(n || "").trim())
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const name of sortedNames) {
    const re = new RegExp(
      name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi",
    );
    out = out.replace(re, (m) => tokenFor(m));
  }

  return { text: out, map };
}

/** Remplace les jetons par le texte original dans une citation. */
export function restorePseudonyms(
  text: string,
  map: PseudonymMap,
): string {
  let out = text;
  // Tokens les plus longs d’abord
  for (const token of Object.keys(map).sort((a, b) => b.length - a.length))
    out = out.split(token).join(map[token]);
  return out;
}
