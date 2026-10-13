import * as Sentry from '@sentry/cloudflare';
import { poll } from './datamall/poll';
import { evidenceCrawler } from './evidence';

export const app = {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    if (
      controller.cron === env.SCHEDULE_CRON ||
      controller.cron === env.REALTIME_CRON
    ) {
      await poll(controller, env);
      return;
    }
    await evidenceCrawler.scheduled(controller, env, ctx);
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
