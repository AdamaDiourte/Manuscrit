/**
 * Structure et statistiques descriptives de tableaux (calcul code, pas IA).
 */

export type ColumnType = "string" | "number" | "boolean" | "date" | "empty";

export type TableColumn = {
  name: string;
  type: ColumnType;
};

export type ColumnStats = {
  name: string;
  type: ColumnType;
  count: number;
  missing: number;
  /** Modalités les plus fréquentes (catégorielles). */
  topValues?: { value: string; count: number }[];
  min?: number;
  max?: number;
  mean?: number;
};

export type TableSheetStructure = {
  sheet: string;
  columns: TableColumn[];
  rowCount: number;
  /** Jusqu’à 20 lignes d’échantillon. */
  sample: Record<string, string>[];
  stats: ColumnStats[];
  /** Plage approximative (ex. A1:D42). */
  range?: string;
};

function colLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function inferType(values: string[]): ColumnType {
  const nonEmpty = values.filter((v) => v.trim() !== "");
  if (!nonEmpty.length) return "empty";
  if (nonEmpty.every((v) => /^(true|false|oui|non|0|1)$/i.test(v.trim())))
    return "boolean";
  if (
    nonEmpty.every((v) => {
      const n = Number(String(v).replace(",", "."));
      return Number.isFinite(n) && String(v).trim() !== "";
    })
  )
    return "number";
  if (
    nonEmpty.every((v) => !Number.isNaN(Date.parse(v)) && /\d{4}|\d{1,2}[/-]/.test(v))
  )
    return "date";
  return "string";
}

export function computeColumnStats(
  columns: TableColumn[],
  rows: Record<string, string>[],
): ColumnStats[] {
  return columns.map((col) => {
    const values = rows.map((r) => String(r[col.name] ?? ""));
    const missing = values.filter((v) => !v.trim()).length;
    const present = values.filter((v) => v.trim());
    const base: ColumnStats = {
      name: col.name,
      type: col.type,
      count: present.length,
      missing,
    };
    if (col.type === "number") {
      const nums = present
        .map((v) => Number(String(v).replace(",", ".")))
        .filter((n) => Number.isFinite(n));
      if (nums.length) {
        const sum = nums.reduce((a, b) => a + b, 0);
        base.min = Math.min(...nums);
        base.max = Math.max(...nums);
        base.mean = sum / nums.length;
      }
      return base;
    }
    const freq = new Map<string, number>();
    for (const v of present) freq.set(v, (freq.get(v) || 0) + 1);
    base.topValues = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value: value.slice(0, 80), count }));
    return base;
  });
}

/** Construit une structure de feuille à partir d’une matrice (1re ligne = en-têtes si detectHeaders). */
export function buildSheetStructure(
  sheet: string,
  matrix: string[][],
  detectHeaders = true,
): TableSheetStructure | null {
  if (!matrix.length) return null;
  let headers: string[];
  let dataRows: string[][];
  if (detectHeaders && matrix.length >= 2) {
    headers = matrix[0].map((h, i) => (h.trim() ? h.trim() : `col_${i + 1}`));
    dataRows = matrix.slice(1);
  } else {
    const width = Math.max(...matrix.map((r) => r.length), 0);
    headers = Array.from({ length: width }, (_, i) => `col_${i + 1}`);
    dataRows = matrix;
  }
  const width = headers.length;
  const normalized = dataRows.map((row) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < width; i++)
      obj[headers[i]] = String(row[i] ?? "").trim();
    return obj;
  });
  const columns: TableColumn[] = headers.map((name) => ({
    name,
    type: inferType(normalized.map((r) => r[name] || "")),
  }));
  const stats = computeColumnStats(columns, normalized);
  const lastRow = normalized.length + (detectHeaders ? 1 : 0);
  const range =
    width > 0
      ? `A1:${colLetter(width - 1)}${Math.max(1, lastRow)}`
      : undefined;
  return {
    sheet,
    columns,
    rowCount: normalized.length,
    sample: normalized.slice(0, 20),
    stats,
    range,
  };
}

/** Parse CSV/TSV simple (pas de guillemets échappés complexes). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\n|\r/)
    .filter((line) => line.length)
    .map((line) => line.split(delimiter).map((c) => c.trim()));
}
