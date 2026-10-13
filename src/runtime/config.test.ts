import { S3Client } from '@aws-sdk/client-s3';
import { beforeEach, expect, it, vi } from 'vitest';
import { createEnvironment, rootUrl } from './config';

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...actual,
    S3Client: vi.fn(
      class {
        send = vi.fn();
      },
    ),
  };
});
beforeEach(() => vi.clearAllMocks());
const values = {
  TWITTER_BEARER_TOKEN: 'synthetic-twitter',
  GITHUB_ACCESS_TOKEN: 'synthetic-github',
  SNAPSHOTS_S3_ENDPOINT: 'https://private.example.test',
  SNAPSHOTS_S3_REGION: 'auto',
  SNAPSHOTS_S3_BUCKET: 'private-snapshots',
  SNAPSHOTS_S3_ACCESS_KEY_ID: 'synthetic-private-key',
  SNAPSHOTS_S3_SECRET_ACCESS_KEY: 'synthetic-private-secret',
  GTFS_PUBLIC_S3_ENDPOINT: 'https://public.example.test',
  GTFS_PUBLIC_S3_REGION: 'auto',
  GTFS_PUBLIC_S3_BUCKET: 'public-snapshots',
  GTFS_PUBLIC_S3_ACCESS_KEY_ID: 'synthetic-public-key',
  GTFS_PUBLIC_S3_SECRET_ACCESS_KEY: 'synthetic-public-secret',
};

it.each([
  'http://example.test',
  'https://secret@example.test',
  'https://example.test/path',
  'https://example.test/?q=secret',
])('rejects an unsafe destination origin %s', (value) => {
  expect(() => rootUrl(value)).toThrow();
});
it('does not fall back to ambient or the other bucket credentials', () => {
  expect(() =>
    createEnvironment({ ...values, GTFS_PUBLIC_S3_ACCESS_KEY_ID: '' }),
  ).toThrow('GTFS_PUBLIC_S3_ACCESS_KEY_ID');
});
it('creates independently authenticated S3 clients for private and public storage', () => {
  createEnvironment(values);
  expect(vi.mocked(S3Client).mock.calls.map((call) => call[0])).toEqual([
    expect.objectContaining({
      endpoint: values.SNAPSHOTS_S3_ENDPOINT,
      credentials: {
        accessKeyId: values.SNAPSHOTS_S3_ACCESS_KEY_ID,
        secretAccessKey: values.SNAPSHOTS_S3_SECRET_ACCESS_KEY,
      },
    }),
    expect.objectContaining({
      endpoint: values.GTFS_PUBLIC_S3_ENDPOINT,
      credentials: {
        accessKeyId: values.GTFS_PUBLIC_S3_ACCESS_KEY_ID,
        secretAccessKey: values.GTFS_PUBLIC_S3_SECRET_ACCESS_KEY,
      },
    }),
  ]);
});
it('rejects credential-bearing storage URLs', () => {
  expect(() =>
    createEnvironment({
      ...values,
      SNAPSHOTS_S3_ENDPOINT: 'https://secret@example.test',
    }),
  ).toThrow('SNAPSHOTS_S3_ENDPOINT must use HTTPS without credentials');
});
