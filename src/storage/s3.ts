import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { Bucket } from './bucket';

function status(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
}

/** Keep snapshot key layout and conditional receipt creation identical on Node. */
export function s3Bucket(
  client: Pick<S3Client, 'send'>,
  bucket: string,
): Bucket {
  return {
    async head(key) {
      try {
        return await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
      } catch (error) {
        if (status(error) === 404) return null;
        throw new Error('Object metadata request failed');
      }
    },
    async get(key) {
      try {
        const object = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        if (!object.Body) throw new Error('Missing object body');
        return { body: await object.Body.transformToByteArray() };
      } catch (error) {
        if (status(error) === 404) return null;
        throw new Error('Object download failed');
      }
    },
    async put(key, value, options) {
      const body =
        typeof value === 'string' || value instanceof Uint8Array
          ? value
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(await new Response(value).arrayBuffer());
      try {
        return await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: options?.httpMetadata?.contentType,
            IfNoneMatch: options?.onlyIf?.etagDoesNotMatch,
          }),
        );
      } catch (error) {
        if (options?.onlyIf && status(error) === 412) return null;
        throw new Error('Object upload failed');
      }
    },
    async list({ prefix, limit }) {
      try {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            MaxKeys: limit,
          }),
        );
        return {
          objects: (page.Contents ?? []).flatMap((object) =>
            object.Key ? [{ key: object.Key }] : [],
          ),
        };
      } catch {
        throw new Error('Object listing failed');
      }
    },
    async delete(key) {
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
      } catch {
        throw new Error('Object deletion failed');
      }
    },
  };
}
