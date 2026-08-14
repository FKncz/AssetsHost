/**
 * db:push => enable pg_trgm, then hand off to drizzle-kit.
 *
 * the schema's filename search index is `using('gin', … gin_trgm_ops)`, which Postgres refuses
 * to create unless the pg_trgm extension exists. that used to be a manual psql line in the
 * readme, so a fresh deploy would fail its first push. now it's just part of the same command.
 *
 * the CREATE EXTENSION needs a superuser or an rds_superuser-ish role. managed Postgres
 * (Neon, Supabase, Vercel) allows it on the default role; if yours doesn't, the error below
 * tells you the one line to run by hand.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import postgres from 'postgres';

// drizzle-kit reads .env on its own, this script doesn't => load it before we connect.
function loadenv() {
  if (process.env.DATABASE_URL) return;
  for (const file of ['.env.local', '.env']) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = raw.trim().replace(/^(['"])(.*)\1$/s, '$2');
    }
  }
}

async function enabletrgm(connectionString) {
  // postgres.js logs every NOTICE by default => "extension already exists, skipping" is the
  // normal case here, so swallow them.
  const client = postgres(connectionString, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await client.unsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    console.log('pg_trgm ready');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `\nCould not enable the pg_trgm extension:\n  ${message}\n\n` +
        'The filename search index needs it. If that was a permissions error, run this once\n' +
        'with a privileged role and retry pnpm db:push:\n\n' +
        '  CREATE EXTENSION IF NOT EXISTS pg_trgm;\n\n' +
        'If it was a connection error, check DATABASE_URL.\n',
    );
    process.exit(1);
  } finally {
    await client.end({ timeout: 5 });
  }
}

loadenv();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Put it in .env or pass it inline:\n  DATABASE_URL="…" pnpm db:push');
  process.exit(1);
}

await enabletrgm(process.env.DATABASE_URL);

// inherit stdio so drizzle-kit's interactive prompts (it asks before destructive changes) work.
const push = spawnSync('drizzle-kit', ['push', ...process.argv.slice(2)], { stdio: 'inherit', shell: true });
process.exit(push.status ?? 1);
