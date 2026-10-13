export interface Capture {
  schema_version: 1;
  capture_id: string;
  feed_kind: string;
  source: string;
  retrieved_at: string;
  provider_timestamp: null;
  sha256: string;
  byte_length: number;
  archive_ref: string;
  attribution: string;
  rights_status: 'pending_review';
  licence_reference: string;
}

export interface Storage {
  head(key: string): Promise<unknown>;
  put(key: string, value: ArrayBuffer | string): Promise<unknown>;
}

export interface SnapshotDataset {
  kind: string;
  extension: string;
  source: string;
}

export interface CaptureIdentity {
  now: () => Date;
  uuid: () => string;
}

export async function archiveSnapshot(
  dataset: SnapshotDataset,
  bytes: ArrayBuffer,
  storage: Storage,
  identity: CaptureIdentity,
): Promise<Capture> {
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const archiveRef = `blobs/${dataset.kind}/${hash}.${dataset.extension}`;
  const capture: Capture = {
    schema_version: 1,
    capture_id: identity.uuid(),
    feed_kind: dataset.kind,
    source: dataset.source,
    retrieved_at: identity.now().toISOString(),
    provider_timestamp: null,
    sha256: hash,
    byte_length: bytes.byteLength,
    archive_ref: archiveRef,
    attribution: 'Land Transport Authority (LTA), Singapore; DataMall',
    rights_status: 'pending_review',
    licence_reference:
      'https://datamall.lta.gov.sg/content/datamall/en/terms-and-conditions.html',
  };
  if (!(await storage.head(archiveRef))) {
    await storage.put(archiveRef, bytes);
  }
  await storage.put(
    `captures/${dataset.kind}/${capture.retrieved_at}/${capture.capture_id}.json`,
    JSON.stringify(capture),
  );
  // No mutable latest pointer: overlapping cron runs cannot overwrite a newer capture.
  return capture;
}
