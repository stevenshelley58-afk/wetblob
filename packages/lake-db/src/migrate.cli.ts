#!/usr/bin/env node
import { createDb } from './db.js';
import { migrate } from './migrate.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const db = createDb();
  const migrationsDir = join(__dirname, '..', 'migrations');
  
  console.log('Running migrations from:', migrationsDir);
  const applied = await migrate(db, migrationsDir);
  
  if (applied.length === 0) {
    console.log('No new migrations to apply.');
  } else {
    console.log('Applied migrations:', applied.join(', '));
  }
  
  await db.$pool.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
