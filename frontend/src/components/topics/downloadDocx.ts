/** Téléchargement fiable d’un DOCX depuis base64 ou Blob. */

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function stripDataUrlPrefix(value: string): string {
  const trimmed = value.trim();
  const marker = ";base64,";
  const idx = trimmed.indexOf(marker);
  if (idx >= 0 && /^data:/i.test(trimmed.slice(0, idx + 1))) {
    return trimmed.slice(idx + marker.length);
  }
  return trimmed;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const raw = stripDataUrlPrefix(base64);
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b; // PK
}

/**
 * Fonction unique pour premier téléchargement et retéléchargement.
 * Attache le lien au DOM et ne révoque l’URL qu’après 60 s.
 */
export function downloadDocx(
  base64OrBlob: string | Blob,
  filename: string,
): { ok: true } | { ok: false; code: "docx.invalid" } {
  let blob: Blob;
  if (typeof base64OrBlob === "string") {
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64ToBytes(base64OrBlob);
    } catch {
      console.info(JSON.stringify({ event: "docx.invalid", reason: "decode" }));
      window.alert(
        "Le fichier Word est invalide et n’a pas pu être téléchargé.",
      );
      return { ok: false, code: "docx.invalid" };
    }
    if (!hasZipSignature(bytes)) {
      console.info(
        JSON.stringify({ event: "docx.invalid", reason: "missing_pk" }),
      );
      window.alert(
        "Le fichier Word est invalide et n’a pas pu être téléchargé.",
      );
      return { ok: false, code: "docx.invalid" };
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    blob = new Blob([copy], { type: DOCX_MIME });
  } else {
    blob = base64OrBlob;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "document.docx";
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Chrome lit le blob de façon asynchrone : ne jamais révoquer tout de suite.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { ok: true };
}

/** @deprecated Prefer downloadDocx — conservé pour appels existants. */
export function downloadBase64File(
  filename: string,
  mimeType: string,
  base64: string,
) {
  void mimeType;
  downloadDocx(base64, filename);
}
