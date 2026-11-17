import { SENSITIVE_TERM_CATEGORIES } from "./sensitiveTerms.fr";

const MASK = "[masqué]";

const patterns: { name: string; re: RegExp }[] = [
  {
    name: "email",
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    name: "phone_fr",
    re: /(?:\+33|0033|0)\s*[1-9](?:[\s.-]*\d{2}){4}/g,
  },
  {
    name: "phone_intl",
    re: /\+\d{1,3}[\s.-]?(?:\d[\s.-]?){6,14}\d/g,
  },
  {
    name: "nir",
    re: /\b[12]\s?\d{2}\s?(?:0[1-9]|1[0-2])\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g,
  },
  {
    name: "iban",
    re: /\b[A-Z]{2}\d{2}(?:[\s]?\d{4}){3,7}\b/gi,
  },
  {
    name: "postal_fr",
    re: /\b\d{1,4}\s+(?:bis|ter|quater)?\s*(?:rue|avenue|av\.|boulevard|bd\.|chemin|impasse|place|allée|allee|route)\s+[^\n,]{3,60}/gi,
  },
  {
    name: "profile_url",
    re: /\bhttps?:\/\/(?:www\.)?(?:linkedin\.com|facebook\.com|fb\.com|instagram\.com|x\.com|twitter\.com)\/[^\s]+/gi,
  },
];

export type MaskResult = {
  text: string;
  masked: boolean;
  kinds: string[];
};

/** Automatic PII masking (emails, phones, NIR, IBAN, simple addresses, profile URLs). */
export function maskIdentifiers(input: string): MaskResult {
  if (!input) return { text: "", masked: false, kinds: [] };
  let text = input;
  const kinds: string[] = [];
  for (const { name, re } of patterns) {
    const next = text.replace(re, MASK);
    if (next !== text) {
      kinds.push(name);
      text = next;
    }
  }
  return { text, masked: kinds.length > 0, kinds };
}

export type SensitiveHit = {
  category: string;
  term: string;
};

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Non-blocking art. 9 term detection for UX warnings. */
export function detectSensitiveTerms(input: string): SensitiveHit[] {
  if (!input?.trim()) return [];
  const hay = normalize(input);
  const hits: SensitiveHit[] = [];
  for (const [category, terms] of Object.entries(SENSITIVE_TERM_CATEGORIES)) {
    for (const term of terms) {
      const needle = normalize(term);
      if (needle && hay.includes(needle)) hits.push({ category, term });
    }
  }
  return hits;
}

/** Full server-side pass before LLM: mask identifiers only (terms are warned client-side). */
export function filterFreeText(input: string): MaskResult {
  return maskIdentifiers(input);
}

const EMAIL_OR_PHONE =
  /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+33|0033|0)\s*[1-9](?:[\s.-]*\d{2}){4})/i;

/** Reject payloads that still contain obvious contact data after filtering. */
export function containsContactLeak(value: unknown): boolean {
  if (typeof value === "string") return EMAIL_OR_PHONE.test(value);
  if (Array.isArray(value)) return value.some(containsContactLeak);
  if (value && typeof value === "object")
    return Object.values(value as Record<string, unknown>).some(
      containsContactLeak,
    );
  return false;
}
