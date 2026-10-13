/** The object-store operations used by acquisition and publication. */
export interface Bucket {
  head(key: string): Promise<unknown>;
  get(
    key: string,
  ): Promise<{ body: Uint8Array | ReadableStream<Uint8Array> } | null>;
  put(
    key: string,
    value: string | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
    options?: {
      httpMetadata?: { contentType: string };
      onlyIf?: { etagDoesNotMatch: '*' };
    },
  ): Promise<unknown>;
  list(options: { prefix: string; limit: number }): Promise<{
    objects: { key: string }[];
  }>;
  delete(key: string): Promise<void>;
}
