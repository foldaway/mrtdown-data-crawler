import { DateTime } from 'luxon';
import { fetchRssFeeds } from './sources/rss';
import { fetchTwitterFeeds } from './sources/twitter';
import type { IngestContent } from './types';
import * as Sentry from '@sentry/cloudflare';

const app = {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    let content: IngestContent[] = [];

    switch (controller.cron) {
      case '0,20,40 * * * *': {
        const cutoffDateTime = DateTime.now().minus({ minutes: 20 });
        content = await fetchTwitterFeeds(
          env.TWITTER_BEARER_TOKEN,
          cutoffDateTime,
        );
        break;
      }
      case '0,10,20,30,40,50 * * * *': {
        const cutoffDateTime = DateTime.now().minus({ minutes: 10 });
        content = await fetchRssFeeds(cutoffDateTime);
        break;
      }
      case '': {
        // Testing from dashboard code editor, run both for testing purposes.
        const cutoffDateTime = DateTime.now().minus({ minutes: 10 });
        content.push(
          ...(await fetchRssFeeds(cutoffDateTime)),
          ...(await fetchTwitterFeeds(
            env.TWITTER_BEARER_TOKEN,
            cutoffDateTime,
          )),
        );
        break;
      }
      default: {
        console.log(`[scheduled] Unhandled cron schedule: ${controller.cron}`);
        return;
      }
    }

    console.log(content);

    if (content.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    await fetch(
      'https://api.github.com/repos/foldaway/mrtdown-data/dispatches',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          event_type: 'ingest',
          client_payload: content,
        }),
      },
    );
  },
};

export default Sentry.withSentry((env) => {
  const { id: versionId } = env.CF_VERSION_METADATA;

  return {
    dsn: env.SENTRY_DSN,
    release: versionId,
    environment: env.ENVIRONMENT,
    sendDefaultPii: true,
  };
}, app);
