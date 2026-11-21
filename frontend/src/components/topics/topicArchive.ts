import type {
  DocumentKind,
  GeneratedTopic,
} from "../../../../shared/research/topicTypes";
import { downloadDocx } from "./downloadDocx";

export type ArchivedDoc = {
  kind: DocumentKind;
  filename: string;
  fileId: string;
};

export type TopicArchiveEntry = {
  id: string;
  at: string;
  updatedAt: string;
  model?: string;
  simulated?: boolean;
  projectType?: string;
  /** Sous-ensemble profil / préremplissage (optionnel). */
  answers?: Record<string, unknown>;
  topics: GeneratedTopic[];
  chosenTopic?: GeneratedTopic | null;
  documents?: ArchivedDoc[];
};

export function emptyArchiveMessage() {
  return "Vous n’avez pas encore sollicité d’aide à la construction d’un sujet.";
}

export function makeArchiveId() {
  return "arch-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/**
 * Merge archive lists without wiping a chosen subject or its files.
 * - If `next` is missing (partial save), keep `previous`.
 * - An explicit `[]` clears the archive (intentional delete of every entry).
 * - For matching ids, keep chosenTopic / documents when the newer payload omits them.
 * - Ids absent from `next` stay removed (intentional delete).
 */
export function mergeTopicArchives(
  previous: TopicArchiveEntry[] | undefined,
  next: TopicArchiveEntry[] | undefined,
): TopicArchiveEntry[] {
  const prevList = Array.isArray(previous) ? previous : [];
  if (!Array.isArray(next)) return prevList.slice(0, 20);
  const prevById = new Map(prevList.map((e) => [e.id, e]));
  return next
    .map((entry) => {
      const old = prevById.get(entry.id);
      if (!old) return entry;
      return {
        ...old,
        ...entry,
        at: old.at || entry.at,
        topics: entry.topics?.length ? entry.topics : old.topics,
        chosenTopic: entry.chosenTopic ?? old.chosenTopic ?? null,
        documents:
          entry.documents && entry.documents.length
            ? entry.documents
            : old.documents,
      };
    })
    .slice(0, 20);
}

export async function uploadArchivedDoc(doc: {
  filename: string;
  mimeType: string;
  base64: string;
}): Promise<string> {
  const binary = atob(doc.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const file = new File([bytes], doc.filename, { type: doc.mimeType });
  const upload = await fetch(
    "/api/workspace?upload=1&name=" + encodeURIComponent(doc.filename),
    {
      method: "POST",
      headers: { "X-Deposit-Attested": "yes" },
      body: file,
    },
  );
  if (!upload.ok) throw new Error("Le document n’a pas pu être archivé.");
  const { id } = (await upload.json()) as { id: string };
  return id;
}

/**
 * Télécharge un Word d’archive : fichier stocké, ou regénération si absent.
 * Renvoie éventuellement un nouveau fileId à persister dans l’archive.
 */
export async function downloadArchivedDoc(input: {
  projectId: string;
  archiveId: string;
  doc: ArchivedDoc;
}): Promise<{ fileId: string; filename: string }> {
  const DOCX_MIME =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  const stored = await fetch(
    "/api/workspace?file=" + encodeURIComponent(input.doc.fileId),
    { cache: "no-store" },
  );
  if (stored.ok) {
    const blob = await stored.blob();
    const result = downloadDocx(blob, input.doc.filename);
    if (!result.ok) throw new Error("Fichier Word invalide.");
    return { fileId: input.doc.fileId, filename: input.doc.filename };
  }

  const regen = await fetch("/api/topics/archive-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      archiveId: input.archiveId,
      kind: input.doc.kind,
    }),
  });
  const data = (await regen.json()) as {
    error?: string;
    file?: { filename: string; mimeType: string; base64: string };
  };
  if (!regen.ok || !data.file?.base64)
    throw new Error(data.error || "Téléchargement Word impossible.");

  const filename = data.file.filename || input.doc.filename;
  const dl = downloadDocx(data.file.base64, filename);
  if (!dl.ok) throw new Error("Fichier Word invalide.");

  let fileId = input.doc.fileId;
  try {
    fileId = await uploadArchivedDoc({
      filename,
      mimeType: data.file.mimeType || DOCX_MIME,
      base64: data.file.base64,
    });
  } catch {
    /* téléchargement ok ; réarchivage best-effort */
  }
  return { fileId, filename };
}
