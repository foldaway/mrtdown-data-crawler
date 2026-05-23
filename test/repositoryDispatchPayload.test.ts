import { describe, expect, it } from 'vitest';
import type { IngestContent } from '../src/types';
import { buildRepositoryDispatchPayload } from '../src/util/repositoryDispatchPayload';

describe('repository dispatch payload', () => {
  it('preserves article text when the payload fits', () => {
    const content = [
      newsArticle({
        articleText: 'A concise article context.',
        articleTextSource: 'publisher',
        articleTextFetchedAt: '2026-05-23T02:00:00.000Z',
      }),
    ];

    const payload = buildRepositoryDispatchPayload(content, 2_000);

    expect(payload.truncated).toBe(false);
    expect(payload.content).toEqual(content);
    expect(payload.body.length).toBeLessThanOrEqual(2_000);
  });

  it('truncates optional article text to fit the dispatch payload', () => {
    const payload = buildRepositoryDispatchPayload(
      [
        newsArticle({
          articleText: 'A'.repeat(2_000),
          articleTextSource: 'publisher',
          articleTextFetchedAt: '2026-05-23T02:00:00.000Z',
        }),
      ],
      1_600,
    );

    const [article] = payload.content;

    expect(payload.truncated).toBe(true);
    expect(payload.body.length).toBeLessThanOrEqual(1_600);
    expect(article.source).toBe('news-website');
    if (article.source !== 'news-website') {
      throw new Error('Expected a news article');
    }

    expect(article.title).toBe('Train service update');
    expect(article.summary).toBe('Short RSS summary');
    expect(article.articleText).toContain(
      '[truncated to fit repository_dispatch payload]',
    );
    expect(article.articleTextSource).toBe('publisher');
  });

  it('removes article text when even a truncated article would be too large', () => {
    const payload = buildRepositoryDispatchPayload(
      [
        newsArticle({
          articleText: 'A'.repeat(2_000),
          articleTextSource: 'publisher',
          articleTextFetchedAt: '2026-05-23T02:00:00.000Z',
        }),
      ],
      300,
    );

    const [article] = payload.content;

    expect(payload.truncated).toBe(true);
    expect(payload.body.length).toBeLessThanOrEqual(300);
    expect(article.source).toBe('news-website');
    if (article.source !== 'news-website') {
      throw new Error('Expected a news article');
    }

    expect(article.articleText).toBeUndefined();
    expect(article.articleTextSource).toBeUndefined();
    expect(article.articleTextFetchedAt).toBeUndefined();
  });

  it('throws when a payload is still too large without optional article text', () => {
    expect(() =>
      buildRepositoryDispatchPayload(
        [
          {
            source: 'mastodon',
            accountName: 'Transit Updates',
            text: 'A'.repeat(2_000),
            url: 'https://www.example.com/social/update',
            createdAt: '2026-05-23T02:00:00.000Z',
          },
        ],
        300,
      ),
    ).toThrow(/repository_dispatch payload is too large.*bytes/);
  });

  it('enforces the dispatch limit using UTF-8 byte length', () => {
    const payload = buildRepositoryDispatchPayload(
      [
        newsArticle({
          title: '服务更新'.repeat(10),
          summary: '受影响车站'.repeat(10),
          articleText: '列车服务已经恢复'.repeat(200),
          articleTextSource: 'publisher',
          articleTextFetchedAt: '2026-05-23T02:00:00.000Z',
        }),
      ],
      1_600,
    );

    expect(payload.truncated).toBe(true);
    expect(
      new TextEncoder().encode(payload.body).byteLength,
    ).toBeLessThanOrEqual(1_600);
  });
});

function newsArticle(
  overrides: Partial<Extract<IngestContent, { source: 'news-website' }>> = {},
): Extract<IngestContent, { source: 'news-website' }> {
  return {
    source: 'news-website',
    title: 'Train service update',
    summary: 'Short RSS summary',
    url: 'https://www.example.com/news/train-service-update',
    createdAt: '2026-05-23T02:00:00.000Z',
    ...overrides,
  };
}
