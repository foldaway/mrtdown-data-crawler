import * as Sentry from '@sentry/cloudflare';
import type { IngestContent } from '@mrtdown/ingest-contracts';
import { DateTime } from 'luxon';
import { fetchRssFeeds } from './sources/rss';
import { fetchTwitterFeeds } from './sources/twitter';
import { buildRepositoryDispatchPayload } from './util/repositoryDispatchPayload';

const app = {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    let content: IngestContent[] = [];

    switch (controller.cron) {
      case '0,5,10,15,20,25,30,35,40,45,50,55 * * * *': {
        const cutoffDateTime = DateTime.now().minus({ minutes: 5 });
        content.push(...(await fetchRssFeeds(cutoffDateTime)));
        content.push(
          ...(await fetchTwitterFeeds(
            env.TWITTER_BEARER_TOKEN,
            cutoffDateTime,
          )),
        );
        break;
      }
      case '': {
        // Testing from dashboard code editor, run both for testing purposes.
        const cutoffDateTime = DateTime.now().minus({ minutes: 5 });
        try {
          content.push(...(await fetchRssFeeds(cutoffDateTime)));
        } catch (e) {
          console.error(e);
        }

        try {
          content.push(
            ...(await fetchTwitterFeeds(
              env.TWITTER_BEARER_TOKEN,
              cutoffDateTime,
            )),
          );
        } catch (e) {
          console.error(e);
        }

        // Add fake content for testing purposes
        if (content.length === 0) {
          content.push({
            title: 'Test Content',
            summary: '',
            url: 'https://example.com/test-content',
            createdAt: DateTime.now().toISO(),
            source: 'news-website',
          });
        }

        break;
      }
      default: {
        console.log(`[scheduled] Unhandled cron schedule: ${controller.cron}`);
        return;
      }
    }

    if (content.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    const dispatchPayload = buildRepositoryDispatchPayload(content);
    if (dispatchPayload.truncated) {
      console.warn(
        `[scheduled] Truncated article enrichment to fit repository_dispatch payload contentCount=${content.length}`,
      );
    }

    console.log(dispatchPayload.content.map(redactContentForLog));

    const response = await fetch(
      'https://api.github.com/repos/foldaway/mrtdown-data/dispatches',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_ACCESS_TOKEN}`,
          'User-Agent': 'mrtdown-data-crawler/1.0',
        },
        body: dispatchPayload.body,
      },
    );
    console.log({ response });
    console.log(await response.text());
  },
};

function redactContentForLog(
  content: IngestContent,
): IngestContent | object {
  if (content.source !== 'news-website' || content.articleText == null) {
    return content;
  }

  return {
    ...content,
    articleText: `[${content.articleText.length} chars redacted]`,
  };
}

export default Sentry.withSentry((env) => {
  const versionId = env.CF_VERSION_METADATA?.id ?? undefined;

  return {
    dsn: env.SENTRY_DSN,
    release: versionId,
    environment: env.ENVIRONMENT,
    sendDefaultPii: true,
  };
}, app);
