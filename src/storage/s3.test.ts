import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { expect, it, vi } from 'vitest';
import { s3Bucket } from './s3';

it('preserves content types and first-writer receipt creation', async () => {
  const send = vi.fn().mockResolvedValue({});
  const bucket = s3Bucket({ send } as unknown as S3Client, 'public');
  await bucket.put('receipt.json', '{}', {
    httpMetadata: { contentType: 'application/json' },
    onlyIf: { etagDoesNotMatch: '*' },
  });
  expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
  expect(send.mock.calls[0][0].input).toMatchObject({
    Bucket: 'public',
    Key: 'receipt.json',
    Body: '{}',
    ContentType: 'application/json',
    IfNoneMatch: '*',
  });
  send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 412 } });
  await expect(
    bucket.put('receipt.json', '{}', {
      onlyIf: { etagDoesNotMatch: '*' },
    }),
  ).resolves.toBeNull();
});

it('distinguishes a missing object from credentials or service failures', async () => {
  const send = vi
    .fn()
    .mockRejectedValue({ $metadata: { httpStatusCode: 404 } });
  const bucket = s3Bucket({ send } as unknown as S3Client, 'private');
  await expect(bucket.head('missing')).resolves.toBeNull();
  await expect(bucket.get('missing')).resolves.toBeNull();
  send.mockRejectedValue({
    $metadata: { httpStatusCode: 403 },
    message: 'secret',
  });
  await expect(bucket.head('missing')).rejects.toThrow(
    'Object metadata request failed',
  );
  await expect(bucket.get('missing')).rejects.toThrow('Object download failed');
});

it('downloads original bytes and limits notification listings', async () => {
  const bytes = new Uint8Array([80, 75, 3, 4]);
  const send = vi
    .fn()
    .mockResolvedValueOnce({
      Body: { transformToByteArray: async () => bytes },
    })
    .mockResolvedValueOnce({
      Contents: [{ Key: 'notifications/pending/a.json' }],
    });
  const bucket = s3Bucket({ send } as unknown as S3Client, 'private');
  await expect(bucket.get('blob.zip')).resolves.toEqual({ body: bytes });
  await expect(
    bucket.list({ prefix: 'notifications/pending/', limit: 20 }),
  ).resolves.toEqual({
    objects: [{ key: 'notifications/pending/a.json' }],
  });
  expect(send.mock.calls[1][0].input).toMatchObject({
    Bucket: 'private',
    Prefix: 'notifications/pending/',
    MaxKeys: 20,
  });
});
