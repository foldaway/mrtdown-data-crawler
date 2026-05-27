import type { IngestContent } from '@mrtdown/ingest-contracts';
import { DateTime } from 'luxon';
import { assert } from '../../util/assert';
import { TwitterClient } from './client';

const SEARCH_QUERY =
  '(from:SBSTransit_Ltd OR from:SMRT_Singapore) -is:retweet (MRT OR LRT OR train OR track OR line OR fault)';

function toTwitterSearchTimestamp(dateTime: DateTime): string {
  return dateTime
    .toUTC()
    .set({ millisecond: 0 })
    .toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
}

export async function fetchTwitterFeeds(
  twitterBearerToken: string,
  cutoffDateTime: DateTime,
): Promise<IngestContent[]> {
  const results: IngestContent[] = [];
  const twitterClient = new TwitterClient(twitterBearerToken);
  const startTime = toTwitterSearchTimestamp(cutoffDateTime);

  console.log(
    `[fetchTwitterFeeds] query=${SEARCH_QUERY} startTime=${startTime}`,
  );

  try {
    const response = await twitterClient.recentSearch(SEARCH_QUERY, startTime);
    console.log(
      '[fetchTwitterFeeds] response=',
      JSON.stringify(response, null, 2),
    );

    const tweets = response.data ?? [];
    const meta = response.meta;
    console.log(
      `[fetchTwitterFeeds] tweetCount=${tweets.length} meta.result_count=${meta?.result_count} meta.newest_id=${meta?.newest_id} meta.oldest_id=${meta?.oldest_id} meta.next_token=${meta?.next_token ?? 'none'}`,
    );

    const users = response.includes?.users ?? [];
    const usersById = new Map(users.map((user) => [user.id, user]));
    console.log(
      `[fetchTwitterFeeds] users=${users.map((u) => u.username).join(', ')}`,
    );

    for (const tweet of tweets) {
      const createdAt = DateTime.fromISO(tweet.created_at);
      if (createdAt < cutoffDateTime) {
        console.log(
          `[fetchTwitterFeeds] skipped (before cutoff) id=${tweet.id} author_id=${tweet.author_id} createdAt=${tweet.created_at} text=${tweet.text}`,
        );
        continue; // Skip tweets older than the cutoff date
      }

      const user = usersById.get(tweet.author_id);
      assert(user != null, `User not found for author_id=${tweet.author_id}`);

      console.log(
        `[fetchTwitterFeeds] account=${user.username} id=${tweet.id} text=${tweet.text} createdAt=${tweet.created_at}`,
      );

      results.push({
        source: 'twitter',
        accountName: user.username,
        text: tweet.text,
        url: `https://twitter.com/${user.username}/status/${tweet.id}`,
        createdAt: tweet.created_at,
      });
    }

    console.log(`[fetchTwitterFeeds] resultsCount=${results.length}`);
  } catch (e) {
    console.error('[fetchTwitterFeeds]', e);
  }

  return results;
}
