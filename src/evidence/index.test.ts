import { afterEach, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { fetchRssFeeds } from '../sources/rss';
import { fetchTwitterFeeds } from '../sources/twitter';
import { crawlEvidence } from './index';

vi.mock('../sources/rss', () => ({ fetchRssFeeds: vi.fn() }));
vi.mock('../sources/twitter', () => ({ fetchTwitterFeeds: vi.fn() }));
const env = {
  GITHUB_ACCESS_TOKEN: 'synthetic',
  TWITTER_BEARER_TOKEN: 'synthetic',
} as Env;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('keeps the evidence dispatch contract and reports failed delivery for retry', async () => {
  vi.mocked(fetchRssFeeds).mockResolvedValue([
    {
      source: 'news-website',
      title: 'Train delay',
      summary: 'Delay',
      url: 'https://example.test/story',
      createdAt: '2026-10-12T20:00:00Z',
    },
  ]);
  vi.mocked(fetchTwitterFeeds).mockResolvedValue([]);
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await expect(crawlEvidence(env)).rejects.toThrow('Evidence dispatch failed');
  const payload = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(payload.event_type).toBe('ingest');
  expect(payload.client_payload.content).toHaveLength(1);
});
