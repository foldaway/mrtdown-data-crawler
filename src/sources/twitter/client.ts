import type {
  Expansion,
  SortOrder,
  TweetField,
  TwitterRecentSearchResponse,
  UserFields,
} from './types';

export class TwitterClient {
  private readonly bearerToken: string;

  constructor(bearerToken: string) {
    this.bearerToken = bearerToken;
  }

  async recentSearch(
    query: string,
    tweetFields: TweetField[] = ['id', 'text', 'created_at'],
    userFields: UserFields[] = ['id', 'username'],
    expansions: Expansion[] = ['author_id'],
    sortOrder: SortOrder = 'recency',
    maxResults = 10,
  ): Promise<TwitterRecentSearchResponse> {
    const url = new URL('https://api.twitter.com/2/tweets/search/recent');
    url.searchParams.set('query', query);
    url.searchParams.set('max_results', maxResults.toString());
    url.searchParams.set('tweet.fields', tweetFields.join(','));
    url.searchParams.set('user.fields', userFields.join(','));
    url.searchParams.set('expansions', expansions.join(','));
    url.searchParams.set('sort_order', sortOrder);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        'User-Agent': 'User-Agent: curl/7.54.1',
      },
    });

    if (!response.ok) {
      throw new Error(`Error fetching tweets: ${response.statusText}`);
    }

    return response.json();
  }
}
