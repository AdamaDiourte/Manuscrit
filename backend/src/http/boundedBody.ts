export class BodyLimit extends Error {}
// Count streamed bytes as well as checking Content-Length, which clients may omit.
export async function limitedBody(req: Request, max: number) {
  if (Number(req.headers.get("content-length")) > max) throw new BodyLimit();
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new BodyLimit();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
