// Office documents are ZIP files. Read only the requested XML parts and cap
// actual inflated bytes, including when the archive declares a false size.
const MAX_XML_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const invalid = () =>
  new Error("Archive Office illisible, chiffrée ou non prise en charge.");
type Part = {
  offset: number;
  compressed: number;
  size: number;
  method: number;
};

export class OfficeArchive {
  private parts = new Map<string, Part>();
  private inflated = 0;
  private view: DataView;

  constructor(private bytes: ArrayBuffer) {
    this.view = new DataView(bytes);
    const length = bytes.byteLength;
    let end = length - 22;
    while (end >= Math.max(0, length - 65557)) {
      if (
        this.u32(end) === 0x06054b50 &&
        end + 22 + this.u16(end + 20) === length
      )
        break;
      end--;
    }
    if (
      end < Math.max(0, length - 65557) ||
      this.u16(end + 4) ||
      this.u16(end + 6)
    )
      throw invalid();
    const count = this.u16(end + 10);
    if (count > 4096) throw invalid();
    let position = this.u32(end + 16);
    for (let index = 0; index < count; index++) {
      if (
        position + 46 > end ||
        this.u32(position) !== 0x02014b50 ||
        this.u16(position + 8) & 1
      )
        throw invalid();
      const nameLength = this.u16(position + 28);
      const name = new TextDecoder().decode(
        new Uint8Array(bytes, position + 46, nameLength),
      );
      if (this.parts.has(name)) throw invalid();
      this.parts.set(name, {
        method: this.u16(position + 10),
        size: this.u32(position + 24),
        compressed: this.u32(position + 20),
        offset: this.u32(position + 42),
      });
      position +=
        46 + nameLength + this.u16(position + 30) + this.u16(position + 32);
    }
  }

  private u16(position: number) {
    return this.view.getUint16(position, true);
  }
  private u32(position: number) {
    return this.view.getUint32(position, true);
  }
  has(name: string) {
    return this.parts.has(name);
  }

  async xml(name: string): Promise<Document> {
    const part = this.parts.get(name);
    if (!part || this.u32(part.offset) !== 0x04034b50) throw invalid();
    const start =
      part.offset +
      30 +
      this.u16(part.offset + 26) +
      this.u16(part.offset + 28);
    const remaining = Math.min(MAX_XML_BYTES, MAX_TOTAL_BYTES - this.inflated);
    if (
      part.size > remaining ||
      start + part.compressed > this.bytes.byteLength
    ) {
      throw new Error(
        "Ce document Office est trop volumineux après décompression. Exportez les passages ou les feuilles utiles.",
      );
    }
    const compressed = new Uint8Array(this.bytes, start, part.compressed);
    let stream: ReadableStream<Uint8Array<ArrayBuffer>> = new Blob([
      compressed,
    ]).stream();
    if (part.method === 8)
      stream = stream.pipeThrough(new DecompressionStream("deflate-raw"));
    else if (part.method !== 0) throw invalid();
    const reader = stream.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    const fragments: string[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > remaining || size > part.size) throw invalid();
        fragments.push(decoder.decode(value, { stream: true }));
      }
    } finally {
      await reader.cancel();
    }
    if (size !== part.size) throw invalid();
    this.inflated += size;
    const xml = fragments.join("") + decoder.decode();
    if (/<!DOCTYPE/i.test(xml)) throw invalid();
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.getElementsByTagName("parsererror").length) throw invalid();
    return document;
  }
}
