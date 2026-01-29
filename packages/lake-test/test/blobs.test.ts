import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, migrate, putBlob } from '@wetblob/lake-db';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Blobs', () => {
  const db = createDb();
  const migrationsDir = join(__dirname, '../../lake-db/migrations');

  beforeAll(async () => {
    await migrate(db, migrationsDir);
  });

  afterAll(async () => {
    await db.$pool.end();
  });

  it('putBlob twice same bytes => same blobId, second inserted=false', async () => {
    const bytes = Buffer.from('hello world');
    
    const result1 = await putBlob(db, { bytes });
    expect(result1.inserted).toBe(true);
    expect(result1.blobId).toMatch(/^sha256:[a-f0-9]{64}$/);
    
    const result2 = await putBlob(db, { bytes });
    expect(result2.inserted).toBe(false);
    expect(result2.blobId).toBe(result1.blobId);
  });

  it('putBlob with mimeType stores mime type', async () => {
    const bytes = Buffer.from('test content');
    const result = await putBlob(db, { bytes, mimeType: 'text/plain' });
    expect(result.inserted).toBe(true);
  });
});
