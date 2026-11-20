/** Redimensionne une image avant dépôt (Canvas navigateur, sans dépendance). */

const MAX_BYTES = 4_500_000;
const MAX_EDGE = 2000;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image illisible."));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Export image impossible."))),
      type,
      quality,
    );
  });
}

/**
 * Si l’image dépasse ~4,5 Mo ou 2000 px de côté, la réduit en JPEG.
 * Sinon renvoie le fichier d’origine.
 */
export async function resizeImageForUpload(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type) &&
      !/\.(png|jpe?g|webp|gif)$/i.test(file.name))
    return file;

  const needsResize = file.size > MAX_BYTES;
  const img = await loadImage(file);
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  if (!needsResize && longEdge <= MAX_EDGE) return file;

  let width = img.naturalWidth;
  let height = img.naturalHeight;
  if (longEdge > MAX_EDGE) {
    const scale = MAX_EDGE / longEdge;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, width, height);

  let quality = 0.85;
  let blob = await canvasToBlob(canvas, "image/jpeg", quality);
  while (blob.size > MAX_BYTES && quality > 0.45) {
    quality -= 0.1;
    blob = await canvasToBlob(canvas, "image/jpeg", quality);
  }
  if (blob.size > MAX_BYTES) {
    // Encore trop lourd : réduire encore la taille.
    const scale2 = Math.sqrt(MAX_BYTES / blob.size) * 0.95;
    canvas.width = Math.max(1, Math.round(width * scale2));
    canvas.height = Math.max(1, Math.round(height * scale2));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    blob = await canvasToBlob(canvas, "image/jpeg", 0.75);
  }

  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${base}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}
