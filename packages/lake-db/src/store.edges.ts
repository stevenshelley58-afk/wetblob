import { Db } from './db.js';
import { ulid } from './ulid.js';
import { Edge } from './types.js';

export interface CreateEdgeInput {
  from_item_id: string;
  to_item_id: string;
  rel: string;
  meta?: Record<string, unknown>;
}

export async function createEdge(db: Db, input: CreateEdgeInput): Promise<Edge> {
  const edgeId = ulid();
  
  const row = await db.one(
    `INSERT INTO edges(edge_id, from_item_id, to_item_id, rel, meta)
     VALUES($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      edgeId,
      input.from_item_id,
      input.to_item_id,
      input.rel,
      JSON.stringify(input.meta ?? {})
    ]
  );
  
  return row;
}

export async function listEdgesFrom(
  db: Db,
  itemId: string,
  rel?: string
): Promise<Edge[]> {
  if (rel) {
    return db.query(
      `SELECT * FROM edges WHERE from_item_id = $1 AND rel = $2 ORDER BY created_at DESC`,
      [itemId, rel]
    );
  }
  return db.query(
    `SELECT * FROM edges WHERE from_item_id = $1 ORDER BY created_at DESC`,
    [itemId]
  );
}

export async function listEdgesTo(
  db: Db,
  itemId: string,
  rel?: string
): Promise<Edge[]> {
  if (rel) {
    return db.query(
      `SELECT * FROM edges WHERE to_item_id = $1 AND rel = $2 ORDER BY created_at DESC`,
      [itemId, rel]
    );
  }
  return db.query(
    `SELECT * FROM edges WHERE to_item_id = $1 ORDER BY created_at DESC`,
    [itemId]
  );
}
