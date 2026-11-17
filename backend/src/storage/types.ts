export interface StoredObject {
  etag: string;
  uploaded: Date;
  customMetadata: Record<string, string>;
  body: ReadableStream<Uint8Array>;
  json<T = unknown>(): Promise<T>;
  text?: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  key?: string;
  size?: number;
}

export interface ObjectStore {
  get(key: string): Promise<StoredObject | null>;
  head(
    key: string,
  ): Promise<(Pick<StoredObject, "etag" | "uploaded"> & {key?: string; size?: number; customMetadata?: Record<string, string>}) | null>;
  put(
    key: string,
    value: string | Uint8Array,
    options?: {
      onlyIf?: {etagMatches?: string; etagDoesNotMatch?: string};
      customMetadata?: Record<string, string>;
    },
  ): Promise<{etag: string} | null>;
  delete(key: string | string[]): Promise<void>;
  list?(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{objects: StoredObject[]; truncated: boolean; cursor?: string}>;
}
