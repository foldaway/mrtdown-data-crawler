import type {
  IngestContentNewsArticle,
  IngestContentReddit,
  IngestContentTwitter,
} from '@mrtdown/ingest-contracts';

export type ArticleTextSource = 'publisher' | 'archive' | 'metadata';

export type EnrichedIngestContentNewsArticle = IngestContentNewsArticle & {
  articleText?: string;
  articleTextSource?: ArticleTextSource;
  articleTextFetchedAt?: string;
};

export type CrawlerIngestContent =
  | IngestContentTwitter
  | IngestContentReddit
  | EnrichedIngestContentNewsArticle;
