import * as Sentry from '@sentry/cloudflare';
import { poll } from './datamall/poll';
import { evidenceCrawler } from './evidence';

export const app = {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    const tasks = [evidenceCrawler.scheduled(controller, env, ctx)];
    tasks.push(poll({ cron: env.REALTIME_CRON }, env));

    // The existing five-minute trigger includes 20:00 UTC (04:00 Singapore).
    // Use the scheduled instant because Cloudflare may deliver the event late.
    const scheduled = new Date(controller.scheduledTime);
    if (scheduled.getUTCHours() === 20 && scheduled.getUTCMinutes() === 0) {
      tasks.push(poll({ cron: env.SCHEDULE_CRON }, env));
    }
    const results = await Promise.allSettled(tasks);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('One or more crawler pipelines failed');
    }
  },
} satisfies ExportedHandler<Env>;

export default Sentry.withSentry(
  (env) => ({
    dsn: env.SENTRY_DSN,
    release: env.CF_VERSION_METADATA?.id ?? undefined,
    environment: env.ENVIRONMENT,
    sendDefaultPii: true,
  }),
  app,
);
