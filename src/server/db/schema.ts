import { sql } from 'drizzle-orm';
import { bigint, boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
    index('files_pathname_trgm_idx').using('gin', sql`${t.pathname} gin_trgm_ops`),
  ],
);

export type FileRow = typeof files.$inferSelect;
export type NewFileRow = typeof files.$inferInsert;
