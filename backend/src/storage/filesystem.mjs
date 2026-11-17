import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile, unlink, readdir} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

// Stockage local pour le développement sans PostgreSQL / Docker.
const root =
  process.env.MANUSCRIT_DATA_DIR ||
  join(dirname(fileURLToPath(import.meta.url)), "../../.data/objects");

async function ensure() {
  await mkdir(root, {recursive: true});
}

function paths(key) {
  const id = createHash("sha256").update(key).digest("hex");
  return {
    data: join(root, id + ".bin"),
    meta: join(root, id + ".json"),
  };
}

function info(meta, size) {
  return {
    key: meta.key,
    etag: meta.etag,
    size,
    uploaded: new Date(meta.updated_at),
    customMetadata: meta.metadata || {},
  };
}

async function readMeta(metaPath) {
  try {
    return JSON.parse(await readFile(metaPath, "utf8"));
  } catch {
    return null;
  }
}

async function get(key) {
  const {data, meta: metaPath} = paths(key);
  const meta = await readMeta(metaPath);
  if (!meta || meta.key !== key) return null;
  const bytes = await readFile(data);
  return {
    ...info(meta, bytes.length),
    body: new Blob([bytes]).stream(),
    text: async () => bytes.toString("utf8"),
    json: async () => JSON.parse(bytes.toString("utf8")),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

async function head(key) {
  const {data, meta: metaPath} = paths(key);
  const meta = await readMeta(metaPath);
  if (!meta || meta.key !== key) return null;
  const bytes = await readFile(data);
  return info(meta, bytes.length);
}

async function put(key, value, {onlyIf = {}, customMetadata = {}} = {}) {
  await ensure();
  const bytes = Buffer.from(await new Response(value).arrayBuffer());
  const etag = createHash("sha256").update(bytes).digest("hex");
  const {data, meta: metaPath} = paths(key);
  const existing = await readMeta(metaPath);
  if (onlyIf.etagMatches) {
    if (!existing || existing.key !== key || existing.etag !== onlyIf.etagMatches)
      return null;
  }
  if (onlyIf.etagDoesNotMatch === "*" && existing && existing.key === key)
    return null;
  await writeFile(data, bytes);
  await writeFile(
    metaPath,
    JSON.stringify({
      key,
      etag,
      metadata: customMetadata,
      updated_at: new Date().toISOString(),
    }),
  );
  return {etag};
}

async function remove(key) {
  const {data, meta} = paths(key);
  await Promise.allSettled([unlink(data), unlink(meta)]);
}

const bucket = {
  get,
  head,
  put,
  async delete(key) {
    const keys = Array.isArray(key) ? key : [key];
    await Promise.all(keys.map(remove));
  },
  async list({prefix = "", cursor = "", limit = 1000} = {}) {
    await ensure();
    const size = Math.min(1000, Math.max(1, limit));
    const files = (await readdir(root)).filter((name) => name.endsWith(".json"));
    const objects = [];
    for (const name of files) {
      const meta = await readMeta(join(root, name));
      if (!meta || !meta.key.startsWith(prefix) || meta.key <= cursor) continue;
      try {
        const bytes = await readFile(join(root, name.replace(/\.json$/, ".bin")));
        objects.push(info(meta, bytes.length));
      } catch {
        /* fichier incomplet ignoré */
      }
    }
    objects.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const page = objects.slice(0, size);
    return {
      objects: page,
      truncated: objects.length > size,
      cursor: page.at(-1)?.key,
    };
  },
};

export const env = {...process.env, BUCKET: bucket};
console.info("Manuscrit : stockage fichier local (.data).");
