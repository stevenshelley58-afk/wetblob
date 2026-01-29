import { Db } from './db.js';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

export interface Migration {
  version: string;
  sql: string;
}

export async function loadMigrations(migrationsDir: string): Promise<Migration[]> {
  const files = await readdir(migrationsDir);
  const sqlFiles = files
    .filter(f => f.endsWith('.sql'))
    .sort();
  
  const migrations: Migration[] = [];
  for (const file of sqlFiles) {
    const version = file.replace('.sql', '');
    const sql = await readFile(join(migrationsDir, file), 'utf-8');
    migrations.push({ version, sql });
  }
  return migrations;
}

export async function getAppliedMigrations(db: Db): Promise<Set<string>> {
  try {
    const rows: { version: string }[] = await db.query('SELECT version FROM schema_migrations');
    return new Set(rows.map(r => r.version));
  } catch (e: any) {
    // schema_migrations doesn't exist yet, will be created by first migration
    return new Set();
  }
}

export async function applyMigration(db: Db, migration: Migration): Promise<void> {
  await db.tx(async t => {
    await t.none(migration.sql);
    await t.none(
      'INSERT INTO schema_migrations(version, applied_at) VALUES($1, now())',
      [migration.version]
    );
  });
}

export async function migrate(db: Db, migrationsDir: string): Promise<string[]> {
  const migrations = await loadMigrations(migrationsDir);
  const applied = await getAppliedMigrations(db);
  const appliedVersions: string[] = [];
  
  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      await applyMigration(db, migration);
      appliedVersions.push(migration.version);
    }
  }
  
  return appliedVersions;
}
