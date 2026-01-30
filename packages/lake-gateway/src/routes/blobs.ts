import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createDb, putBlob, getBlob } from "@wetblob/lake-db";
import type { GatewayConfig } from "../config";
import type { Env } from "../env";

type S3Api = {
  ensureBucket: (bucket: string) => Promise<void>;
  putBlobBytes: (bucket: string, prefix: string, blobId: string, bytes: Buffer, mimeType?: string | null) => Promise<void>;
  getBlobStream: (bucket: string, prefix: string, blobId: string) => Promise<{ body: any; contentType?: string }>;
};

const PutQuery = z.object({
  mimeType: z.string().optional()
});

export async function registerBlobs(app: FastifyInstance, deps: { env: Env; cfg: GatewayConfig; s3: S3Api }) {
  const db = createDb(deps.env.DATABASE_URL);

  // Upload bytes -> store metadata -> store bytes in S3
  app.put("/v1/blobs", async (req, reply) => {
    const q = PutQuery.safeParse(req.query ?? {});
    if (!q.success) {
      reply.code(400);
      return { error: "invalid_query", issues: q.error.issues };
    }

    // Read raw body as Buffer
    const chunks: Buffer[] = [];
    for await (const c of req.raw) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const bytes = Buffer.concat(chunks);

    if (bytes.length === 0) {
      reply.code(400);
      return { error: "empty_body" };
    }

    const { blobId, inserted } = await putBlob(db, { bytes, mimeType: q.data.mimeType });

    // Store bytes only when this blob is new
    if (inserted) {
      await deps.s3.ensureBucket(deps.cfg.s3.bucket);
      await deps.s3.putBlobBytes(deps.cfg.s3.bucket, deps.cfg.s3.prefix, blobId, bytes, q.data.mimeType ?? null);
    }

    return { blobId };
  });

  // Stream bytes back
  app.get("/v1/blobs/:blobId", async (req, reply) => {
    const blobId = (req.params as any).blobId as string;

    const meta = await getBlob(db, blobId);
    if (!meta) {
      reply.code(404);
      return { error: "not_found" };
    }

    const { body, contentType } = await deps.s3.getBlobStream(deps.cfg.s3.bucket, deps.cfg.s3.prefix, blobId);

    reply.header("Content-Type", contentType ?? meta.mime_type ?? "application/octet-stream");
    return reply.send(body);
  });
}
