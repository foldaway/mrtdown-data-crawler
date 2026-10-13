import { createServer } from 'node:http';
import * as Sentry from '@sentry/node';
import { createEnvironment, required } from './runtime/config';
import { createHandler } from './runtime/handler';
import { runJob } from './runtime/jobs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  release: process.env.GIT_SHA,
  beforeBreadcrumb: () => null,
  environment: process.env.ENVIRONMENT ?? 'development',
});
const enabled = process.env.CRAWLER_ENABLED === 'true';
const env = enabled ? createEnvironment(process.env) : null;
const handler = createHandler({
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
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 16_384) {
        outgoing.writeHead(413).end();
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value)
        headers.set(name, Array.isArray(value) ? value.join(',') : value);
    }
    const method = incoming.method ?? 'GET';
    const request = new Request(
      new URL(incoming.url ?? '/', process.env.CRAWLER_ROOT_URL),
      {
        method,
        headers,
        body:
          method === 'GET' || method === 'HEAD'
            ? undefined
            : Buffer.concat(chunks),
      },
    );
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500).end();
  }
});
server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await Sentry.close(2_000);
      process.exit(0);
    });
  });
}
