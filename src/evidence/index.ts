import type { IngestContent } from '@mrtdown/ingest-contracts';
import { DateTime } from 'luxon';
import type { Env } from '../env';
import { fetchRssFeeds } from '../sources/rss';
import { fetchTwitterFeeds } from '../sources/twitter';
import { buildRepositoryDispatchPayload } from '../util/repositoryDispatchPayload';

export async function crawlEvidence(
  env: Env,
  cutoffDateTime = DateTime.now().minus({ minutes: 5 }),
) {
  const content: IngestContent[] = [];
  content.push(...(await fetchRssFeeds(cutoffDateTime)));
  content.push(
    ...(await fetchTwitterFeeds(env.TWITTER_BEARER_TOKEN, cutoffDateTime)),
  );

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
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${env.GITHUB_ACCESS_TOKEN}`,
        'User-Agent': 'mrtdown-data-crawler/1.0',
      },
      body: dispatchPayload.body,
    },
  );
  await response.body?.cancel();
  if (!response.ok) throw new Error('Evidence dispatch failed');
}

function redactContentForLog(content: IngestContent): IngestContent | object {
  if (content.source !== 'news-website' || content.articleText == null) {
    return content;
  }

  return {
    ...content,
    articleText: `[${content.articleText.length} chars redacted]`,
  };
}
