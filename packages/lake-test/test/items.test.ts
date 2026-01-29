import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, migrate, createItem, putBlob } from '@wetblob/lake-db';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Items', () => {
  const db = createDb();
  const migrationsDir = join(__dirname, '../../lake-db/migrations');

  beforeAll(async () => {
    await migrate(db, migrationsDir);
  });

  afterAll(async () => {
    await db.$pool.end();
  });

  it('create item with both blob_id and text_content fails (check constraint)', async () => {
    const bytes = Buffer.from('blob content');
    const blobResult = await putBlob(db, { bytes });
    
    await expect(
      createItem(db, {
        type: 'test',
        source_type: 'test',
        source_id: 'test',
        blob_id: blobResult.blobId,
        text_content: 'text content'
      })
    ).rejects.toThrow(/items_one_payload/);
  });

  it('create item with neither blob_id nor text_content fails (check constraint)', async () => {
    await expect(
      createItem(db, {
        type: 'test',
        source_type: 'test',
        source_id: 'test'
      })
    ).rejects.toThrow(/items_one_payload/);
  });

  it('create item with text_content succeeds', async () => {
    const item = await createItem(db, {
      type: 'note',
      source_type: 'manual',
      source_id: 'user:steve',
      text_content: 'Hello world'
    });
    
    expect(item.item_id).toBeDefined();
    expect(item.type).toBe('note');
    expect(item.text_content).toBe('Hello world');
    expect(item.blob_id).toBeNull();
  });

  it('create item with blob_id succeeds', async () => {
    const bytes = Buffer.from('blob content');
    const blobResult = await putBlob(db, { bytes });
    
    const item = await createItem(db, {
      type: 'file',
      source_type: 'manual',
      source_id: 'user:steve',
      blob_id: blobResult.blobId
    });
    
    expect(item.item_id).toBeDefined();
    expect(item.type).toBe('file');
    expect(item.blob_id).toBe(blobResult.blobId);
    expect(item.text_content).toBeNull();
  });
});
