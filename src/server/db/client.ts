import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { isDemoMode } from '@/lib/demo';
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

// the proxy defers connect() to the first property access (any real query), so `import { db }`
// has no side effects. methods are bound to the real instance => drizzle internals that use
// `this` (or private fields) never see the proxy.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = connect() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
