import { DateTime } from 'luxon';
import { TwitterClient } from './client';
import type { IngestContent } from '../../types';
import { assert } from '../../util/assert';

export async function fetchTwitterFeeds(
  twitterBearerToken: string,
  cutoffDateTime: DateTime,
): Promise<IngestContent[]> {
  const results: IngestContent[] = [];
  const twitterClient = new TwitterClient(twitterBearerToken);

  const response = await twitterClient.recentSearch(
    '(from:SBSTransit_Ltd OR from:SMRT_Singapore) -is:retweet (MRT OR LRT OR train OR track OR line OR fault)',
  );

  console.log({ response });

  const users = response.includes?.users ?? [];
  const usersById = new Map(users.map((user) => [user.id, user]));

  for (const tweet of response.data) {
    const createdAt = DateTime.fromISO(tweet.created_at);
    if (createdAt < cutoffDateTime) {
      continue; // Skip tweets older than the cutoff date
    }

    const user = usersById.get(tweet.author_id);
    assert(user != null, `User not found for author_id=${tweet.author_id}`);

    results.push({
      source: 'twitter',
      accountName: user.username,
      text: tweet.text,
      url: `https://twitter.com/${user.username}/status/${tweet.id}`,
      createdAt: tweet.created_at,
    });
  }

  return results;
}
