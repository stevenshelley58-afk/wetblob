import { Db } from './db.js';
import { sha256 } from './sha256.js';

export interface PutBlobResult {
  blobId: string;
  inserted: boolean;
}

export async function putBlob(
  db: Db,
  { bytes, mimeType }: { bytes: Buffer; mimeType?: string }
): Promise<PutBlobResult> {
  const blobId = sha256(bytes);
  
  try {
    await db.none(
      `INSERT INTO blobs(blob_id, size_bytes, mime_type) VALUES($1, $2, $3)`,
      [blobId, bytes.length, mimeType ?? null]
    );
    return { blobId, inserted: true };
  } catch (e: any) {
    // Check for unique violation (PostgreSQL error code 23505)
    if (e.code === '23505') {
      return { blobId, inserted: false };
    }
    throw e;
  }
}

export async function getBlob(db: Db, blobId: string): Promise<{ blob_id: string; size_bytes: number; mime_type: string | null } | null> {
  return db.oneOrNone(
    `SELECT blob_id, size_bytes, mime_type FROM blobs WHERE blob_id = $1`,
    [blobId]
  );
}
