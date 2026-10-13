import { expect, it, vi } from 'vitest';
import { boundedBytes, request } from './http';

it('retries transient responses and forwards timeout and redirect restrictions', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response('ok'));
  const sleep = vi.fn(async (_ms: number) => {});
  expect(
    (await request('https://example.test', null, { fetch: fetcher, sleep }))
      .status,
  ).toBe(200);
  expect(sleep).toHaveBeenCalledWith(250);
  expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error');
  expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
});

it('bounds streamed content independently of the declared length', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(3));
      controller.close();
    },
  });
  await expect(boundedBytes(new Response(body), 2)).rejects.toThrow(
    'size limit',
  );
});

it('sanitizes exhausted network failures and retries with bounded backoff', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error('signed-url-secret'));
  const sleep = vi.fn(async (_ms: number) => {});
  await expect(
    request('https://example.test', null, { fetch: fetcher, sleep }),
  ).rejects.toThrow('Request failed after bounded retries');
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(sleep.mock.calls).toEqual([[250], [500]]);
});
