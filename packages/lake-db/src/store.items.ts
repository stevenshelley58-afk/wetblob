import { Db } from './db.js';
import { ulid } from './ulid.js';
import { Item } from './types.js';

export interface CreateItemInput {
  type: string;
  title?: string;
  source_type: string;
  source_id: string;
  external_ref?: string;
  canonical_uri?: string;
  content_sha256?: string;
  observed_at?: Date;
  tags?: string[];
  sensitivity?: 'private' | 'public' | 'secret' | 'restricted';
  blob_id?: string;
  text_content?: string;
  meta?: Record<string, unknown>;
}

export async function createItem(db: Db, input: CreateItemInput): Promise<Item> {
  const itemId = ulid();
  
  const row = await db.one(
    `INSERT INTO items(
      item_id, type, title, source_type, source_id, external_ref,
      canonical_uri, content_sha256, observed_at, tags, sensitivity,
      blob_id, text_content, meta
    ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *`,
    [
      itemId,
      input.type,
      input.title ?? null,
      input.source_type,
      input.source_id,
      input.external_ref ?? null,
      input.canonical_uri ?? null,
      input.content_sha256 ?? null,
      input.observed_at ?? null,
      input.tags ?? [],
      input.sensitivity ?? 'private',
      input.blob_id ?? null,
      input.text_content ?? null,
      JSON.stringify(input.meta ?? {})
    ]
  );
  
  return row;
}

export async function findItem(db: Db, itemId: string): Promise<Item | null> {
  return db.oneOrNone(`SELECT * FROM items WHERE item_id = $1`, [itemId]);
}

export async function touchUpdatedAt(db: Db, itemId: string): Promise<void> {
  await db.none(
    `UPDATE items SET updated_at = now() WHERE item_id = $1`,
    [itemId]
  );
}

export async function findItemsByCanonicalUri(
  db: Db,
  canonicalUri: string
): Promise<Item[]> {
  return db.manyOrNone(
    `SELECT * FROM items WHERE canonical_uri = $1 ORDER BY created_at DESC`,
    [canonicalUri]
  );
}

export async function findItemsByContentSha256(
  db: Db,
  contentSha256: string
): Promise<Item[]> {
  return db.manyOrNone(
    `SELECT * FROM items WHERE content_sha256 = $1 ORDER BY created_at DESC`,
    [contentSha256]
  );
}

export interface ListItemsOptions {
  type?: string;
  limit?: number;
}

export async function listItems(
  db: Db,
  options: ListItemsOptions = {}
): Promise<Item[]> {
  const { type, limit = 20 } = options;
  
  if (type) {
    return db.manyOrNone(
      `SELECT * FROM items 
       WHERE type = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [type, limit]
    );
  }
  
  return db.manyOrNone(
    `SELECT * FROM items 
     ORDER BY created_at DESC 
     LIMIT $1`,
    [limit]
  );
}
