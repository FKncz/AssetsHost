import { and, count, desc, eq, ilike, inArray, isNull, isNotNull, lt, sql } from 'drizzle-orm';

import type { FileCategory } from '@/lib/mime';

import { deriveSlug, splitFilename, uniquifyPathname, uniquifySlug } from '@/lib/filename';
import { hashPassword } from '@/lib/crypto';
import { getFileTypeSpec, isAllowedExtension } from '@/lib/mime';
import { getdb } from '../db/client';
import { fileProtections, files, type FileRow } from '../db/schema';

const PENDING_TTL_MS = 60 * 60 * 1000;

export class UnsupportedFileTypeError extends Error {}

export type ReserveOptions = {
  /** Set => the file is born protected, while it is still pending & therefore unservable. */
  password?: string;
};

/**
 * Allocates a unique pathname & reserves it with a pending row before any bytes move.
 * The reservation is what makes concurrent uploads of the same filename safe: the unique
 * index decides the winner & the loser retries against a now-larger taken set.
 *
 * A password is applied here rather than at /api/upload/complete on purpose: onUploadCompleted
 * (api/upload/token) can flip a row to 'ready' before the client's complete call lands, which
 * would leave a protected file briefly readable in the clear at /f/:pathname. A pending row is
 * never servable, so protecting it here closes that window.
 */
export async function reserveUpload(originalFilename: string, options: ReserveOptions = {}): Promise<FileRow> {
  const db = await getdb();
  const { stem, extension } = splitFilename(originalFilename);

  if (!isAllowedExtension(extension)) {
    throw new UnsupportedFileTypeError(`Unsupported file type: ${extension || '(none)'}`);
  }
  const spec = getFileTypeSpec(extension)!;

  // hashed once up front => a retry doesn't pay for 210k PBKDF2 iterations again, & no KDF
  // work happens inside the transaction.
  const passwordHash = options.password ? await hashPassword(options.password) : null;
  const slugBase = passwordHash ? deriveSlug(originalFilename) : null;

  // names we have personally lost a race for. carrying these across attempts stops us
  // re-proposing a candidate a competitor already took, so each retry makes progress.
  const lost = new Set<string>();
  const lostSlugs = new Set<string>();

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
    const slug = slugBase ? uniquifySlug(slugBase, new Set([...(await takenSlugs(slugBase)), ...lostSlugs])) : null;

    try {
      // no password => a plain insert, exactly as before. with one, the file row & its hash
      // land together so there is no instant where a protected row exists unprotected.
      const row = passwordHash
        ? await db.transaction(async (tx) => {
            const [inserted] = await tx
              .insert(files)
              .values({
                pathname,
                extension,
                customName: slug,
                blobPathname: pathname,
                contentType: spec.mime,
                status: 'pending',
                protectedAt: new Date(),
              })
              .returning();
            await tx.insert(fileProtections).values({ fileId: inserted.id, passwordHash });
            return inserted;
          })
        : (
            await db
              .insert(files)
              .values({
                pathname,
                extension,
                blobPathname: pathname,
                contentType: spec.mime,
                status: 'pending',
              })
              .returning()
          )[0];
      return row;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // either name could have been the loser & the error doesn't say which => retire both.
      lost.add(pathname);
      if (slug) lostSlugs.add(slug);
    }
  }

  throw new Error('Could not reserve a unique filename after several attempts');
}

/** Slugs that already exist & could collide with `base` or one of its -2/-3 variants. */
async function takenSlugs(base: string): Promise<Set<string>> {
  const db = await getdb();
  const prefix = base.replace(/[%_\\]/g, '\\$&');
  const rows = await db
    .select({ customName: files.customName })
    .from(files)
    .where(and(isNotNull(files.customName), sql`${files.customName} like ${prefix + '%'}`));
  return new Set(rows.map((r) => r.customName as string));
}


/** Drizzle wraps driver errors, so the Postgres code sits on `cause` rather than the throwable. */
function isUniqueViolation(error: unknown): boolean {
  const candidates = [error, (error as { cause?: unknown })?.cause];
  return candidates.some((c) => typeof c === 'object' && c !== null && 'code' in c && c.code === '23505');
}

export async function findPendingById(id: string): Promise<FileRow | null> {
  const db = await getdb();
  const [row] = await db.select().from(files).where(and(eq(files.id, id), eq(files.status, 'pending'))).limit(1);
  return row ?? null;
}

export async function markReady(
  id: string,
  metadata: { size: number; contentType: string; etag: string; blobUrl: string },
): Promise<FileRow | null> {
  const db = await getdb();
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
  const db = await getdb();
  await db.delete(files).where(and(eq(files.id, id), eq(files.status, 'pending')));
}

/** Serves the CDN route: only live, fully uploaded files are publicly reachable. */
export async function findServableByName(name: string): Promise<FileRow | null> {
  const db = await getdb();
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
  const db = await getdb();
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
  const db = await getdb();
  const cap = Math.min(limit, 100);

  const conditions: ReturnType<typeof eq>[] = [
    eq(files.status, 'ready'),
    isNull(files.trashedAt) as ReturnType<typeof eq>,
  ];

  if (listedOnly) {
    conditions.push(eq(files.listed, true));
  }

  if (q?.trim()) {
    if (listedOnly) {
      // a protected file's real filename & extension are not public => search only what the
      // public payload already shows, which for a locked file is the slug and nothing else.
      // without this an anonymous visitor could probe a locked filename a character at a time.
      conditions.push(
        sql`case when ${files.protectedAt} is null then coalesce(${files.customName}, ${files.pathname})
                 else ${files.customName} end ilike ${`%${q.trim()}%`}` as ReturnType<typeof eq>,
      );
    } else {
      conditions.push(ilike(files.pathname, `%${q.trim()}%`) as ReturnType<typeof eq>);
    }
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
    // publicly, a locked file advertises no category at all => it belongs to no tab. otherwise
    // filtering by "Images" would tell a stranger what a locked file is.
    if (listedOnly) {
      conditions.push(isNull(files.protectedAt) as ReturnType<typeof eq>);
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
  // the cursor is a real uploadedAt, so it reveals the page boundary timestamp of whichever row
  // ended the page (protected or not). pagination needs an ordering key & the locked item body
  // itself carries no dates => left as is, deliberately.
  const nextCursor = hasMore ? (page[page.length - 1].uploadedAt?.toISOString() ?? null) : null;

  return { rows: page, nextCursor };
}

/**
 * Resolves /p/:slug. Explicit projection: the page only ever needs these three columns before
 * the grant is checked, so a wider select can't accidentally end up rendered.
 * Unknown, unprotected, pending or trashed all come back null => the page 404s on all four.
 */
export async function findProtectedBySlug(
  slug: string,
): Promise<{ id: string; customName: string | null; protectedAt: Date | null } | null> {
  const db = await getdb();
  const [row] = await db
    .select({ id: files.id, customName: files.customName, protectedAt: files.protectedAt })
    .from(files)
    .where(
      and(
        eq(files.customName, slug),
        isNotNull(files.protectedAt),
        eq(files.status, 'ready'),
        isNull(files.trashedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Full row for the unlocked view, once the grant has been verified server side. */
export async function findById(id: string): Promise<FileRow | null> {
  const db = await getdb();
  const [row] = await db.select().from(files).where(and(eq(files.id, id), isNull(files.trashedAt))).limit(1);
  return row ?? null;
}

/** Soft delete: sets trashedAt. The blob itself is NOT removed. */
export async function trashFile(id: string): Promise<FileRow | null> {
  const db = await getdb();
  const [row] = await db
    .update(files)
    .set({ trashedAt: new Date() })
    .where(and(eq(files.id, id), eq(files.status, 'ready'), isNull(files.trashedAt)))
    .returning();
  return row ?? null;
}

/** Flips gallery visibility. Off => URL-only; on => shown in the public browse. */
export async function setListed(id: string, listed: boolean): Promise<FileRow | null> {
  const db = await getdb();
  const [row] = await db
    .update(files)
    .set({ listed })
    .where(and(eq(files.id, id), isNull(files.trashedAt)))
    .returning();
  return row ?? null;
}

export class CustomNameTakenError extends Error {}
export class ProtectedSlugRequiredError extends Error {}

/**
 * Sets or clears (null) the vanity alias. The partial unique index is the real arbiter =>
 * a collision surfaces as a 23505 which we translate rather than leak.
 *
 * Clearing is refused while the file is protected: /p/:slug IS the alias, so a protected file
 * with no alias would have no URL at all. Renaming to another free slug is fine & just moves
 * the share URL.
 */
export async function setCustomName(id: string, customName: string | null): Promise<FileRow | null> {
  const db = await getdb();

  if (customName === null) {
    const [current] = await db
      .select({ protectedAt: files.protectedAt })
      .from(files)
      .where(and(eq(files.id, id), isNull(files.trashedAt)))
      .limit(1);
    if (current?.protectedAt) {
      throw new ProtectedSlugRequiredError('A password protected file needs a custom name to be shared under');
    }
  }

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
  const db = await getdb();
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
