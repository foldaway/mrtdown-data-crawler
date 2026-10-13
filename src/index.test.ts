import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  REALTIME_CRON: '*/2 * * * *',
} as Env;
const ctx = {} as ExecutionContext;
beforeEach(() => vi.clearAllMocks());
describe('scheduled routing', () => {
  it.each([env.SCHEDULE_CRON, env.REALTIME_CRON])(
    'routes %s only to DataMall',
    async (cron) => {
      const controller = { cron } as ScheduledController;
      await app.scheduled(controller, env, ctx);
      expect(poll).toHaveBeenCalledWith(controller, env);
      expect(evidenceCrawler.scheduled).not.toHaveBeenCalled();
    },
  );
  it.each(['0,5,10,15,20,25,30,35,40,45,50,55 * * * *', ''])(
    'preserves evidence routing for %s',
    async (cron) => {
      const controller = { cron } as ScheduledController;
      await app.scheduled(controller, env, ctx);
      expect(evidenceCrawler.scheduled).toHaveBeenCalledWith(
        controller,
        env,
        ctx,
      );
      expect(poll).not.toHaveBeenCalled();
    },
  );
});

it('runs all due pipelines through one trigger and isolates failures', async () => {
  vi.mocked(evidenceCrawler.scheduled).mockRejectedValueOnce(
    new Error('evidence failure'),
  );
  await expect(
    app.scheduled(
      {
        cron: '* * * * *',
        scheduledTime: Date.parse('2026-10-12T20:00:00Z'),
      } as ScheduledController,
      env,
      ctx,
    ),
  ).rejects.toThrow('pipelines failed');
  expect(evidenceCrawler.scheduled).toHaveBeenCalledTimes(1);
  expect(poll).toHaveBeenCalledTimes(2);
});
