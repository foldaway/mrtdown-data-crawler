import { describe, expect, it, vi } from 'vitest';
import { collect } from './collector';
import { gtfsDatasets } from './datasets/gtfs';
import type { Storage } from './snapshots/store';

const link =
  'https://dmprod-datasets.s3.ap-southeast-1.amazonaws.com/train/test?secret=hidden';
function harness() {
  const objects = new Map<string, ArrayBuffer | string>();
  const storage: Storage = {
    head: vi.fn(async (key) => objects.has(key)),
    put: vi.fn(async (key, value) => {
      objects.set(key, value);
    }),
  };
  const fetcher = vi.fn<typeof fetch>();
  fetcher.mockImplementation(async (url) =>
    String(url).includes('ltaodataservice')
      ? Response.json({ value: [{ timestamp: '2026-10-13T00:00:00Z', link }] })
      : new Response(new Uint8Array([0x50, 0x4b, 3, 4])),
  );
  let id = 0;
  const dependencies = {
    fetch: fetcher,
    now: () => new Date('2026-10-12T12:00:00Z'),
    uuid: () => `capture-${++id}`,
    sleep: vi.fn(async () => {}),
  };
  return { storage, objects, fetcher, dependencies };
}
describe('collector', () => {
  it('authenticates only the link request and stores original bytes with safe provenance', async () => {
    const h = harness();
    const capture = await collect(
      gtfsDatasets.schedule,
      'dummy-key',
      h.storage,
      {
        dependencies: h.dependencies,
      },
    );
    expect(h.fetcher.mock.calls[0]?.[1]?.headers).toEqual({
      AccountKey: 'dummy-key',
      accept: 'application/json',
    });
    expect(h.fetcher.mock.calls[1]?.[1]?.headers).toEqual({});
    expect(capture.sha256).toHaveLength(64);
    expect(capture.provider_timestamp).toBeNull();
    expect(capture.feed_kind).toBe('schedule');
    expect(
      new Uint8Array(h.objects.get(capture.archive_ref) as ArrayBuffer),
    ).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]));
    expect(JSON.stringify([...h.objects])).not.toContain('dummy-key');
    expect(JSON.stringify([...h.objects])).not.toContain('secret=hidden');
  });
  it('rejects conflicting lowercase and legacy links before downloading', async () => {
    const h = harness();
    h.fetcher.mockResolvedValue(
      Response.json({ value: [{ link, Link: 'https://example.test/other' }] }),
    );
    await expect(
      collect(gtfsDatasets.schedule, 'dummy', h.storage, {
        dependencies: h.dependencies,
      }),
    ).rejects.toThrow('Invalid DataMall link response');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(h.objects.size).toBe(0);
  });
  it('deduplicates bytes but keeps every successful capture including empty realtime', async () => {
    const h = harness();
    h.fetcher.mockImplementation(async (url) =>
      String(url).includes('ltaodataservice')
        ? Response.json({ value: [{ Link: link }] })
        : new Response(new Uint8Array([10, 3, 10, 1, 50])),
    );
    const first = await collect(gtfsDatasets.trip_updates, 'dummy', h.storage, {
      dependencies: h.dependencies,
    });
    const second = await collect(
      gtfsDatasets.trip_updates,
      'dummy',
      h.storage,
      {
        dependencies: h.dependencies,
      },
    );
    expect(first.sha256).toBe(second.sha256);
    expect(first.byte_length).toBe(5);
    expect(h.objects.size).toBe(3);
  });
  it('bounds retries and leaves existing captures intact after acquisition failure', async () => {
    const h = harness();
    await collect(gtfsDatasets.schedule, 'dummy', h.storage, {
      dependencies: h.dependencies,
    });
    const previous = [...h.objects];
    h.fetcher
      .mockReset()
      .mockResolvedValue(new Response(null, { status: 503 }));
    await expect(
      collect(gtfsDatasets.schedule, 'dummy', h.storage, {
        dependencies: h.dependencies,
      }),
    ).rejects.toThrow('bounded retries');
    expect(h.fetcher).toHaveBeenCalledTimes(3);
    expect([...h.objects]).toEqual(previous);
  });
  it.each([
    'http://dmprod-datasets.s3.ap-southeast-1.amazonaws.com/a',
    'https://example.com/a',
    'https://user:password@dmprod-datasets.s3.ap-southeast-1.amazonaws.com/a',
  ])('rejects untrusted URL %s before downloading', async (url) => {
    const h = harness();
    h.fetcher.mockResolvedValue(Response.json({ value: [{ Link: url }] }));
    await expect(
      collect(gtfsDatasets.service_alerts, 'dummy', h.storage, {
        dependencies: h.dependencies,
      }),
    ).rejects.toThrow('Untrusted');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(h.objects.size).toBe(0);
  });
  it('rejects oversized and non-ZIP schedule downloads without capture records', async () => {
    const h = harness();
    await expect(
      collect(gtfsDatasets.schedule, 'dummy', h.storage, {
        dependencies: h.dependencies,
        maxBytes: 2,
      }),
    ).rejects.toThrow('size limit');
    expect(h.objects.size).toBe(0);
    h.fetcher.mockImplementation(async (url) =>
      String(url).includes('ltaodataservice')
        ? Response.json({ value: [{ Link: link }] })
        : new Response('error'),
    );
    await expect(
      collect(gtfsDatasets.schedule, 'dummy', h.storage, {
        dependencies: h.dependencies,
      }),
    ).rejects.toThrow('ZIP');
  });
  it('does not record success when blob storage fails', async () => {
    const h = harness();
    h.storage.put = vi.fn(async () => {
      throw new Error('storage down');
    });
    await expect(
      collect(gtfsDatasets.schedule, 'dummy', h.storage, {
        dependencies: h.dependencies,
      }),
    ).rejects.toThrow();
    expect(h.storage.put).toHaveBeenCalledTimes(1);
    expect(h.objects.size).toBe(0);
  });
  it('rejects zero-byte realtime bodies instead of confusing them with zero entities', async () => {
    const h = harness();
    h.fetcher.mockImplementation(async (url) =>
      String(url).includes('ltaodataservice')
        ? Response.json({ value: [{ Link: link }] })
        : new Response(new Uint8Array()),
    );
    await expect(
      collect(gtfsDatasets.trip_updates, 'dummy', h.storage, {
        dependencies: h.dependencies,
      }),
    ).rejects.toThrow('Empty download');
    expect(h.objects.size).toBe(0);
  });
  it('does not retry non-transient HTTP errors', async () => {
    const h = harness();
    h.fetcher.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(
      collect(gtfsDatasets.schedule, 'dummy', h.storage, {
        dependencies: h.dependencies,
      }),
    ).rejects.toThrow('Non-retryable');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('collects a non-GTFS linked dataset using its own validation and extension', async () => {
    const h = harness();
    const validate = vi.fn();
    const dataset = {
      kind: 'example_dataset',
      endpoint: 'ExampleDataset',
      extension: 'csv',
      downloadHosts: ['dmprod-datasets.s3.ap-southeast-1.amazonaws.com'],
      maxBytes: 1024,
      validate,
    };
    const capture = await collect(dataset, 'dummy', h.storage, {
      dependencies: h.dependencies,
    });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(capture.archive_ref).toMatch(
      /^blobs\/example_dataset\/[a-f0-9]{64}\.csv$/,
    );
    expect(capture.source).toContain('/ExampleDataset');
  });
});
