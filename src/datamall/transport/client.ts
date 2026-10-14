import { type HttpDependencies, boundedBytes, request } from './http';

export const datamallBase = 'https://datamall2.mytransport.sg/ltaodataservice/';
const LINK_RESPONSE_MAX_BYTES = 64 * 1024;

interface DownloadOptions {
  endpoint: string;
  accountKey: string;
  downloadHosts: readonly string[];
  maxBytes: number;
  dependencies: HttpDependencies;
}

function parseDownloadLink(bytes: ArrayBuffer): string {
  let link: unknown;
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      value?: { link?: unknown; Link?: unknown }[];
    };
    const record = payload.value?.[0];
    // Live GTFS responses use lowercase `link`; older linked datasets use `Link`.
    if (
      record?.link !== undefined &&
      record.Link !== undefined &&
      record.link !== record.Link
    ) {
      throw new Error('Conflicting DataMall links');
    }
    link = record?.link ?? record?.Link;
  } catch {
    throw new Error('Invalid DataMall link response');
  }
  if (typeof link !== 'string') {
    throw new Error('Missing DataMall download link');
  }
  return link;
}

function validateDownloadUrl(
  link: string,
  allowedHosts: readonly string[],
): URL {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error('Invalid download URL');
  }
  if (
    url.protocol !== 'https:' ||
    !allowedHosts.includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new Error('Untrusted download destination');
  }
  return url;
}

export async function downloadDataset(
  options: DownloadOptions,
): Promise<ArrayBuffer> {
  const { endpoint, accountKey, downloadHosts, maxBytes, dependencies } =
    options;
  if (!accountKey.trim()) {
    throw new Error('Account key is required');
  }

  const source = datamallBase + endpoint;
  const linkResponse = await request(source, accountKey, dependencies);
  const linkBytes = await boundedBytes(linkResponse, LINK_RESPONSE_MAX_BYTES);
  const downloadUrl = validateDownloadUrl(
    parseDownloadLink(linkBytes),
    downloadHosts,
  );

  // The signed file download never receives the DataMall account key.
  const response = await request(downloadUrl.toString(), null, dependencies);
  return boundedBytes(response, maxBytes);
}
