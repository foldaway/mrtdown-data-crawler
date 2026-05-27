import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/sources/twitter/client';

describe('TwitterClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a full start timestamp to recent search', async () => {
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify({
            meta: {
              newest_id: '2',
              oldest_id: '1',
              result_count: 0,
            },
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new TwitterClient('token');

    await client.recentSearch(
      'from:SMRT_Singapore train',
      '2026-05-26T16:40:00Z',
    );

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (requestUrl == null) {
      throw new Error('Expected fetch to be called');
    }
    const url = new URL(requestUrl.toString());

    expect(url.searchParams.get('query')).toBe('from:SMRT_Singapore train');
    expect(url.searchParams.get('start_time')).toBe('2026-05-26T16:40:00Z');
  });
});
