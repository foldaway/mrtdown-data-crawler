import { describe, expect, it, vi } from 'vitest';
import { flushScheduleNotifications, publishCapture } from './publication';
import type { Capture } from './snapshots/store';

const hash = 'a'.repeat(64);
const capture: Capture = {
  schema_version: 1,
  capture_id: 'c',
  feed_kind: 'schedule',
  source: 'https://datamall2.mytransport.sg/ltaodataservice/GTFSScheduleTrain',
  retrieved_at: '2026-10-12T00:00:00Z',
  provider_timestamp: null,
  sha256: hash,
  byte_length: 4,
  archive_ref: `blobs/schedule/${hash}.zip`,
  attribution: 'LTA',
  rights_status: 'pending_review',
  licence_reference: 'https://example.com',
};
function bucket() {
  const objects = new Map<string, unknown>();
  const api = {
    head: vi.fn(async (key: string) => objects.has(key)),
    get: vi.fn(async (key: string) =>
      objects.has(key) ? { body: objects.get(key) } : null,
    ),
    put: vi.fn(
      async (key: string, value: unknown, options?: { onlyIf?: unknown }) => {
        if (options?.onlyIf && objects.has(key)) return null;
        objects.set(key, value);
        return {};
      },
    ),
    delete: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
    list: vi.fn(
      async ({ prefix, limit }: { prefix: string; limit: number }) => ({
        objects: [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .slice(0, limit)
          .map((key) => ({ key })),
      }),
    ),
  };
  return { objects, api, r2: api as unknown as R2Bucket };
}
describe('public GTFS handoff', () => {
  it('publishes an attributed immutable schedule receipt and sends one notification per hash', async () => {
    const archive = bucket();
    const publicBucket = bucket();
    archive.objects.set(capture.archive_ref, new Uint8Array([80, 75, 3, 4]));
    const key = await publishCapture(capture, archive.r2, publicBucket.r2);
    const receipt = JSON.parse(String(publicBucket.objects.get(key)));
    expect(receipt.rights_status).toBe('redistribution_permitted');
    expect(receipt.attribution).toContain(capture.retrieved_at);
    expect(receipt.licence_reference).toContain('SingaporeOpenDataLicence');
    expect(publicBucket.objects.get('index.html')).toContain('not endorsed');
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    await flushScheduleNotifications(archive.r2, 'dummy', request);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      event_type: 'gtfs_capture',
      client_payload: { capture_key: key },
    });
    await publishCapture(
      { ...capture, capture_id: 'later', retrieved_at: '2026-10-13T00:00:00Z' },
      archive.r2,
      publicBucket.r2,
    );
    await flushScheduleNotifications(archive.r2, 'dummy', request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(publicBucket.objects.get(key)))).toEqual(receipt);
  });
  it('retains failed notifications for retry and never notifies for partial publication', async () => {
    const archive = bucket();
    const publicBucket = bucket();
    archive.objects.set(capture.archive_ref, new Uint8Array([80, 75, 3, 4]));
    publicBucket.api.put.mockRejectedValueOnce(new Error('storage failure'));
    await expect(
      publishCapture(capture, archive.r2, publicBucket.r2),
    ).rejects.toThrow();
    expect(
      [...archive.objects.keys()].some((key) =>
        key.startsWith('notifications/'),
      ),
    ).toBe(false);
    await publishCapture(capture, archive.r2, publicBucket.r2);
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      flushScheduleNotifications(archive.r2, 'dummy', request),
    ).rejects.toThrow('notifications failed');
    expect(archive.objects.has(`notifications/pending/${hash}.json`)).toBe(
      true,
    );
    await flushScheduleNotifications(archive.r2, 'dummy', request);
    expect(archive.objects.has(`notifications/pending/${hash}.json`)).toBe(
      false,
    );
  });
  it('does not publish arbitrary datasets or trigger canonical ingestion for realtime files', async () => {
    const archive = bucket();
    const publicBucket = bucket();
    await expect(
      publishCapture(
        { ...capture, feed_kind: 'other' },
        archive.r2,
        publicBucket.r2,
      ),
    ).rejects.toThrow('known LTA');
    const realtime = {
      ...capture,
      feed_kind: 'trip_updates',
      source:
        'https://datamall2.mytransport.sg/ltaodataservice/GTFSRealtimeTrainTripUpdates',
      archive_ref: `blobs/trip_updates/${hash}.pb`,
    };
    archive.objects.set(realtime.archive_ref, new Uint8Array([10, 1, 2]));
    await publishCapture(realtime, archive.r2, publicBucket.r2);
    expect(
      [...archive.objects.keys()].some((key) =>
        key.startsWith('notifications/'),
      ),
    ).toBe(false);
  });
});
