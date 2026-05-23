import type { IngestContent } from '../types';

const REPOSITORY_DISPATCH_EVENT_TYPE = 'ingest';
const GITHUB_REPOSITORY_DISPATCH_MAX_CHARS = 65_535;
const REPOSITORY_DISPATCH_PAYLOAD_TARGET_CHARS = 60_000;
const ARTICLE_TEXT_TRUNCATION_MARKER =
  '\n\n[truncated to fit repository_dispatch payload]';
const MIN_TRUNCATED_ARTICLE_TEXT_CHARS = 500;

type RepositoryDispatchPayload = {
  event_type: typeof REPOSITORY_DISPATCH_EVENT_TYPE;
  client_payload: {
    content: IngestContent[];
  };
};

export type BuiltRepositoryDispatchPayload = {
  content: IngestContent[];
  body: string;
  truncated: boolean;
};

export function buildRepositoryDispatchPayload(
  content: IngestContent[],
  maxChars = REPOSITORY_DISPATCH_PAYLOAD_TARGET_CHARS,
): BuiltRepositoryDispatchPayload {
  const effectiveMaxChars = Math.min(
    maxChars,
    GITHUB_REPOSITORY_DISPATCH_MAX_CHARS,
  );
  let dispatchContent = content;
  let body = stringifyRepositoryDispatchPayload(dispatchContent);

  if (body.length <= effectiveMaxChars) {
    return {
      content: dispatchContent,
      body,
      truncated: false,
    };
  }

  dispatchContent = content.map((item) => ({ ...item }));
  let truncated = false;

  while (body.length > effectiveMaxChars) {
    const index = findLargestArticleTextIndex(dispatchContent);
    if (index == null) {
      break;
    }

    const item = dispatchContent[index];
    if (item.source !== 'news-website' || item.articleText == null) {
      break;
    }

    const overage = Math.max(
      body.length - effectiveMaxChars,
      body.length - GITHUB_REPOSITORY_DISPATCH_MAX_CHARS,
    );
    const targetLength =
      item.articleText.length -
      overage -
      ARTICLE_TEXT_TRUNCATION_MARKER.length -
      256;

    if (targetLength < MIN_TRUNCATED_ARTICLE_TEXT_CHARS) {
      item.articleText = undefined;
      item.articleTextSource = undefined;
      item.articleTextFetchedAt = undefined;
    } else {
      item.articleText = `${item.articleText
        .slice(0, targetLength)
        .trimEnd()}${ARTICLE_TEXT_TRUNCATION_MARKER}`;
    }

    truncated = true;
    body = stringifyRepositoryDispatchPayload(dispatchContent);
  }

  if (body.length > effectiveMaxChars) {
    throw new Error(
      `repository_dispatch payload is too large after trimming optional article text: ${body.length} chars > ${effectiveMaxChars} chars`,
    );
  }

  return {
    content: dispatchContent,
    body,
    truncated,
  };
}

function stringifyRepositoryDispatchPayload(content: IngestContent[]): string {
  const payload: RepositoryDispatchPayload = {
    event_type: REPOSITORY_DISPATCH_EVENT_TYPE,
    client_payload: {
      content,
    },
  };

  return JSON.stringify(payload);
}

function findLargestArticleTextIndex(content: IngestContent[]): number | null {
  let largestIndex: number | null = null;
  let largestLength = 0;

  for (const [index, item] of content.entries()) {
    if (item.source !== 'news-website' || item.articleText == null) {
      continue;
    }

    if (item.articleText.length > largestLength) {
      largestIndex = index;
      largestLength = item.articleText.length;
    }
  }

  return largestIndex;
}
