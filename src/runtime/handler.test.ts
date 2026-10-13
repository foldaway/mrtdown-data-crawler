import { createHash, createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createHandler } from './handler';

const root = 'https://crawler.example.test';
const key = 'synthetic-current-key';
function signedRequest(
  path = '/internal/jobs/realtime',
  body = '{}',
  signingKey = key,
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
      exp: now + 60,
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
  const handle = createHandler({
    rootUrl: root,
    currentSigningKey: key,
    nextSigningKey: 'synthetic-next-key',
    enabled,
    run,
    reportError,
  });
  return { run, reportError, handle };
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
