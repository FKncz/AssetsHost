/**
 * Schema bootstrap => the app creates its own tables on boot, so a self-hoster can paste any
 * Postgres URL (Neon, Supabase, Vercel, plain) into the env and deploy with no local checkout.
 *
 * How it decides: a marker row in `assetshost_meta`. If it holds the current SCHEMA_VERSION we
 * do nothing (one cheap query per cold start). Otherwise the DDL below runs. Everything is
 * `if not exists`, so "has this app run before" never has to be answered, we just make the
 * schema exist.
 *
 * MIRROR RULE: this DDL is hand written against src/server/db/schema.ts. Change the schema =>
 * mirror it here (new columns need an `alter table … add column if not exists` line too) and
 * bump SCHEMA_VERSION. In dev, checkdrift() below warns if you forget.
 */
import postgres from 'postgres';
import { getTableColumns } from 'drizzle-orm';

import { isDemoMode } from '@/lib/demo';
import { files } from './schema';

/** bump on every DDL change => existing deploys re-run it on their next boot. */
const SCHEMA_VERSION = '1';
const MARKER_KEY = 'schema_version';
/** arbitrary, just has to be ours => stops two cold starts racing on create type/index. */
const LOCK_ID = 8127346501;

/** value stored when everything but the trigram index landed (see enableextensions). */
const PARTIAL_MARKER = `${SCHEMA_VERSION}-notrgm`;

// mirrors schema.ts column for column. the `alter table` lines are what upgrades an install
// created by an older version => `create table if not exists` alone would leave it short a
// column. the four required columns are added nullable because a populated table can't take a
// not-null column with no default, & they've existed since the first release anyway.
const CORE_DDL = `
  do $$ begin
    create type file_status as enum ('pending', 'ready');
  exception when duplicate_object then null; end $$;

  create table if not exists files (
    id uuid primary key default gen_random_uuid(),
    pathname text not null,
    extension text not null,
    custom_name text,
    listed boolean not null default false,
    blob_url text,
    blob_pathname text not null,
    content_type text not null,
    size bigint not null default 0,
    etag text,
    status file_status not null default 'pending',
    created_at timestamptz not null default now(),
    uploaded_at timestamptz,
    trashed_at timestamptz
  );

  alter table files add column if not exists pathname text;
  alter table files add column if not exists extension text;
  alter table files add column if not exists custom_name text;
  alter table files add column if not exists listed boolean not null default false;
  alter table files add column if not exists blob_url text;
  alter table files add column if not exists blob_pathname text;
  alter table files add column if not exists content_type text;
  alter table files add column if not exists size bigint not null default 0;
  alter table files add column if not exists etag text;
  alter table files add column if not exists status file_status not null default 'pending';
  alter table files add column if not exists created_at timestamptz not null default now();
  alter table files add column if not exists uploaded_at timestamptz;
  alter table files add column if not exists trashed_at timestamptz;

  create unique index if not exists files_pathname_key on files (pathname);
  create unique index if not exists files_custom_name_key on files (custom_name)
    where custom_name is not null;
  -- "nulls last" is explicit because that's what drizzle-kit emits for a desc index column =>
  -- without it postgres defaults desc to nulls first & every db:push would rebuild this index.
  create index if not exists files_listing_idx on files (trashed_at, uploaded_at desc nulls last);
  create index if not exists files_extension_idx on files (extension);

  create table if not exists assetshost_meta (
    key text primary key,
    value text not null,
    updated_at timestamptz not null default now()
  );
`;

const TRGM_INDEX_DDL = `
  create index if not exists files_pathname_trgm_idx on files using gin (pathname gin_trgm_ops);
`;

type Sql = ReturnType<typeof postgres>;

/** memoized success. a rejection is NOT cached => the next request retries instead of the whole
 *  instance staying poisoned until it recycles. */
let inflight: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  inflight ??= run().catch((error) => {
    inflight = null;
    throw error;
  });
  return inflight;
}

async function run(): Promise<void> {
  if (isDemoMode()) return; // demo has no database at all
  if (process.env.SKIP_DB_BOOTSTRAP === 'true') return;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return; // let connect() in client.ts own that error message

  // own connection => the session level advisory lock stays out of the app's pool, & notices
  // like "extension already exists, skipping" aren't worth printing.
  const sql = postgres(connectionString, { max: 1, prepare: false, onnotice: () => {} });
  try {
    if (await isprovisioned(sql)) return;
    await provision(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * The steady state cost: one round trip. Any error the server itself reported (a pg code)
 * means "can't confirm" => fall through to provision(), which owns the recovery logic. That
 * covers both 42P01 (undefined_table, an un-provisioned db) & 42501 (no select privilege on the
 * marker table). A failure with no pg code is a connection problem, which is nobody's to fix here.
 */
async function isprovisioned(sql: Sql): Promise<boolean> {
  try {
    const rows = await sql<{ value: string }[]>`
      select value from assetshost_meta where key = ${MARKER_KEY}
    `;
    return rows[0]?.value === SCHEMA_VERSION;
  } catch (error) {
    if (pgcode(error)) return false;
    throw error;
  }
}

async function provision(sql: Sql): Promise<void> {
  await sql`select pg_advisory_lock(${LOCK_ID})`;
  try {
    const trgm = await enableextensions(sql);

    await sql.unsafe(CORE_DDL);
    if (trgm) await sql.unsafe(TRGM_INDEX_DDL);

    const marker = trgm ? SCHEMA_VERSION : PARTIAL_MARKER;
    await sql`
      insert into assetshost_meta (key, value) values (${MARKER_KEY}, ${marker})
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `;

    console.log(`[db] schema ready (version ${marker})`);
    if (process.env.NODE_ENV !== 'production') await checkdrift(sql);
  } catch (error) {
    // a role that can read but can't create is fine as long as the schema is already there
    // (someone ran pnpm db:push with an admin role) => warn once & carry on.
    if (await isqueryable(sql)) {
      console.warn(
        '[db] could not apply the schema bootstrap, but the files table is readable so ' +
          'carrying on. set SKIP_DB_BOOTSTRAP=true to silence this.',
        error,
      );
      return;
    }
    throw new Error(
      'Could not create the database schema. The role behind DATABASE_URL needs create ' +
        'privileges, or you can create it yourself with `pnpm db:push` and set ' +
        `SKIP_DB_BOOTSTRAP=true. Original error: ${message(error)}`,
      { cause: error },
    );
  } finally {
    // never let a failed unlock mask the real error => the lock dies with the session anyway.
    await sql`select pg_advisory_unlock(${LOCK_ID})`.catch(() => {});
  }
}

/**
 * pg_trgm backs the filename search index; pgcrypto only matters for gen_random_uuid() on
 * Postgres < 13 (core since 13). Both are tolerated failures => a role without extension rights
 * still gets a working install. Without pg_trgm we skip that one index & store a marker that
 * won't match, so a later boot with better privileges retries it. Search keeps working either
 * way, listFiles uses ilike, which the index only speeds up.
 */
async function enableextensions(sql: Sql): Promise<boolean> {
  await sql`create extension if not exists pgcrypto`.catch(() => {});
  try {
    await sql`create extension if not exists pg_trgm`;
    return true;
  } catch (error) {
    console.warn(
      '[db] pg_trgm is not available, filename search will fall back to a slower scan. ' +
        `Enable it with \`create extension pg_trgm;\` as a privileged role. ${message(error)}`,
    );
    return false;
  }
}

async function isqueryable(sql: Sql): Promise<boolean> {
  try {
    await sql`select 1 from files limit 1`;
    return true;
  } catch {
    return false;
  }
}

/** dev only guard for the mirror rule => derived from schema.ts, not a second hardcoded list. */
async function checkdrift(sql: Sql): Promise<void> {
  try {
    const rows = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_name = 'files'
    `;
    const live = new Set(rows.map((r) => r.column_name));
    const missing = Object.values(getTableColumns(files))
      .map((column) => column.name)
      .filter((name) => !live.has(name));

    if (missing.length > 0) {
      console.warn(
        `[db] warning: ${missing.map((n) => `"${n}"`).join(', ')} ` +
          `${missing.length === 1 ? 'is' : 'are'} in schema.ts but not in the database => ` +
          'mirror the column into CORE_DDL in src/server/db/bootstrap.ts & bump SCHEMA_VERSION.',
      );
    }
  } catch {
    // a drift warning is a nicety, never a reason to fail a boot
  }
}

function pgcode(error: unknown): string | undefined {
  for (const candidate of [error, (error as { cause?: unknown })?.cause]) {
    if (typeof candidate === 'object' && candidate !== null && 'code' in candidate) {
      return String((candidate as { code: unknown }).code);
    }
  }
  return undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
