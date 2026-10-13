export interface HttpDependencies {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}
const REQUEST_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const INITIAL_RETRY_DELAY_MS = 250;

// Error messages are deliberately fixed: response bodies and signed URLs are secrets.
export async function request(
  url: string,
  accountKey: string | null,
  dependencies: HttpDependencies,
) {
  for (let attempt = 0; attempt < REQUEST_ATTEMPTS; attempt++) {
    let response: Response | undefined;
    try {
      response = await dependencies.fetch(url, {
        headers:
          accountKey === null
            ? {}
            : { AccountKey: accountKey, accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      // Network and timeout failures retry without exposing fetch error details.
    }

    if (response) {
      if (response.ok) {
        return response;
      }
      await response.body?.cancel().catch(() => {});
      if (response.status !== 429 && response.status < 500) {
        throw new Error('Non-retryable HTTP failure');
      }
    }

    if (attempt < REQUEST_ATTEMPTS - 1) {
      await dependencies.sleep(INITIAL_RETRY_DELAY_MS * 2 ** attempt);
    }
  }
  throw new Error('Request failed after bounded retries');
}

export async function boundedBytes(
  response: Response,
  limit: number,
): Promise<ArrayBuffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (declaredLength > limit) {
    await response.body?.cancel();
    throw new Error('Download exceeds size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return new ArrayBuffer(0);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      size += chunk.value.byteLength;
      if (size > limit) {
        throw new Error('Download exceeds size limit');
      }
      chunks.push(chunk.value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error('Download body failed or exceeded size limit');
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
