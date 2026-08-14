import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { isDemoMode } from '@/lib/demo';
import { ensureSchema } from './bootstrap';
import * as schema from './schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

// built lazily so importing this module never throws => demo instances (which never query)
// can boot with no DATABASE_URL at all, & a real instance still fails loudly on first use
// if the connection string is missing.
let cached: Db | null = null;

function connect(): Db {
  if (cached) return cached;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      isDemoMode()
        ? 'Database access attempted in demo mode (demo should never hit the db)'
        : 'DATABASE_URL is not set',
    );
  }
  // serverless invocations are short lived => a small pool avoids exhausting Postgres connections.
  const client = postgres(connectionString, { max: 5, prepare: false });
  cached = drizzle(client, { schema });
  return cached;
}

/**
 * The only way to reach Postgres. Awaiting the bootstrap here rather than exporting a `db`
 * singleton is deliberate => you can't query a database whose schema hasn't been ensured,
 * because you can't get the handle without going through it. ensureSchema() is memoized, so
 * every call after the first in a given server instance is free.
 */
export async function getdb(): Promise<Db> {
  await ensureSchema();
  return connect();
}
