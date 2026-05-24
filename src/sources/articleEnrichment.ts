import { fromHtml } from 'hast-util-from-html';
import type { ArticleTextSource } from '../types';

const ARTICLE_FETCH_USER_AGENT =
  'mrtdown-data-crawler/1.0 (+https://github.com/foldaway/mrtdown-data-crawler; source-acquisition)';
const ARTICLE_FETCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_ARTICLE_TEXT_CHARS = 12_000;
const MIN_PARAGRAPH_CHARS = 40;

type ArticleEnrichment = {
  articleText?: string;
  articleTextSource?: ArticleTextSource;
  articleTextFetchedAt?: string;
};

type NewsArticleInput = {
  title: string;
  summary: string;
  url: string;
};

type Fetcher = typeof fetch;

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

type ArticleContext = {
  text: string;
  source: ArticleTextSource;
};

export async function enrichNewsArticle(
  article: NewsArticleInput,
  options: {
    fetcher?: Fetcher;
    now?: () => Date;
  } = {},
): Promise<ArticleEnrichment> {
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
  const metadataFallback = buildMetadataFallback(article, fetchedAt);

  if (!isHttpUrl(article.url)) {
    return metadataFallback;
  }

  try {
    const html = await fetchPublisherHtml(
      article.url,
      options.fetcher ?? fetch,
    );
    const context = extractArticleContextFromHtml(html);

    if (context != null) {
      return {
        articleText: context.text,
        articleTextSource: context.source,
        articleTextFetchedAt: fetchedAt,
      };
    }
  } catch (error) {
    console.warn(
      `[articleEnrichment] publisher fetch/extract failed url=${article.url} error=${formatError(error)}`,
    );
  }

  return metadataFallback;
}

export function extractArticleContextFromHtml(
  html: string,
): ArticleContext | null {
  const root = fromHtml(html) as HastNode;

  const jsonLdText = extractJsonLdArticleText(root);
  if (jsonLdText != null) {
    return {
      text: jsonLdText,
      source: 'publisher',
    };
  }

  const bodyText = extractArticleBodyText(root);
  if (bodyText != null) {
    return {
      text: bodyText,
      source: 'publisher',
    };
  }

  const metadataText = extractMetadataText(root);
  if (metadataText != null) {
    return {
      text: metadataText,
      source: 'metadata',
    };
  }

  return null;
}

async function fetchPublisherHtml(
  url: string,
  fetcher: Fetcher,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    ARTICLE_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetcher(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': ARTICLE_FETCH_USER_AGENT,
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const normalizedContentType = contentType.toLowerCase();
    if (
      contentType !== '' &&
      !normalizedContentType.includes('text/html') &&
      !normalizedContentType.includes('application/xhtml+xml')
    ) {
      throw new Error(`Unsupported content-type: ${contentType}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength != null && Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new Error(`Response too large: ${contentLength} bytes`);
    }

    return await readResponseTextWithLimit(response, MAX_RESPONSE_BYTES);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (response.body == null) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`Response too large: >${maxBytes} bytes`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      throw new Error(`Response too large: >${maxBytes} bytes`);
    }

    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return chunks.join('');
}

function extractJsonLdArticleText(root: HastNode): string | null {
  const scriptTexts: string[] = [];

  visit(root, (node) => {
    const type = normalizeProperty(node.properties?.type)
      .split(';', 1)[0]
      .trim()
      .toLowerCase();

    if (node.tagName === 'script' && type === 'application/ld+json') {
      const text = getTextContent(node);
      if (text !== '') {
        scriptTexts.push(text);
      }
    }
  });

  for (const scriptText of scriptTexts) {
    try {
      const json = JSON.parse(scriptText) as unknown;
      const articleObjects = collectArticleJsonLdObjects(json);

      for (const articleObject of articleObjects) {
        const text = compactText([
          readStringField(articleObject, 'headline'),
          readStringField(articleObject, 'description'),
          readStringField(articleObject, 'articleBody') ??
            readStringField(articleObject, 'text'),
        ]);

        if (isUsefulArticleText(text)) {
          return limitArticleText(text);
        }
      }
    } catch {}
  }

  return null;
}

function collectArticleJsonLdObjects(
  value: unknown,
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectArticleJsonLdObjects);
  }

  if (!isRecord(value)) {
    return [];
  }

  const matches = isArticleJsonLdType(value['@type']) ? [value] : [];

  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage']) {
    const nested = value[key];
    if (nested != null) {
      matches.push(...collectArticleJsonLdObjects(nested));
    }
  }

  return matches;
}

function isArticleJsonLdType(type: unknown): boolean {
  if (Array.isArray(type)) {
    return type.some(isArticleJsonLdType);
  }

  return (
    typeof type === 'string' &&
    ['Article', 'NewsArticle', 'ReportageNewsArticle'].includes(
      normalizeJsonLdType(type),
    )
  );
}

function normalizeJsonLdType(type: string): string {
  return (
    type
      .trim()
      .split(/[\/#:]/)
      .filter(Boolean)
      .at(-1) ?? type
  );
}

function extractMetadataText(root: HastNode): string | null {
  const title =
    findMetaContent(root, ['og:title', 'twitter:title']) ?? findTitle(root);
  const description = findMetaContent(root, [
    'og:description',
    'twitter:description',
    'description',
  ]);
  const text = compactText([title, description]);

  return text !== '' ? limitArticleText(text) : null;
}

function extractArticleBodyText(root: HastNode): string | null {
  const paragraphs: string[] = [];

  collectParagraphs(root, 0, paragraphs);

  const text = compactText(paragraphs);
  if (!isUsefulArticleText(text)) {
    return null;
  }

  return limitArticleText(text);
}

function collectParagraphs(
  node: HastNode,
  ancestorScore: number,
  paragraphs: string[],
): void {
  const score = ancestorScore + getArticleContainerScore(node);

  if (node.tagName === 'p' && score > 0) {
    const text = normalizeText(getTextContent(node));
    if (text.length >= MIN_PARAGRAPH_CHARS) {
      paragraphs.push(text);
    }
  }

  for (const child of node.children ?? []) {
    collectParagraphs(child, score, paragraphs);
  }
}

function getArticleContainerScore(node: HastNode): number {
  const tagName = node.tagName ?? '';
  const attributeText = [
    normalizeProperty(node.properties?.id),
    normalizeProperty(node.properties?.className),
    normalizeProperty(node.properties?.itemprop),
    normalizeProperty(node.properties?.role),
  ].join(' ');

  if (
    /(nav|footer|header|aside|menu|breadcrumb|related)/i.test(attributeText)
  ) {
    return -5;
  }

  let score = 0;

  if (tagName === 'article') {
    score += 4;
  }

  if (tagName === 'main') {
    score += 2;
  }

  if (
    /(article|articlebody|article-body|story|story-body|field--name-body|body-content|content)/i.test(
      attributeText,
    )
  ) {
    score += 3;
  }

  return score;
}

function findMetaContent(root: HastNode, keys: string[]): string | null {
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
  let value: string | null = null;

  visit(root, (node) => {
    if (value != null || node.tagName !== 'meta') {
      return;
    }

    const property = normalizeProperty(node.properties?.property).toLowerCase();
    const name = normalizeProperty(node.properties?.name).toLowerCase();

    if (normalizedKeys.has(property) || normalizedKeys.has(name)) {
      const content = normalizeText(
        normalizeProperty(node.properties?.content),
      );
      if (content !== '') {
        value = content;
      }
    }
  });

  return value;
}

function findTitle(root: HastNode): string | null {
  let title: string | null = null;

  visit(root, (node) => {
    if (title != null || node.tagName !== 'title') {
      return;
    }

    const text = normalizeText(getTextContent(node));
    if (text !== '') {
      title = text;
    }
  });

  return title;
}

function buildMetadataFallback(
  article: NewsArticleInput,
  fetchedAt: string,
): ArticleEnrichment {
  const text = compactText([article.title, article.summary]);

  if (text === '') {
    return {};
  }

  return {
    articleText: limitArticleText(text),
    articleTextSource: 'metadata',
    articleTextFetchedAt: fetchedAt,
  };
}

function visit(node: HastNode, callback: (node: HastNode) => void): void {
  callback(node);

  for (const child of node.children ?? []) {
    visit(child, callback);
  }
}

function getTextContent(node: HastNode): string {
  if (node.type === 'text') {
    return node.value ?? '';
  }

  if (['script', 'style', 'noscript'].includes(node.tagName ?? '')) {
    if (node.tagName === 'script') {
      return (node.children ?? []).map(getTextContent).join('');
    }

    return '';
  }

  return (node.children ?? []).map(getTextContent).join(' ');
}

function readStringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];

  if (typeof value === 'string') {
    return normalizeText(value);
  }

  if (Array.isArray(value)) {
    return compactText(
      value.flatMap((item) => (typeof item === 'string' ? [item] : [])),
    );
  }

  return null;
}

function compactText(parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const compacted: string[] = [];

  for (const part of parts) {
    const text = normalizeText(part ?? '');
    const dedupeKey = text.toLowerCase();

    if (text === '' || seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    compacted.push(text);
  }

  return compacted.join('\n\n');
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeProperty(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeProperty(item)).join(' ');
  }

  return '';
}

function isUsefulArticleText(text: string): boolean {
  return text.length >= 120 || text.split(/\s+/).length >= 20;
}

function limitArticleText(text: string): string {
  if (text.length <= MAX_ARTICLE_TEXT_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_ARTICLE_TEXT_CHARS).trimEnd()}...`;
}

function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
