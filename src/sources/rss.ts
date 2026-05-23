import { fromHtml } from 'hast-util-from-html';
import { toMdast } from 'hast-util-to-mdast';
import { DateTime } from 'luxon';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';
import Parser from 'rss-parser';
import { isTextRailRelated } from '../helpers/isTextRailRelated';
import type { CrawlerIngestContent } from '../types';
import { assert } from '../util/assert';
import { enrichNewsArticle } from './articleEnrichment';

const TWITTER_MASTODON_RSS_FEEDS: string[] = [
  'https://mastodon.social/@ltatrainservicealerts.rss',
];

interface RedditFeed {
  subreddit: string;
  feedUrl: string;
}

const REDDIT_RSS_FEEDS: RedditFeed[] = [
  {
    subreddit: '/r/singapore',
    feedUrl:
      'https://www.reddit.com/r/singapore/search.rss?q=mrt OR train&sort=new&restrict_sr=on',
  },
];

const NEWS_RSS_FEEDS: string[] = [
  'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416',
  'https://www.straitstimes.com/news/singapore/rss.xml',
];

const NEWS_ARTICLE_ENRICHMENT_FETCH_LIMIT = 20;

export async function fetchRssFeeds(
  cutoffDateTime: DateTime,
): Promise<CrawlerIngestContent[]> {
  const results: CrawlerIngestContent[] = [];
  let remainingNewsArticleEnrichmentFetches =
    NEWS_ARTICLE_ENRICHMENT_FETCH_LIMIT;

  const parser = new Parser();

  for (const feedUrl of TWITTER_MASTODON_RSS_FEEDS) {
    console.log(`[checkRssFeeds] feedUrl=${feedUrl}`);
    try {
      const response = await fetch(feedUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        },
      });
      const feedContent = await response.text();
      const { title = '', items } = await parser.parseString(feedContent);
      console.log(`[checkRssFeeds] itemCount=${items.length}`);

      for (const item of items.reverse()) {
        const { contentSnippet, link, isoDate } = item;
        assert(contentSnippet != null);

        if (!isTextRailRelated(contentSnippet)) {
          continue;
        }

        if (isoDate == null) {
          continue;
        }

        const dateTime = DateTime.fromISO(isoDate);
        if (!dateTime.isValid) {
          console.log(
            `[checkRssFeeds] Could not parse date using ISO8601 account=${title} text=${contentSnippet} isoDate=${isoDate}`,
          );
          continue;
        }

        if (dateTime < cutoffDateTime) {
          continue;
        }

        console.log(
          `[checkRssFeeds] account=${title} text=${contentSnippet} isoDate=${isoDate}`,
        );

        const createdAt = dateTime.setZone('Asia/Singapore').toISO();
        assert(createdAt != null);

        assert(link != null);

        const content: CrawlerIngestContent = {
          source: 'mastodon',
          accountName: title,
          createdAt,
          text: contentSnippet,
          url: link,
        };

        results.push(content);
      }
    } catch (e) {
      console.error(e);
    }
  }

  for (const { subreddit, feedUrl } of REDDIT_RSS_FEEDS) {
    console.log(`[checkRssFeeds] feedUrl=${feedUrl}`);
    try {
      const response = await fetch(feedUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        },
      });
      const feedContent = await response.text();
      const { items } = await parser.parseString(feedContent);
      console.log(`[checkRssFeeds] itemCount=${items.length}`);

      for (const item of items.reverse()) {
        const { title, content: contentHtml, link, isoDate, thumbnail } = item;
        assert(title != null);
        assert(contentHtml != null);

        if (!isTextRailRelated(title) && !isTextRailRelated(contentHtml)) {
          continue;
        }

        if (isoDate == null) {
          continue;
        }

        const dateTime = DateTime.fromISO(isoDate);
        if (!dateTime.isValid) {
          console.log(
            `[checkRssFeeds] Could not parse date using ISO8601 title=${title} isoDate=${isoDate}`,
          );
          continue;
        }

        if (dateTime < cutoffDateTime) {
          continue;
        }

        console.log(`[checkRssFeeds] title=${title} isoDate=${isoDate}`);

        const createdAt = dateTime.setZone('Asia/Singapore').toISO();
        assert(createdAt != null);

        assert(link != null);

        const hast = fromHtml(contentHtml);
        const mdast = toMdast(hast);
        const markdown = toMarkdown(mdast, {
          extensions: [gfmToMarkdown()],
        });

        const content: CrawlerIngestContent = {
          source: 'reddit',
          createdAt,
          subreddit,
          title,
          selftext: markdown,
          url: link,
          thumbnailUrl: thumbnail?.[0]?.$?.url ?? null,
        };

        results.push(content);
      }
    } catch (e) {
      console.error(e);
    }
  }

  for (const feedUrl of NEWS_RSS_FEEDS) {
    console.log(`[checkRssFeeds] feedUrl=${feedUrl}`);
    try {
      const response = await fetch(feedUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        },
      });
      const feedContent = await response.text();
      const { items } = await parser.parseString(feedContent);
      console.log(`[checkRssFeeds] itemCount=${items.length}`);

      for (const item of items.reverse()) {
        const { title, contentSnippet, link, isoDate } = item;
        assert(title != null);
        assert(contentSnippet != null);

        if (!isTextRailRelated(title) && !isTextRailRelated(contentSnippet)) {
          continue;
        }

        if (isoDate == null) {
          continue;
        }

        const dateTime = DateTime.fromISO(isoDate);
        if (!dateTime.isValid) {
          console.log(
            `[checkRssFeeds] Could not parse date using ISO8601 title=${title} isoDate=${isoDate}`,
          );
          continue;
        }

        if (dateTime < cutoffDateTime) {
          continue;
        }

        console.log(`[checkRssFeeds] title=${title} isoDate=${isoDate}`);

        const createdAt = dateTime.setZone('Asia/Singapore').toISO();
        assert(createdAt != null);
        assert(link != null);

        const content: CrawlerIngestContent = {
          source: 'news-website',
          createdAt,
          title,
          summary: contentSnippet,
          url: link,
        };

        if (remainingNewsArticleEnrichmentFetches > 0) {
          remainingNewsArticleEnrichmentFetches -= 1;
          results.push({
            ...content,
            ...(await enrichNewsArticle(content)),
          });
        } else {
          console.warn(
            `[checkRssFeeds] skipped article enrichment fetch budget exhausted title=${title}`,
          );
          results.push(content);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  return results;
}
