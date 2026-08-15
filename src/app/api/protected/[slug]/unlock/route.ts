import { buildGrantCookie, createGrant } from '@/server/auth/unlock';
import { findProtectedBySlug } from '@/server/services/files.service';
import { getProtectionHash } from '@/server/services/protection.service';
import { clientKeyFor, consumeAttempt, resetAttempts, sweepStaleAttempts } from '@/server/services/ratelimit.service';
import { findDemoProtectedBySlug } from '@/server/demo/dataset';
import { verifyPasswordHash } from '@/lib/crypto';
import { DEMO_PASSWORD, isDemoMode } from '@/lib/demo';

/**
 * Public. Exchanges a correct password for a per-file unlock cookie.
 *
 * Order matters: resolve, then count the attempt, THEN run the KDF. Counting first is what
 * stops 210k PBKDF2 iterations being used as a CPU amplifier by an unauthenticated caller.
 *
 * The response body never contains anything derived from the file — not on success, not on
 * failure. The refreshed /p/:slug page is what delivers the file's data, after it has verified
 * the cookie server side.
 */
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;

  const file = isDemoMode() ? findDemoProtectedBySlug(slug) : await findProtectedBySlug(slug);
  // unknown / unprotected / pending / trashed all land here => one indistinguishable 404
  if (!file?.protectedAt) return Response.json({ error: 'Not found' }, { status: 404 });

  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (typeof password !== 'string' || password === '') {
    return Response.json({ error: 'Password is required' }, { status: 400 });
  }

  const keys = await clientKeyFor(request, file.id);
  const limit = await consumeAttempt(keys);
  if (!limit.allowed) {
    return Response.json(
      { error: 'Too many attempts', retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  // fire & forget, but swallow => an unhandled rejection here (db blip) would otherwise be
  // thrown at the process rather than costing one skipped cleanup.
  void sweepStaleAttempts().catch(() => {});

  // demo has no Postgres => compare against the one public showcase password instead.
  const correct = isDemoMode()
    ? password === DEMO_PASSWORD
    : await verifyPasswordHash(password, await getProtectionHash(file.id));

  if (!correct) {
    // always this exact body. nothing here is derived from the file.
    return Response.json(
      { error: 'Incorrect password', attemptsRemaining: limit.attemptsRemaining },
      { status: 401 },
    );
  }

  await resetAttempts(keys);

  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': buildGrantCookie(file.id, await createGrant(file)) } },
  );
}
