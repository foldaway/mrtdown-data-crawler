import * as Sentry from '@sentry/cloudflare';
import { poll } from './datamall/poll';
import { evidenceCrawler } from './evidence';
import { EVIDENCE_CRON, MASTER_CRON, dueJobs } from './scheduling';

export const app = {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    if (controller.cron === MASTER_CRON) {
      const due = dueJobs(controller.scheduledTime);
      const tasks: Promise<void>[] = [];
      const forCron = (cron: string) => ({ ...controller, cron });
      if (due.evidence)
        tasks.push(evidenceCrawler.scheduled(forCron(EVIDENCE_CRON), env, ctx));
      if (due.schedule) tasks.push(poll(forCron(env.SCHEDULE_CRON), env));
      if (due.realtime) tasks.push(poll(forCron(env.REALTIME_CRON), env));
      const results = await Promise.allSettled(tasks);
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('One or more crawler pipelines failed');
      }
      return;
    }
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
