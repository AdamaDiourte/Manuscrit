import { checkTextSize, MAX_FILE_BYTES } from "./limits";
import { OfficeArchive } from "./officeArchive";

export { MAX_TEXT } from "./limits";
export const fileAccept = ".txt,.md,.csv,.tsv,.pdf,.docx,.xlsx";

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

async function extractWorkbook(archive: OfficeArchive) {
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
    result.push("Feuille « " + sheet.getAttribute("name") + " »");
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
        if (value) cells.push((cell.getAttribute("r") || "") + " = " + value);
      }
      if (cells.length) {
        const line = cells.join("\t");
        checkTextSize((size += line.length + 1));
        result.push(line);
      }
    }
    result.push("");
  }
  if (!size) throw new Error("Aucune cellule renseignée dans ce classeur.");
  return result.join("\n");
}

// Mozilla PDF.js 5.6.205 is served from this site. No CDN receives the file.
async function extractPdf(bytes: ArrayBuffer) {
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
          (text || "[Aucun texte extractible sur cette page]"),
      );
    }
    if (!hasText)
      throw new Error(
        "Ce PDF ne contient pas de texte extractible. Fournissez une transcription ou un PDF avec reconnaissance de caractères.",
      );
    return parts.join("\n\n");
  } finally {
    clearTimeout(timeout);
    await task.destroy();
  }
}

export async function extractText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES)
    throw new Error("Le fichier dépasse la limite de 20 Mo.");
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (!fileAccept.split(",").includes("." + ext)) {
    throw new Error(
      "Format sans extraction automatique. Ajoutez une transcription, une légende ou un export texte.",
    );
  }
  const bytes = await file.arrayBuffer();
  let text: string;
  try {
    if (ext === "pdf") text = await extractPdf(bytes);
    else if (ext === "xlsx")
      text = await extractWorkbook(new OfficeArchive(bytes));
    else if (ext === "docx") text = await extractWord(new OfficeArchive(bytes));
    else {
      const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
      const encoding =
        head[0] === 255 && head[1] === 254
          ? "utf-16le"
          : head[0] === 254 && head[1] === 255
            ? "utf-16be"
            : "utf-8";
      try {
        text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      } catch {
        throw new Error(
          "Encodage du texte illisible. Enregistrez le fichier en UTF-8.",
        );
      }
      if (text.includes("\u0000"))
        throw new Error(
          "Ce fichier ne semble pas être un texte. Vérifiez son format.",
        );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      /^(Ce |Ce[ts]te |Ce[ts] |Aucun|Archive |Format |Encodage |Feuille )/.test(
        error.message,
      )
    )
      throw error;
    throw new Error(
      "Lecture du fichier impossible. Vérifiez qu’il est lisible et sans mot de passe, ou fournissez une transcription.",
    );
  }
  text = text.replace(/\r\n?/g, "\n").trim();
  if (!text)
    throw new Error("Le document ne contient aucun texte extractible.");
  checkTextSize(text.length);
  return text;
}
