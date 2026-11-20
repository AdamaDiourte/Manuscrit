import type {
  TopicDocument,
  VerifiedReading,
} from "../../../../shared/research/topicTypes";

export type CitationGuardResult = {
  document: TopicDocument;
  codes: string[];
  /** 1-based [Rn] indexes that appeared in the raw document before rewrite. */
  citedIndexes: number[];
};

function authorYear(reading: VerifiedReading): string {
  const author = reading.authors[0] || "Auteur";
  const short = author.split(/\s+/).slice(-1)[0] || author;
  const year = reading.year ? String(reading.year) : "s. d.";
  return `(${short}, ${year})`;
}

function readingCitationSet(readings: VerifiedReading[]): Set<string> {
  const set = new Set<string>();
  for (const r of readings) {
    const author = r.authors[0] || "";
    const last = author.split(/\s+/).slice(-1)[0] || author;
    if (last && r.year) {
      set.add(`${last.toLowerCase()}|${r.year}`);
    }
  }
  return set;
}

function rewriteText(
  text: string,
  readings: VerifiedReading[],
  allowed: Set<string>,
  codes: string[],
  cited: Set<number>,
): string {
  let out = text;

  out = out.replace(/\[R(\d+)\]/gi, (_m, n: string) => {
    const idx = Number(n) - 1;
    if (idx >= 0 && idx < readings.length) {
      cited.add(idx + 1);
      return authorYear(readings[idx]);
    }
    return "";
  });

  // Unauthorized (Author, year) or Author (year) / et al.
  out = out.replace(
    /\(([A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÿ'’-]+(?:\s+et\s+al\.?)?)\s*,\s*((?:1[89]|20)\d{2}|s\.\s*d\.)\)/g,
    (full, name: string, year: string) => {
      const key = `${String(name).split(/\s+/).slice(-1)[0].toLowerCase()}|${year}`;
      if (allowed.has(key)) return full;
      codes.push("UNVERIFIED_CITATION");
      return "";
    },
  );

  out = out.replace(
    /\b([A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÿ'’-]+)(?:\s+et\s+al\.?)?\s*\(((?:1[89]|20)\d{2})\)/g,
    (full, name: string, year: string) => {
      const key = `${String(name).toLowerCase()}|${year}`;
      if (allowed.has(key)) return full;
      codes.push("UNVERIFIED_CITATION");
      return "";
    },
  );

  return out.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
}

/**
 * Remplace [Rn] valides, retire les citations non autorisées.
 * Journalise seulement le code UNVERIFIED_CITATION (via codes retournés).
 */
export function applyCitationGuard(
  document: TopicDocument,
  readings: VerifiedReading[],
): CitationGuardResult {
  const codes: string[] = [];
  const cited = new Set<number>();
  const allowed = readingCitationSet(readings);

  const sections = document.sections.map((section) => ({
    ...section,
    paragraphs: section.paragraphs.map((p) =>
      rewriteText(p, readings, allowed, codes, cited),
    ),
    bullets: section.bullets?.map((b) =>
      rewriteText(b, readings, allowed, codes, cited),
    ),
    table: section.table
      ? {
          headers: section.table.headers.map((h) =>
            rewriteText(h, readings, allowed, codes, cited),
          ),
          rows: section.table.rows.map((row) =>
            row.map((cell) =>
              rewriteText(cell, readings, allowed, codes, cited),
            ),
          ),
        }
      : undefined,
  }));

  return {
    document: { ...document, sections },
    codes: [...new Set(codes)],
    citedIndexes: [...cited].sort((a, b) => a - b),
  };
}
