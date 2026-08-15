import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { deriveSlug, uniquifySlug } from '@/lib/filename';
import { hashPassword } from '@/lib/crypto';
import { getdb } from '../db/client';
import { fileProtections, files, type FileRow } from '../db/schema';

/**
 * Per-file passwords. `files.protected_at` is the flag (& the grant version); the hash sits in
 * file_protections and getProtectionHash below is its only reader anywhere in the app.
 */

/** Long enough to be worth the KDF, short enough that the cap is never the reason a set fails. */
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 256;

export class WeakPasswordError extends Error {}

export function assertUsablePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
    );
  }
  // deliberately no comparison against AUTH_PASSWORD => "that's the dashboard password" would
  // itself be a leak.
}

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getdb>>['transaction']>[0]>[0];

/**
 * A protected file is only reachable at /p/:slug, so it must have a slug. Reuses custom_name:
 * one alias namespace instead of two, & findServableByName keeps resolving both forms.
 */
async function ensureSlug(tx: Tx, row: Pick<FileRow, 'id' | 'pathname' | 'customName'>): Promise<string> {
  if (row.customName) return row.customName;

  const base = deriveSlug(row.pathname);
  // narrow the collision check the way reserveUpload does => escape LIKE metacharacters so the
  // pattern can never widen past the neighbours we meant to look at.
  const prefix = base.replace(/[%_\\]/g, '\\$&');
  const rows = await tx
    .select({ customName: files.customName })
    .from(files)
    .where(and(isNotNull(files.customName), sql`${files.customName} like ${prefix + '%'}`));

  const taken = new Set(rows.map((r) => r.customName as string));
  const slug = uniquifySlug(base, taken);

  await tx.update(files).set({ customName: slug }).where(eq(files.id, row.id));
  return slug;
}

/**
 * Sets or rotates the password. Rewriting protected_at is what kills every outstanding grant,
 * so a rotation locks previously unlocked visitors back out.
 */
export async function setProtection(id: string, password: string): Promise<FileRow | null> {
  assertUsablePassword(password);

  const db = await getdb();
  // hash outside the transaction => 210k PBKDF2 iterations have no business holding a row lock.
  const passwordHash = await hashPassword(password);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: files.id, pathname: files.pathname, customName: files.customName })
      .from(files)
      .where(and(eq(files.id, id), isNull(files.trashedAt)))
      .limit(1);
    if (!row) return null;

    await ensureSlug(tx, row);

    await tx
      .insert(fileProtections)
      .values({ fileId: id, passwordHash })
      .onConflictDoUpdate({
        target: fileProtections.fileId,
        set: { passwordHash, updatedAt: new Date() },
      });

    const [updated] = await tx.update(files).set({ protectedAt: new Date() }).where(eq(files.id, id)).returning();
    return updated ?? null;
  });
}

/**
 * Removes the password. The slug stays behind as an ordinary vanity alias => /f/:slug starts
 * working & /p/:slug starts 404ing, which is the intended transition.
 */
export async function clearProtection(id: string): Promise<FileRow | null> {
  const db = await getdb();

  return db.transaction(async (tx) => {
    await tx.delete(fileProtections).where(eq(fileProtections.fileId, id));
    const [row] = await tx
      .update(files)
      .set({ protectedAt: null })
      .where(and(eq(files.id, id), isNull(files.trashedAt)))
      .returning();
    return row ?? null;
  });
}

/** The ONLY read of password_hash in the codebase. Keep it that way. */
export async function getProtectionHash(id: string): Promise<string | null> {
  const db = await getdb();
  const [row] = await db
    .select({ passwordHash: fileProtections.passwordHash })
    .from(fileProtections)
    .where(eq(fileProtections.fileId, id))
    .limit(1);
  return row?.passwordHash ?? null;
}
