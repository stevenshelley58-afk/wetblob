import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, migrate, createItem, createEdge } from '@wetblob/lake-db';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Edges', () => {
  const db = createDb();
  const migrationsDir = join(__dirname, '../../lake-db/migrations');

  beforeAll(async () => {
    await migrate(db, migrationsDir);
  });

  afterAll(async () => {
    await db.$pool.end();
  });

  it('cannot create edge referencing missing items (FK)', async () => {
    await expect(
      createEdge(db, {
        from_item_id: 'nonexistent-item-1',
        to_item_id: 'nonexistent-item-2',
        rel: 'mentions'
      })
    ).rejects.toThrow(/foreign key/);
  });

  it('can create edge between existing items', async () => {
    const item1 = await createItem(db, {
      type: 'note',
      source_type: 'manual',
      source_id: 'user:steve',
      text_content: 'Item 1'
    });
    
    const item2 = await createItem(db, {
      type: 'note',
      source_type: 'manual',
      source_id: 'user:steve',
      text_content: 'Item 2'
    });
    
    const edge = await createEdge(db, {
      from_item_id: item1.item_id,
      to_item_id: item2.item_id,
      rel: 'mentions',
      meta: { context: 'test' }
    });
    
    expect(edge.edge_id).toBeDefined();
    expect(edge.from_item_id).toBe(item1.item_id);
    expect(edge.to_item_id).toBe(item2.item_id);
    expect(edge.rel).toBe('mentions');
  });
});
