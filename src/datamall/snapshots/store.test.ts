import { expect, it, vi } from 'vitest';
import { archiveSnapshot } from './store';

it('uses dataset identity and extension without assuming a GTFS payload', async () => {
  const put = vi.fn(async (_key: string, _value: ArrayBuffer | string) => {});
  const bytes = new TextEncoder().encode('example').buffer;
  const capture = await archiveSnapshot(
    {
      kind: 'example_dataset',
      extension: 'csv',
      source: 'https://example.test/dataset',
    },
    bytes,
    { head: async () => null, put },
    { uuid: () => 'id', now: () => new Date('2026-10-12T00:00:00Z') },
  );
  expect(capture.archive_ref).toMatch(
    /^blobs\/example_dataset\/[a-f0-9]{64}\.csv$/,
  );
  expect(capture.source).toBe('https://example.test/dataset');
  expect(put.mock.calls.map((call) => call[0])).toEqual([
    capture.archive_ref,
    'captures/example_dataset/2026-10-12T00:00:00.000Z/id.json',
  ]);
});
it('never publishes a capture record after blob write failure', async () => {
  const put = vi.fn(async () => {
    throw new Error('unavailable');
  });
  await expect(
    archiveSnapshot(
      { kind: 'test', extension: 'bin', source: 'test' },
      new ArrayBuffer(1),
      { head: async () => null, put },
      { uuid: () => 'id', now: () => new Date() },
    ),
  ).rejects.toThrow('unavailable');
  expect(put).toHaveBeenCalledTimes(1);
});
