import { Receiver } from '@upstash/qstash';
import { Hono } from 'hono';
import { readJobBody } from './body';
import { rootUrl } from './config';
import { type JobName, jobNames } from './jobs';

export interface AppOptions {
  rootUrl: string;
  currentSigningKey: string;
  nextSigningKey: string;
  enabled: boolean;
  run: (job: JobName) => Promise<void>;
  reportError: (job: JobName) => void;
}

/** Verify the raw body and configured destination, never proxy-supplied host headers. */
export function createApp(options: AppOptions) {
  const origin = rootUrl(options.rootUrl);
  const receiver = new Receiver({
    currentSigningKey: options.currentSigningKey,
    nextSigningKey: options.nextSigningKey,
  });
  const active = new Set<JobName>();
  const app = new Hono();
  app.notFound((c) => c.body(null, 404));
  // Hono's default error handler logs exceptions; never expose upstream details.
  app.onError((_, c) => c.body(null, 500));
  app.all('/healthz', (c) =>
    c.req.method === 'GET' ? c.text('ok') : c.body(null, 404),
  );
  for (const job of jobNames) {
    const path = `/internal/jobs/${job}`;
    app.all(path, async (c) => {
      const request = c.req.raw;
      if (new URL(request.url).search) return c.body(null, 404);
      if (request.method !== 'POST') return c.body(null, 405);
      const signature = request.headers.get('upstash-signature');
      if (!signature) return c.body(null, 401);
      const body = await readJobBody(request);
      if (body === null) return c.body(null, 413);
      try {
        if (
          !(await receiver.verify({ signature, body, url: `${origin}${path}` }))
        ) {
          return c.body(null, 401);
        }
      } catch {
        return c.body(null, 401);
      }
      // Disabled deployment returns a retryable failure rather than discarding jobs.
      if (!options.enabled) return c.body(null, 503);
      if (active.has(job)) return c.body(null, 429, { 'Retry-After': '30' });
      active.add(job);
      try {
        await options.run(job);
        return c.body(null, 204);
      } catch {
        options.reportError(job);
        return c.body(null, 500);
      } finally {
        active.delete(job);
      }
    });
  }
  return app;
}
