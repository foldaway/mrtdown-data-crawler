export type TweetField =
  | 'article'
  | 'attachments'
  | 'author_id'
  | 'card_uri'
  | 'community_id'
  | 'context_annotations'
  | 'conversation_id'
  | 'created_at'
  | 'display_text_range'
  | 'edit_controls'
  | 'edit_history_tweet_ids'
  | 'entities'
  | 'geo'
  | 'id'
  | 'in_reply_to_user_id'
  | 'lang'
  | 'media_metadata'
  | 'non_public_metrics'
  | 'note_tweet'
  | 'organic_metrics'
  | 'possibly_sensitive'
  | 'promoted_metrics'
  | 'public_metrics'
  | 'referenced_tweets'
  | 'reply_settings'
  | 'scopes'
  | 'source'
  | 'text'
  | 'withheld';

export type UserFields =
  | 'affiliation'
  | 'confirmed_email'
  | 'connection_status'
  | 'created_at'
  | 'description'
  | 'entities'
  | 'id'
  | 'is_identity_verified'
  | 'location'
  | 'most_recent_tweet_id'
  | 'name'
  | 'parody'
  | 'pinned_tweet_id'
  | 'profile_banner_url'
  | 'profile_image_url'
  | 'protected'
  | 'public_metrics'
  | 'receives_your_dm'
  | 'subscription'
  | 'subscription_type'
  | 'url'
  | 'username'
  | 'verified'
  | 'verified_followers_count'
  | 'verified_type'
  | 'withheld';

export type Expansion =
  | 'article.cover_media'
  | 'article.media_entities'
  | 'attachments.media_keys'
  | 'attachments.media_source_tweet'
  | 'attachments.poll_ids'
  | 'author_id'
  | 'edit_history_tweet_ids'
  | 'entities.mentions.username'
  | 'geo.place_id'
  | 'in_reply_to_user_id'
  | 'entities.note.mentions.username'
  | 'referenced_tweets.id'
  | 'referenced_tweets.id.attachments.media_keys'
  | 'referenced_tweets.id.author_id';

export interface Tweet {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
}

export type SortOrder = 'recency' | 'relevancy';

export interface User {
  id: string;
  username: string;
}

export interface TwitterRecentSearchResponse {
  data?: Tweet[];
  includes?: {
    users: User[];
  };
  meta: {
    newest_id: string;
    oldest_id: string;
    result_count: number;
    next_token?: string;
  };
}
