import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import type { Env } from "./env";

export function createS3(env: Env) {
  const s3 = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: (env as any).S3_FORCE_PATH_STYLE ?? true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY
    }
  });

  async function ensureBucket(bucket: string) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }

  function keyForBlob(prefix: string, blobId: string) {
    // blobId is "sha256:<hex>"
    return `${prefix}/${blobId}`;
  }

  async function putBlobBytes(bucket: string, prefix: string, blobId: string, bytes: Buffer, mimeType?: string | null) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: keyForBlob(prefix, blobId),
        Body: bytes,
        ContentType: mimeType ?? undefined
      })
    );
  }

  async function getBlobStream(bucket: string, prefix: string, blobId: string) {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: keyForBlob(prefix, blobId)
      })
    );
    if (!res.Body) throw new Error("S3 returned empty body");
    return { body: res.Body, contentType: res.ContentType };
  }

  return { s3, ensureBucket, putBlobBytes, getBlobStream };
}
