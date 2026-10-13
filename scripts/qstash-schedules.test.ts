import { expect, it, vi } from 'vitest';
import {
  managedSchedules,
  scheduleRequest,
  syncSchedules,
} from './qstash-schedules';

const origin = 'https://crawler.example.test';
it('owns only crawler schedules and preserves collection cadence', () => {
  const schedules = managedSchedules(origin);
  expect(schedules.map((x) => x.cron)).toEqual([
    '*/5 * * * *',
    '*/5 * * * *',
    '0 20 * * *',
  ]);
  expect(new Set(schedules.map((x) => x.id)).size).toBe(3);
  expect(
    schedules.every((x) => x.id.startsWith('mrtdown-crawler-production-')),
  ).toBe(true);
  const request = scheduleRequest(
    schedules[0],
    'synthetic',
    'https://qstash.example.test',
  );
  expect(request.init.headers).toMatchObject({
    'Upstash-Schedule-Id': schedules[0].id,
    'Upstash-Flow-Control-Value': 'parallelism=1',
    'Upstash-Timeout': '600s',
  });
  expect(request.init.body).toBe('{}');
});
it('reapplies deterministic IDs without listing or deleting unrelated schedules', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 200 }));
  await syncSchedules(
    origin,
    'synthetic',
    'https://qstash.example.test',
    fetcher,
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls.every((call) => call[1].method === 'POST')).toBe(
    true,
  );
});
it('stops on a provider failure without exposing its response body', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response('token-secret', { status: 403 }));
  await expect(
    syncSchedules(origin, 'synthetic', 'https://qstash.example.test', fetcher),
  ).rejects.toThrow('Schedule sync failed');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
