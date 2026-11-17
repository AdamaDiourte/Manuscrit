import { createHash } from "node:crypto";
import pg from "pg";

// Chaque processus possède un petit pool. Les écritures conditionnelles
// sont arbitrées par PostgreSQL, même avec plusieurs réplicas applicatifs.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  max: Number(process.env.PG_POOL_SIZE || 8),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000
});
// Une connexion inactive peut être fermée lors d'une maintenance de la base.
pool.on("error", error => console.warn("Connexion PostgreSQL interrompue", error.code || "PG_CONNECTION"));
const info = row => ({
  key: row.key, etag: row.etag, size: Number(row.size),
  uploaded: row.updated_at, customMetadata: row.metadata || {}
});
async function get(key) {
  const result = await pool.query("SELECT *, octet_length(content) AS size FROM manuscript_objects WHERE key=$1", [key]);
  const row = result.rows[0];
  if (!row) return null;
  const bytes = row.content;
  return {
    ...info(row), body: new Blob([bytes]).stream(),
    text: async () => bytes.toString("utf8"),
    json: async () => JSON.parse(bytes.toString("utf8")),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}
async function head(key) {
  const result = await pool.query("SELECT key,etag,metadata,updated_at,octet_length(content) AS size FROM manuscript_objects WHERE key=$1", [key]);
  return result.rowCount ? info(result.rows[0]) : null;
}
async function put(key, value, {onlyIf = {}, customMetadata = {}} = {}) {
  const bytes = Buffer.from(await new Response(value).arrayBuffer());
  const etag = createHash("sha256").update(bytes).digest("hex");
  const fields = [key, bytes, etag, JSON.stringify(customMetadata)];
  const insert = "INSERT INTO manuscript_objects(key,content,etag,metadata) VALUES ($1,$2,$3,$4)";
  const result = onlyIf.etagMatches
    ? await pool.query("UPDATE manuscript_objects SET content=$2,etag=$3,metadata=$4,updated_at=now() WHERE key=$1 AND etag=$5 RETURNING etag", [...fields, onlyIf.etagMatches])
    : await pool.query(insert + (onlyIf.etagDoesNotMatch === "*" ? " ON CONFLICT DO NOTHING" : " ON CONFLICT(key) DO UPDATE SET content=EXCLUDED.content,etag=EXCLUDED.etag,metadata=EXCLUDED.metadata,updated_at=now()") + " RETURNING etag", fields);
  return result.rows[0] || null;
}
const bucket = {
  get, head, put,
  async delete(key) { await pool.query("DELETE FROM manuscript_objects WHERE key=ANY($1::text[])", [Array.isArray(key) ? key : [key]]); },
  async list({prefix="", cursor="", limit=1000}={}) {
    const size = Math.min(1000,Math.max(1,limit));
    const result = await pool.query("SELECT key,etag,metadata,updated_at,octet_length(content) AS size FROM manuscript_objects WHERE starts_with(key,$1) AND key>$2 ORDER BY key LIMIT $3", [prefix,cursor,size+1]);
    const objects = result.rows.slice(0,size).map(info);
    return {objects,truncated:result.rows.length>size,cursor:objects.at(-1)?.key};
  }
};
export const env = { ...process.env, BUCKET: bucket };
