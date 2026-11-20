import { checkTextSize, MAX_FILE_BYTES } from "./limits";
import { OfficeArchive } from "./officeArchive";
import {
  buildSheetStructure,
  parseDelimited,
  type TableSheetStructure,
} from "../../../../shared/research/tableStats";

export { MAX_TEXT } from "./limits";
export const fileAccept = ".txt,.md,.csv,.tsv,.pdf,.docx,.xlsx";

export type ExtractionStatus =
  | "ok"
  | "empty"
  | "unsupported"
  | "scanned"
  | "error";

export type ExtractDocumentResult = {
  text: string;
  status: ExtractionStatus;
  message?: string;
  tables?: TableSheetStructure[];
  pdfPageCount?: number;
  scanned?: boolean;
};

const elements = (root: Document | Element, name: string) =>
  Array.from(root.getElementsByTagNameNS("*", name));

async function extractWord(archive: OfficeArchive) {
  const doc = await archive.xml("word/document.xml");
  const paragraphs = elements(doc, "p");
  let size = 0;
  return paragraphs
    .map((paragraph) => {
      const text = elements(paragraph, "*")
        .filter((node) => {
          let parent = node.parentElement;
          while (parent && parent.localName !== "p")
            parent = parent.parentElement;
          return parent === paragraph;
        })
        .map((node) =>
          node.localName === "t"
            ? node.textContent
            : node.localName === "tab"
              ? "\t"
              : node.localName === "br"
                ? "\n"
                : "",
        )
        .join("");
      checkTextSize((size += text.length + 1));
      return text;
    })
    .join("\n");
}

function cellRefCol(ref: string): number {
  const m = /^([A-Z]+)/i.exec(ref || "");
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

function cellRefRow(ref: string): number {
  const m = /(\d+)$/.exec(ref || "");
  return m ? Math.max(0, Number(m[1]) - 1) : 0;
}

async function extractWorkbook(archive: OfficeArchive): Promise<{
  text: string;
  tables: TableSheetStructure[];
}> {
  const workbook = await archive.xml("xl/workbook.xml");
  const relationships = await archive.xml("xl/_rels/workbook.xml.rels");
  const paths = new Map(
    elements(relationships, "Relationship")
      .filter((rel) => rel.getAttribute("TargetMode") !== "External")
      .map((rel) => [rel.getAttribute("Id"), rel.getAttribute("Target")]),
  );
  const strings = archive.has("xl/sharedStrings.xml")
    ? elements(await archive.xml("xl/sharedStrings.xml"), "si").map((si) =>
        elements(si, "t")
          .map((t) => t.textContent)
          .join(""),
      )
    : [];
  const result: string[] = [];
  const tables: TableSheetStructure[] = [];
  let size = 0;
  for (const sheet of elements(workbook, "sheet")) {
    const relation = Array.from(sheet.attributes).find(
      (attribute) => attribute.localName === "id",
    )?.value;
    const target = paths.get(relation || "");
    if (!target) throw new Error("Feuille Excel non résolue.");
    const path = new URL(
      target,
      "https://archive.invalid/xl/workbook.xml",
    ).pathname.slice(1);
    const xml = await archive.xml(path);
    const sheetName = sheet.getAttribute("name") || "Feuille";
    result.push("Feuille « " + sheetName + " »");
    const grid = new Map<string, string>();
    let maxRow = -1;
    let maxCol = -1;
    for (const row of elements(xml, "row")) {
      const cells: string[] = [];
      for (const cell of elements(row, "c")) {
        let value = elements(cell, "v")[0]?.textContent || "";
        const type = cell.getAttribute("t");
        if (type === "s" && value) {
          const resolved = strings[Number(value)];
          if (resolved === undefined)
            throw new Error(
              "Ce classeur contient une référence de texte invalide.",
            );
          value = resolved;
        }
        if (type === "inlineStr")
          value = elements(cell, "t")
            .map((t) => t.textContent)
            .join("");
        const formula = elements(cell, "f")[0]?.textContent;
        if (formula)
          value =
            "=" +
            formula +
            (value ? " [valeur enregistrée : " + value + "]" : "");
        const ref = cell.getAttribute("r") || "";
        if (value) {
          cells.push(ref + " = " + value);
          const r = cellRefRow(ref);
          const c = cellRefCol(ref);
          grid.set(`${r}:${c}`, value);
          maxRow = Math.max(maxRow, r);
          maxCol = Math.max(maxCol, c);
        }
      }
      if (cells.length) {
        const line = cells.join("\t");
        checkTextSize((size += line.length + 1));
        result.push(line);
      }
    }
    result.push("");
    if (maxRow >= 0 && maxCol >= 0) {
      const matrix: string[][] = [];
      for (let r = 0; r <= maxRow; r++) {
        const row: string[] = [];
        for (let c = 0; c <= maxCol; c++) row.push(grid.get(`${r}:${c}`) || "");
        matrix.push(row);
      }
      const structure = buildSheetStructure(sheetName, matrix, true);
      if (structure) tables.push(structure);
    }
  }
  if (!size) throw new Error("Aucune cellule renseignée dans ce classeur.");
  return { text: result.join("\n"), tables };
}

// Mozilla PDF.js 5.6.205 is served from this site. No CDN receives the file.
async function extractPdf(bytes: ArrayBuffer): Promise<{
  text: string;
  scanned: boolean;
  pdfPageCount: number;
}> {
  const moduleUrl = "/vendor/pdfjs/pdf.min.mjs";
  const pdf = await import(
    /* webpackIgnore: true */ /* @vite-ignore */ moduleUrl
  );
  pdf.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
  const task = pdf.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
    cMapUrl: "/vendor/pdfjs/cmaps/",
    cMapPacked: true,
  });
  const parts: string[] = [];
  let size = 0,
    hasText = false;
  const timeout = setTimeout(() => {
    void task.destroy();
  }, 60_000);
  try {
    const doc = await task.promise;
    if (doc.numPages > 600)
      throw new Error(
        "Ce PDF dépasse 600 pages. Divisez-le en lots identifiés.",
      );
    for (let index = 1; index <= doc.numPages; index++) {
      const page = await doc.getPage(index);
      const reader = page.streamTextContent().getReader();
      const lines: string[] = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const item of value.items) {
            if (typeof item.str !== "string") continue;
            checkTextSize((size += item.str.length + 1));
            lines.push(item.str + (item.hasEOL ? "\n" : " "));
          }
        }
      } finally {
        await reader.cancel();
        page.cleanup();
      }
      const text = lines.join("").trim();
      if (text) hasText = true;
      parts.push(
        "[Page " +
          index +
          "]\n" +
          (text || "[Aucun texte extractible sur cette page — analyse visuelle prévue]"),
      );
    }
    if (!hasText) {
      return {
        text: parts.join("\n\n"),
        scanned: true,
        pdfPageCount: doc.numPages,
      };
    }
    return {
      text: parts.join("\n\n"),
      scanned: false,
      pdfPageCount: doc.numPages,
    };
  } finally {
    clearTimeout(timeout);
    await task.destroy();
  }
}

/**
 * Extraction enrichie : texte + statut visible + structure tableaux éventuelle.
 */
export async function extractDocument(file: File): Promise<ExtractDocumentResult> {
  if (file.size > MAX_FILE_BYTES)
    return {
      text: "",
      status: "error",
      message: "Le fichier dépasse la limite de 20 Mo.",
    };

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const imageExt = ["png", "jpg", "jpeg", "webp", "gif"];
  if (ext === "doc")
    return {
      text: "",
      status: "unsupported",
      message:
        "Fichier .doc (ancien format Word) : extraction automatique indisponible. Convertissez en .docx ou ajoutez une transcription.",
    };
  if (imageExt.includes(ext))
    return {
      text: "",
      status: "empty",
      message:
        "Image déposée : pas de texte extrait automatiquement. L’analyse visuelle sera proposée lors du plan ; ajoutez une observation si besoin.",
    };
  if (!fileAccept.split(",").includes("." + ext))
    return {
      text: "",
      status: "unsupported",
      message:
        "Format sans extraction automatique. Ajoutez une transcription, une légende ou un export texte.",
    };

  const bytes = await file.arrayBuffer();
  try {
    if (ext === "pdf") {
      const pdf = await extractPdf(bytes);
      const text = pdf.text.replace(/\r\n?/g, "\n").trim();
      if (pdf.scanned)
        return {
          text,
          status: "scanned",
          scanned: true,
          pdfPageCount: pdf.pdfPageCount,
          message:
            "PDF scanné (peu ou pas de texte extractible) : analyse visuelle page à page lors du plan de rédaction.",
        };
      checkTextSize(text.length);
      return { text, status: "ok", pdfPageCount: pdf.pdfPageCount };
    }
    if (ext === "xlsx") {
      const { text, tables } = await extractWorkbook(new OfficeArchive(bytes));
      const normalized = text.replace(/\r\n?/g, "\n").trim();
      checkTextSize(normalized.length);
      return { text: normalized, status: "ok", tables };
    }
    if (ext === "docx") {
      const text = (await extractWord(new OfficeArchive(bytes)))
        .replace(/\r\n?/g, "\n")
        .trim();
      if (!text)
        return {
          text: "",
          status: "empty",
          message: "Le document ne contient aucun texte extractible.",
        };
      checkTextSize(text.length);
      return { text, status: "ok" };
    }
    if (ext === "csv" || ext === "tsv") {
      const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
      const encoding =
        head[0] === 255 && head[1] === 254
          ? "utf-16le"
          : head[0] === 254 && head[1] === 255
            ? "utf-16be"
            : "utf-8";
      const raw = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      const text = raw.replace(/\r\n?/g, "\n").trim();
      if (!text)
        return {
          text: "",
          status: "empty",
          message: "Le document ne contient aucun texte extractible.",
        };
      checkTextSize(text.length);
      const matrix = parseDelimited(text, ext === "tsv" ? "\t" : ",");
      const sheet = buildSheetStructure("Données", matrix, true);
      return {
        text,
        status: "ok",
        tables: sheet ? [sheet] : undefined,
      };
    }
    {
      const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
      const encoding =
        head[0] === 255 && head[1] === 254
          ? "utf-16le"
          : head[0] === 254 && head[1] === 255
            ? "utf-16be"
            : "utf-8";
      let text: string;
      try {
        text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      } catch {
        return {
          text: "",
          status: "error",
          message: "Encodage du texte illisible. Enregistrez le fichier en UTF-8.",
        };
      }
      if (text.includes("\u0000"))
        return {
          text: "",
          status: "error",
          message:
            "Ce fichier ne semble pas être un texte. Vérifiez son format.",
        };
      text = text.replace(/\r\n?/g, "\n").trim();
      if (!text)
        return {
          text: "",
          status: "empty",
          message: "Le document ne contient aucun texte extractible.",
        };
      checkTextSize(text.length);
      return { text, status: "ok" };
    }
  } catch (error) {
    if (
      error instanceof Error &&
      /^(Ce |Ce[ts]te |Ce[ts] |Aucun|Archive |Format |Encodage |Feuille )/.test(
        error.message,
      )
    )
      return { text: "", status: "error", message: error.message };
    return {
      text: "",
      status: "error",
      message:
        "Lecture du fichier impossible. Vérifiez qu’il est lisible et sans mot de passe, ou fournissez une transcription.",
    };
  }
}

/** Compatibilité : renvoie le texte ou lève si échec bloquant. */
export async function extractText(file: File): Promise<string> {
  const result = await extractDocument(file);
  if (result.status === "ok" || result.status === "scanned") return result.text;
  throw new Error(
    result.message ||
      "Format sans extraction automatique. Ajoutez une transcription, une légende ou un export texte.",
  );
}
