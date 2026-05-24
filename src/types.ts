import type {
  IngestContentNewsArticle,
  IngestContentNewsArticleTextSource,
  IngestContentReddit,
  IngestContentTwitter,
} from '@mrtdown/ingest-contracts';

export type ArticleTextSource = IngestContentNewsArticleTextSource;

export type CrawlerIngestContent =
  | IngestContentTwitter
  | IngestContentReddit
  | IngestContentNewsArticle;
