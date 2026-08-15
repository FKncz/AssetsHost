import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const fileStatus = pgEnum('file_status', ['pending', 'ready']);

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** The public URL path, e.g. "banner.webp". Unique across live AND trashed rows. */
    pathname: text('pathname').notNull(),
    extension: text('extension').notNull(),

    /**
     * Optional vanity alias, e.g. "yamato-picture". Resolves to the same file as pathname.
     * Never contains a dot, so it can't collide with a real pathname.
     */
    customName: text('custom_name'),

    /** Off by default => a fresh upload is URL reachable but hidden from the public gallery. */
    listed: boolean('listed').notNull().default(false),

    /**
     * Not null => the file carries its own password & is only reachable through /p/:slug.
     * Doubles as the grant version: rotating the password rewrites this, which retires every
     * outstanding unlock cookie. The hash itself lives in file_protections, never here, so no
     * existing select().from(files) can leak it.
     */
    protectedAt: timestamp('protected_at', { withTimezone: true }),

    blobUrl: text('blob_url'),
    blobPathname: text('blob_pathname').notNull(),

    contentType: text('content_type').notNull(),
    size: bigint('size', { mode: 'number' }).notNull().default(0),
    etag: text('etag'),

    status: fileStatus('status').notNull().default('pending'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    trashedAt: timestamp('trashed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('files_pathname_key').on(t.pathname),
    // partial => only rows that actually set a custom name compete for uniqueness
    uniqueIndex('files_custom_name_key').on(t.customName).where(sql`${t.customName} is not null`),
    index('files_listing_idx').on(t.trashedAt, t.uploadedAt.desc()),
    index('files_extension_idx').on(t.extension),
    index('files_protected_idx').on(t.protectedAt),
    index('files_pathname_trgm_idx').using('gin', sql`${t.pathname} gin_trgm_ops`),
  ],
);

export type FileRow = typeof files.$inferSelect;
export type NewFileRow = typeof files.$inferInsert;

/**
 * Per-file password hashes, split off files on purpose: the only reader is
 * getProtectionHash() in protection.service.ts, so a stray `select().from(files)` that ends
 * up in a public payload can't carry the hash with it.
 */
export const fileProtections = pgTable('file_protections', {
  fileId: uuid('file_id')
    .primaryKey()
    .references(() => files.id, { onDelete: 'cascade' }),
  /** pbkdf2$sha256$<iters>$<salt>$<hash>, params inline so they can be raised later. */
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Fixed window counters for the password prompts (unlock + dashboard login). In Postgres rather
 * than a process local Map because Vercel runs many short lived instances => an in-memory counter
 * resets on every cold start, which is the same as no limit at all. Kept its original name so
 * there's no migration for what is only a widened use.
 */
export const unlockAttempts = pgTable(
  'unlock_attempts',
  {
    /**
     * "<fileId>:ip:<hmac>" for one client on one file, "<fileId>:all" for the per-file backstop,
     * "login:ip:<hmac>" & "login:all" for the dashboard login.
     */
    key: text('key').primaryKey(),
    attempts: integer('attempts').notNull().default(0),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('unlock_attempts_window_idx').on(t.windowStartedAt)],
);

/**
 * Bookkeeping for the boot time schema bootstrap (src/server/db/bootstrap.ts): it stores the
 * schema version it last applied under the key "schema_version". Declared here too so drizzle
 * knows the table is ours & db:push doesn't try to drop it.
 */
export const meta = pgTable('assetshost_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
