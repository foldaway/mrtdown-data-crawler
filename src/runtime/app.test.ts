import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';
import { createApp } from './app';

const root = 'https://crawler.example.test';
const key = 'synthetic-current-key';
function signedRequest(
  path = '/internal/jobs/realtime',
  body = '{}',
  signingKey = key,
  validitySeconds = 60,
) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'Upstash',
      sub: `${root}${path}`,
      iat: now,
      nbf: now - 1,
      exp: now + validitySeconds,
      body: createHash('sha256').update(body).digest('base64url'),
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', signingKey)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return new Request(`${root}${path}`, {
    method: 'POST',
    body,
    headers: { 'upstash-signature': `${header}.${payload}.${signature}` },
  });
}
function setup(enabled = true) {
  const run = vi.fn().mockResolvedValue(undefined);
  const reportError = vi.fn();
  const app = createApp({
    rootUrl: root,
    currentSigningKey: key,
    nextSigningKey: 'synthetic-next-key',
    enabled,
    run,
    reportError,
  });
  return { run, reportError, app, handle: app.fetch };
}

it('serves health without invoking a collector', async () => {
  const { handle, run } = setup();
  expect((await handle(new Request(`${root}/healthz`))).status).toBe(200);
  expect(run).not.toHaveBeenCalled();
});
it('verifies signatures with either rotation key', async () => {
  const { handle, run } = setup();
  expect((await handle(signedRequest())).status).toBe(204);
  expect(
    (
      await handle(
        signedRequest('/internal/jobs/schedule', '{}', 'synthetic-next-key'),
      )
    ).status,
  ).toBe(204);
  expect(run.mock.calls).toEqual([['realtime'], ['schedule']]);
});
it('rejects missing signatures, altered bodies and cross-endpoint signatures', async () => {
  const { handle, run } = setup();
  const unsigned = new Request(`${root}/internal/jobs/realtime`, {
    method: 'POST',
    body: '{}',
  });
  expect((await handle(unsigned)).status).toBe(401);
  const signed = signedRequest();
  expect(
    (
      await handle(
        new Request(signed.url, {
          method: 'POST',
          headers: signed.headers,
          body: '{"tampered":true}',
        }),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await handle(
        new Request(`${root}/internal/jobs/evidence`, {
          method: 'POST',
          headers: signed.headers,
          body: '{}',
        }),
      )
    ).status,
  ).toBe(401);
  expect(run).not.toHaveBeenCalled();
});
it('keeps disabled jobs retryable and does not perform collection', async () => {
  const { handle, run } = setup(false);
  expect((await handle(signedRequest())).status).toBe(503);
  expect(run).not.toHaveBeenCalled();
});
it('waits for work and prevents an overlapping job on this process', async () => {
  const { handle, run } = setup();
  let finish!: () => void;
  run.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = handle(signedRequest());
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  expect((await handle(signedRequest())).status).toBe(429);
  finish();
  expect((await first).status).toBe(204);
});
it('returns failures for retry and releases the active-job guard', async () => {
  const { handle, run, reportError } = setup();
  run.mockRejectedValueOnce(new Error('signed-url-secret'));
  const failed = await handle(signedRequest());
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toContain('secret');
  expect(reportError).toHaveBeenCalledWith('realtime');
  expect((await handle(signedRequest())).status).toBe(204);
});

it('keeps routing exact and accepts only POST for known jobs', async () => {
  const { handle, run } = setup();
  for (const path of [
    '/missing',
    '/internal/jobs/unknown',
    '/internal/jobs/realtime/',
    '/internal/jobs/realtime?unexpected=true',
  ]) {
    expect(
      (await handle(new Request(`${root}${path}`, { method: 'POST' }))).status,
    ).toBe(404);
  }
  for (const method of ['GET', 'HEAD', 'PUT', 'OPTIONS']) {
    expect(
      (await handle(new Request(`${root}/internal/jobs/realtime`, { method })))
        .status,
    ).toBe(405);
  }
  expect(
    (await handle(new Request(`${root}/healthz`, { method: 'HEAD' }))).status,
  ).toBe(404);
  expect(run).not.toHaveBeenCalled();
});
it('verifies the configured origin independently of incoming host headers', async () => {
  const { handle, run } = setup();
  const signed = signedRequest();
  const headers = new Headers(signed.headers);
  headers.set('host', 'untrusted.example');
  headers.set('x-forwarded-host', 'untrusted.example');
  expect(
    (
      await handle(
        new Request('http://localhost/internal/jobs/realtime', {
          method: 'POST',
          headers,
          body: '{}',
        }),
      )
    ).status,
  ).toBe(204);
  expect(run).toHaveBeenCalledOnce();
});
it('counts streamed bytes even with a misleading Content-Length and cancels overflow', async () => {
  const { handle, run } = setup();
  const cancel = vi.fn();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(16_384));
      controller.enqueue(new Uint8Array(1));
      // Intentionally leave the stream open: rejection must not await EOF.
    },
    cancel,
  });
  const response = await handle(
    new Request(`${root}/internal/jobs/realtime`, {
      method: 'POST',
      body,
      duplex: 'half',
      headers: { 'upstash-signature': 'invalid', 'content-length': '1' },
    } as RequestInit),
  );
  expect(response.status).toBe(413);
  expect(cancel).toHaveBeenCalledOnce();
  expect(run).not.toHaveBeenCalled();
});
it('accepts a signed body exactly at the byte limit and rejects one byte over', async () => {
  const { handle } = setup();
  expect(
    (await handle(signedRequest(undefined, 'a'.repeat(16_384)))).status,
  ).toBe(204);
  expect(
    (await handle(signedRequest(undefined, 'a'.repeat(16_385)))).status,
  ).toBe(413);
});
it('returns a sanitized response for unexpected request read failures', async () => {
  const { handle, run } = setup();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error('secret-upstream-url'));
      },
    });
    const response = await handle(
      new Request(`${root}/internal/jobs/realtime`, {
        method: 'POST',
        body,
        duplex: 'half',
        headers: { 'upstash-signature': 'invalid' },
      } as RequestInit),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('');
    expect(log).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
it('rejects a chunked oversized upload through the Node adapter before EOF', async () => {
  const { app, run } = setup();
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP address');
  try {
    const base = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/healthz`, { method: 'HEAD' })).status).toBe(
      404,
    );
    expect(
      (await fetch(`${base}/internal/jobs/realtime`, { method: 'HEAD' }))
        .status,
    ).toBe(405);
    const unsigned = await fetch(`${base}/internal/jobs/realtime`, {
      method: 'POST',
      body: '{}',
    });
    expect(unsigned.status).toBe(401);
    await unsigned.arrayBuffer();
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/internal/jobs/realtime',
          method: 'POST',
          headers: { 'upstash-signature': 'invalid' },
        },
        (response) => {
          resolve(response.statusCode ?? 0);
          response.resume();
          request.destroy();
        },
      );
      request.on('error', reject);
      request.write(Buffer.alloc(8192));
      request.write(Buffer.alloc(8193));
      // Keep upload open to prove the adapter enforces the limit while streaming.
    });
    expect(status).toBe(413);
    expect(run).not.toHaveBeenCalled();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('drains an in-flight signed job when the Node server closes', async () => {
  const { app, run } = setup();
  let finish!: () => void;
  run.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP address');
  const signed = signedRequest();
  const response = fetch(
    `http://127.0.0.1:${address.port}/internal/jobs/realtime`,
    {
      method: 'POST',
      headers: signed.headers,
      body: '{}',
    },
  );
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  let closed = false;
  const drained = new Promise<void>((resolve) =>
    server.close(() => {
      closed = true;
      resolve();
    }),
  );
  expect(closed).toBe(false);
  finish();
  expect((await response).status).toBe(204);
  await drained;
  expect(closed).toBe(true);
});

it('rejects expired QStash signatures', async () => {
  const { handle, run } = setup();
  expect((await handle(signedRequest(undefined, '{}', key, -60))).status).toBe(
    401,
  );
  expect(run).not.toHaveBeenCalled();
});
