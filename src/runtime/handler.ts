import { Receiver } from '@upstash/qstash';
import { rootUrl } from './config';
import { type JobName, jobNames } from './jobs';

export interface HandlerOptions {
  rootUrl: string;
  currentSigningKey: string;
  nextSigningKey: string;
  enabled: boolean;
  run: (job: JobName) => Promise<void>;
  reportError: (job: JobName) => void;
}

/** Verify the raw body and configured destination, never proxy-supplied host headers. */
export function createHandler(options: HandlerOptions) {
  const origin = rootUrl(options.rootUrl);
  const receiver = new Receiver({
    currentSigningKey: options.currentSigningKey,
    nextSigningKey: options.nextSigningKey,
  });
  const active = new Set<JobName>();
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === '/healthz' && request.method === 'GET')
      return new Response('ok');
    if (new URL(request.url).search) return new Response(null, { status: 404 });
    const job = jobNames.find((name) => path === `/internal/jobs/${name}`);
    if (!job) return new Response(null, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const signature = request.headers.get('upstash-signature');
    if (!signature) return new Response(null, { status: 401 });
    const body = await request.text();
    if (Buffer.byteLength(body) > 16_384)
      return new Response(null, { status: 413 });
    try {
      if (
        !(await receiver.verify({ signature, body, url: `${origin}${path}` }))
      ) {
        return new Response(null, { status: 401 });
      }
    } catch {
      return new Response(null, { status: 401 });
    }
    // Disabled deployment returns a retryable failure rather than discarding jobs.
    if (!options.enabled) return new Response(null, { status: 503 });
    if (active.has(job))
      return new Response(null, {
        status: 429,
        headers: { 'Retry-After': '30' },
      });
    active.add(job);
    try {
      await options.run(job);
      return new Response(null, { status: 204 });
    } catch {
      options.reportError(job);
      return new Response(null, { status: 500 });
    } finally {
      active.delete(job);
    }
  };
}
