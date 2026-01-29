import pgPromise from 'pg-promise';

const pgp = pgPromise();

export function createDb(databaseUrl?: string) {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL not set');
  }
  return pgp(url);
}

export type Db = ReturnType<typeof createDb>;
