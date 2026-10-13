import { beforeEach, expect, it, vi } from 'vitest';
import { poll } from './datamall/poll';
import { evidenceCrawler } from './evidence';
import { app } from './index';

vi.mock('@sentry/cloudflare', () => ({
  withSentry: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('./datamall/poll', () => ({ poll: vi.fn() }));
vi.mock('./evidence', () => ({ evidenceCrawler: { scheduled: vi.fn() } }));
const env = {
  SCHEDULE_CRON: '0 20 * * *',
  REALTIME_CRON: '0,5,10,15,20,25,30,35,40,45,50,55 * * * *',
} as Env;
const ctx = {} as ExecutionContext;
const controllerAt = (instant: string) =>
  ({
    cron: env.REALTIME_CRON,
    scheduledTime: Date.parse(instant),
  }) as ScheduledController;
beforeEach(() => vi.clearAllMocks());

it('adds realtime collection to the existing evidence run', async () => {
  const controller = controllerAt('2026-10-12T19:05:00Z');
  await app.scheduled(controller, env, ctx);
  expect(evidenceCrawler.scheduled).toHaveBeenCalledWith(controller, env, ctx);
  expect(poll).toHaveBeenCalledExactlyOnceWith(
    { cron: env.REALTIME_CRON },
    env,
  );
});

it('also collects schedules on the 04:00 Singapore run', async () => {
  await app.scheduled(controllerAt('2026-10-12T20:00:00Z'), env, ctx);
  expect(poll).toHaveBeenCalledTimes(2);
  expect(poll).toHaveBeenCalledWith({ cron: env.SCHEDULE_CRON }, env);
});

it('continues GTFS collection when evidence fails', async () => {
  vi.mocked(evidenceCrawler.scheduled).mockRejectedValueOnce(
    new Error('failure'),
  );
  await expect(
    app.scheduled(controllerAt('2026-10-12T20:00:00Z'), env, ctx),
  ).rejects.toThrow('pipelines failed');
  expect(poll).toHaveBeenCalledTimes(2);
});
