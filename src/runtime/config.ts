import { S3Client } from '@aws-sdk/client-s3';
import type { Env } from '../env';
import { s3Bucket } from '../storage/s3';

type Variables = Readonly<Record<string, string | undefined>>;
export function required(values: Variables, key: string): string {
  const value = values[key]?.trim();
  if (!value) throw new Error(`Missing configuration: ${key}`);
  return value;
}

export function rootUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('CRAWLER_ROOT_URL must be an HTTPS origin');
  }
  return url.origin;
}

export function createEnvironment(values: Variables): Env {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${required(values, 'R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required(values, 'R2_ACCESS_KEY_ID'),
      secretAccessKey: required(values, 'R2_SECRET_ACCESS_KEY'),
    },
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 30_000 },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return {
    TWITTER_BEARER_TOKEN: required(values, 'TWITTER_BEARER_TOKEN'),
    GITHUB_ACCESS_TOKEN: required(values, 'GITHUB_ACCESS_TOKEN'),
    LTA_DATAMALL_ACCOUNT_KEY:
      values.COLLECTION_ENABLED === 'true'
        ? required(values, 'LTA_DATAMALL_ACCOUNT_KEY')
        : '',
    COLLECTION_ENABLED: values.COLLECTION_ENABLED ?? 'false',
    GTFS_PUBLICATION_ENABLED: values.GTFS_PUBLICATION_ENABLED ?? 'false',
    GTFS_NOTIFICATION_ENABLED: values.GTFS_NOTIFICATION_ENABLED ?? 'false',
    SNAPSHOTS: s3Bucket(client, required(values, 'R2_PRIVATE_BUCKET')),
    GTFS_PUBLIC: s3Bucket(client, required(values, 'R2_PUBLIC_BUCKET')),
  };
}
