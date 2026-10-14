import { serve } from '@hono/node-server';
import * as Sentry from '@sentry/node';
import { createApp } from './runtime/app';
import { createEnvironment, required } from './runtime/config';
import { runJob } from './runtime/jobs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  release: process.env.GIT_SHA,
  beforeBreadcrumb: () => null,
  environment: process.env.ENVIRONMENT ?? 'development',
});
const enabled = process.env.CRAWLER_ENABLED === 'true';
const env = enabled ? createEnvironment(process.env) : null;
const app = createApp({
  rootUrl: required(process.env, 'CRAWLER_ROOT_URL'),
  currentSigningKey: required(process.env, 'QSTASH_CURRENT_SIGNING_KEY'),
  nextSigningKey: required(process.env, 'QSTASH_NEXT_SIGNING_KEY'),
  enabled,
  run: async (job) => {
    if (!env) throw new Error('Crawler disabled');
    await runJob(job, env);
  },
  reportError: (job) => {
    // Upstream errors can contain signed URLs, credentials or fetched content.
    console.error(JSON.stringify({ event: 'job_failed', job }));
    Sentry.captureException(new Error(`Crawler job failed: ${job}`));
  },
});
const server = serve({
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 3000),
  hostname: '0.0.0.0',
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await Sentry.close(2_000);
      process.exit(0);
    });
  });
}
