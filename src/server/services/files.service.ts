import { and, count, desc, eq, ilike, inArray, isNull, isNotNull, lt, sql } from 'drizzle-orm';

import type { FileCategory } from '@/lib/mime';

import { splitFilename, uniquifyPathname } from '@/lib/filename';
import { getFileTypeSpec, isAllowedExtension } from '@/lib/mime';
import { db } from '../db/client';
import { files, type FileRow } from '../db/schema';

const PENDING_TTL_MS = 60 * 60 * 1000;

export class UnsupportedFileTypeError extends Error {}

/**
 * Allocates a unique pathname & reserves it with a pending row before any bytes move.
 * The reservation is what makes concurrent uploads of the same filename safe: the unique
 * index decides the winner & the loser retries against a now-larger taken set.
 */
export async function reserveUpload(originalFilename: string): Promise<FileRow> {
  const { stem, extension } = splitFilename(originalFilename);

  if (!isAllowedExtension(extension)) {
    throw new UnsupportedFileTypeError(`Unsupported file type: ${extension || '(none)'}`);
  }
  const spec = getFileTypeSpec(extension)!;

  // names we have personally lost a race for. carrying these across attempts stops us
  // re-proposing a candidate a competitor already took, so each retry makes progress.
  const lost = new Set<string>();

  for (let attempt = 0; attempt < 25; attempt++) {
    // narrow the collision check to plausible neighbours. sanitizeStem already excludes
    // LIKE wildcards, but escape defensively so the pattern can never widen.
    const prefix = stem.replace(/[%_\\]/g, '\\$&');
    const rows = await db
      .select({ pathname: files.pathname })
      .from(files)
      .where(sql`${files.pathname} like ${prefix + '%.' + extension}`);

    const taken = new Set([...rows.map((r) => r.pathname), ...lost]);
    const pathname = uniquifyPathname(stem, extension, taken);

    try {
      const [row] = await db
        .insert(files)
        .values({
          pathname,
          extension,
          blobPathname: pathname,
          contentType: spec.mime,
          status: 'pending',
        })
        .returning();
      return row;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      lost.add(pathname);
    }
  }

  throw new Error('Could not reserve a unique filename after several attempts');
}

/** Drizzle wraps driver errors, so the Postgres code sits on `cause` rather than the throwable. */
function isUniqueViolation(error: unknown): boolean {
  const candidates = [error, (error as { cause?: unknown })?.cause];
  return candidates.some((c) => typeof c === 'object' && c !== null && 'code' in c && c.code === '23505');
}

export async function findPendingById(id: string): Promise<FileRow | null> {
  const [row] = await db.select().from(files).where(and(eq(files.id, id), eq(files.status, 'pending'))).limit(1);
  return row ?? null;
}

export async function markReady(
  id: string,
  metadata: { size: number; contentType: string; etag: string; blobUrl: string },
): Promise<FileRow | null> {
  const [row] = await db
    .update(files)
    .set({
      status: 'ready',
      size: metadata.size,
      etag: metadata.etag,
      blobUrl: metadata.blobUrl,
      uploadedAt: new Date(),
    })
    .where(eq(files.id, id))
    .returning();
  return row ?? null;
}

export async function discardReservation(id: string): Promise<void> {
  await db.delete(files).where(and(eq(files.id, id), eq(files.status, 'pending')));
}

/** Serves the CDN route: only live, fully uploaded files are publicly reachable. */
export async function findServableByName(name: string): Promise<FileRow | null> {
  // pathname always has an extension (contains a dot); customName never does, so
  // matching either column can't return two different files for one URL segment.
  const [row] = await db
    .select()
    .from(files)
    .where(
      and(
        sql`(${files.pathname} = ${name} or ${files.customName} = ${name})`,
        eq(files.status, 'ready'),
        isNull(files.trashedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function sweepStalePending(): Promise<void> {
  await db
    .delete(files)
    .where(and(eq(files.status, 'pending'), lt(files.createdAt, new Date(Date.now() - PENDING_TTL_MS))));
}

export type ListFilesOptions = {
  /** Case-insensitive substring match against pathname. */
  q?: string;
  category?: FileCategory | '';
  /** ISO string of the last seen uploadedAt (exclusive upper bound) */
  cursor?: string;
  limit?: number;
  /** Public gallery mode => only files the admin has flipped `listed` on. */
  listedOnly?: boolean;
};

export type ListFilesResult = {
  rows: FileRow[];
  nextCursor: string | null;
};

export async function listFiles({ q, category, cursor, limit = 50, listedOnly = false }: ListFilesOptions): Promise<ListFilesResult> {
  const cap = Math.min(limit, 100);

  const conditions: ReturnType<typeof eq>[] = [
    eq(files.status, 'ready'),
    isNull(files.trashedAt) as ReturnType<typeof eq>,
  ];

  if (listedOnly) {
    conditions.push(eq(files.listed, true));
  }

  if (q?.trim()) {
    conditions.push(ilike(files.pathname, `%${q.trim()}%`) as ReturnType<typeof eq>);
  }

  // category isn't a column => map it to the extensions in that category & filter on those.
  // drizzle binds the list as params, so postgres never sees the values spliced into the
  // query text.
  if (category) {
    const { FILE_TYPES } = await import('@/lib/mime');
    const exts: string[] = [];
    for (const [ext, spec] of Object.entries(FILE_TYPES)) {
      if (spec.category === category) exts.push(ext);
    }
    if (exts.length > 0) {
      conditions.push(inArray(files.extension, exts) as ReturnType<typeof eq>);
    }
  }

  if (cursor) {
    // typed operator so the Date is mapped to the timestamp column => a raw
    // sql`${files.uploadedAt} < ${date}` hands postgres.js a Date it can't serialize
    // (with prepare:false it throws ERR_INVALID_ARG_TYPE on the param).
    conditions.push(lt(files.uploadedAt, new Date(cursor)) as ReturnType<typeof eq>);
  }

  const rows = await db
    .select()
    .from(files)
    .where(and(...conditions))
    .orderBy(desc(files.uploadedAt))
    .limit(cap + 1);

  const hasMore = rows.length > cap;
  const page = hasMore ? rows.slice(0, cap) : rows;
  const nextCursor = hasMore ? (page[page.length - 1].uploadedAt?.toISOString() ?? null) : null;

  return { rows: page, nextCursor };
}

/** Soft delete: sets trashedAt. The blob itself is NOT removed. */
export async function trashFile(id: string): Promise<FileRow | null> {
  const [row] = await db
    .update(files)
    .set({ trashedAt: new Date() })
    .where(and(eq(files.id, id), eq(files.status, 'ready'), isNull(files.trashedAt)))
    .returning();
  return row ?? null;
}

/** Flips gallery visibility. Off => URL-only; on => shown in the public browse. */
export async function setListed(id: string, listed: boolean): Promise<FileRow | null> {
  const [row] = await db
    .update(files)
    .set({ listed })
    .where(and(eq(files.id, id), isNull(files.trashedAt)))
    .returning();
  return row ?? null;
}

export class CustomNameTakenError extends Error {}

/**
 * Sets or clears (null) the vanity alias. The partial unique index is the real arbiter =>
 * a collision surfaces as a 23505 which we translate rather than leak.
 */
export async function setCustomName(id: string, customName: string | null): Promise<FileRow | null> {
  try {
    const [row] = await db
      .update(files)
      .set({ customName })
      .where(and(eq(files.id, id), isNull(files.trashedAt)))
      .returning();
    return row ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) throw new CustomNameTakenError(`Custom name already in use: ${customName}`);
    throw error;
  }
}

export type FileStats = {
  totalFiles: number;
  totalBytes: number;
  byCategory: Record<string, number>;
};

export async function getStats(): Promise<FileStats> {
  const ready = and(eq(files.status, 'ready'), isNull(files.trashedAt));

  // two independent aggregates over the same table => fire them together instead
  // of waiting for the first roundtrip to finish before starting the second.
  const [totalsRows, byCategoryRows] = await Promise.all([
    db
      .select({
        totalFiles: count(),
        totalBytes: sql<string>`coalesce(sum(${files.size}), 0)`,
      })
      .from(files)
      .where(ready),
    // per-extension counts, grouped into categories below
    db
      .select({
        extension: files.extension,
        n: count(),
      })
      .from(files)
      .where(ready)
      .groupBy(files.extension),
  ]);
  const totals = totalsRows[0];

  const { FILE_TYPES } = await import('@/lib/mime');
  const byCategory: Record<string, number> = {};
  for (const { extension, n } of byCategoryRows) {
    const cat = FILE_TYPES[extension]?.category ?? 'other';
    byCategory[cat] = (byCategory[cat] ?? 0) + n;
  }

  return {
    totalFiles: totals?.totalFiles ?? 0,
    totalBytes: Number(totals?.totalBytes ?? 0),
    byCategory,
  };
}
