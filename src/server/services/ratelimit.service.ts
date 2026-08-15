import { inArray, lt, sql } from 'drizzle-orm';

import { hmacSign } from '@/lib/crypto';
import { isDemoMode } from '@/lib/demo';
import { config } from '../config';
import { getdb } from '../db/client';
import { unlockAttempts } from '../db/schema';

/**
 * Fixed window rate limiting for the two password prompts in the app: the per-file unlock
 * endpoint & the dashboard login. Both get a per-client cap plus a wider backstop:
 *
 *   unlock  5 per (file, client) => stops the obvious brute force
 *          30 per file           => backstop for an attacker rotating IPs, or for a proxy that
 *                                   strips x-forwarded-for & collapses every visitor to "unknown"
 *   login  10 per client         => a real owner mistypes twice, not ten times
 *         120 across the app     => same rotating-IP backstop, but deliberately loose (see below)
 *
 * In Postgres, not a process local Map: Vercel runs many short lived instances, so an in-memory
 * counter resets on every cold start, which is the same as no limit at all. A sliding window
 * buys nothing against caps this small. Counters share one table & are kept apart by their key
 * prefix ("<fileId>:…" vs "login:…") — a uuid can never spell "login", so they can't collide.
 */

const WINDOW_SECONDS = 10 * 60;
const PER_CLIENT_LIMIT = 5;
const PER_FILE_LIMIT = 30;
/**
 * Login is the door to everything, so it's capped harder per client than a file unlock is. The
 * global cap is the awkward one: it has to bound an IP rotating attacker without handing that
 * same attacker a way to lock the owner out of their own dashboard for 10 minutes. 120 is the
 * compromise — far past any honest typo streak, still only ~17k guesses a day, & on Vercel
 * (where x-forwarded-for is set by the platform, not the caller) the per-client cap is the one
 * doing the real work anyway.
 */
const LOGIN_PER_CLIENT_LIMIT = 10;
const LOGIN_GLOBAL_LIMIT = 120;
/** rows this old can't be inside anyone's window any more */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type AttemptKey = { key: string; limit: number };

export type AttemptResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  /** against the per-client cap => what the form shows the visitor */
  attemptsRemaining: number;
};

/** trusted internal constant, so raw is safe here & avoids an untyped interval parameter. */
const WINDOW = sql.raw(`interval '${WINDOW_SECONDS} seconds'`);

/**
 * Client identity is the first x-forwarded-for hop (Vercel appends the real client there),
 * HMAC'd & truncated => the limiter works without keeping raw IPs at rest.
 */
async function clientDigest(request: Request): Promise<string> {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
  return (await hmacSign(config.sessionSecret, `ratelimit:${ip}`)).slice(0, 24);
}

/** Keys for one unlock attempt on one file. */
export async function clientKeyFor(request: Request, fileId: string): Promise<AttemptKey[]> {
  const digest = await clientDigest(request);

  return [
    { key: `${fileId}:ip:${digest}`, limit: PER_CLIENT_LIMIT },
    { key: `${fileId}:all`, limit: PER_FILE_LIMIT },
  ];
}

/** Keys for one dashboard login attempt. Not per-file, so it gets its own namespace. */
export async function loginKeysFor(request: Request): Promise<AttemptKey[]> {
  const digest = await clientDigest(request);
  const keys: AttemptKey[] = [{ key: `login:ip:${digest}`, limit: LOGIN_PER_CLIENT_LIMIT }];

  // the demo password is printed on the login page, so there's nothing to brute force there &
  // the global cap would only let one bored visitor wall the door off for everyone else.
  if (!isDemoMode()) keys.push({ key: 'login:all', limit: LOGIN_GLOBAL_LIMIT });

  return keys;
}

/**
 * Counts one attempt against every key & reports whether the request may proceed. Callers run
 * this BEFORE checking the password, so 210k PBKDF2 iterations can't be used as a CPU amplifier.
 */
export async function consumeAttempt(keys: AttemptKey[]): Promise<AttemptResult> {
  if (isDemoMode()) return consumeInMemory(keys);

  const db = await getdb();
  let allowed = true;
  let retryAfterSeconds = 0;
  let attemptsRemaining = keys[0]?.limit ?? 0;

  for (const [index, { key, limit }] of keys.entries()) {
    // one statement per key so two concurrent requests can't both read "4 attempts" and
    // both write 5. the case expressions are the window roll: past the window, restart at 1.
    const rows = (await db.execute(sql`
      insert into unlock_attempts (key, attempts, window_started_at) values (${key}, 1, now())
      on conflict (key) do update set
        attempts = case when unlock_attempts.window_started_at > now() - ${WINDOW}
                        then unlock_attempts.attempts + 1 else 1 end,
        window_started_at = case when unlock_attempts.window_started_at > now() - ${WINDOW}
                        then unlock_attempts.window_started_at else now() end
      returning attempts, window_started_at
    `)) as unknown as { attempts: number; window_started_at: string | Date }[];

    const row = rows[0];
    if (!row) continue;

    const attempts = Number(row.attempts);
    if (index === 0) attemptsRemaining = Math.max(0, limit - attempts);

    if (attempts > limit) {
      allowed = false;
      const startedAt = new Date(row.window_started_at).getTime();
      const remaining = Math.ceil((startedAt + WINDOW_SECONDS * 1000 - Date.now()) / 1000);
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.max(1, remaining));
    }
  }

  return { allowed, retryAfterSeconds, attemptsRemaining };
}

/** A correct password wipes the counters => an honest typo streak costs nothing. */
export async function resetAttempts(keys: AttemptKey[]): Promise<void> {
  if (isDemoMode()) {
    for (const { key } of keys) memory.delete(key);
    return;
  }

  const db = await getdb();
  await db.delete(unlockAttempts).where(inArray(unlockAttempts.key, keys.map((k) => k.key)));
}

/** Opportunistic cleanup, same `void sweep…()` pattern as sweepStalePending. */
export async function sweepStaleAttempts(): Promise<void> {
  if (isDemoMode()) return;
  const db = await getdb();
  await db.delete(unlockAttempts).where(lt(unlockAttempts.windowStartedAt, new Date(Date.now() - STALE_AFTER_MS)));
}

/** Demo instances have no database at all => a module level map is the whole limiter there. */
const memory = new Map<string, { attempts: number; windowStartedAt: number }>();

function consumeInMemory(keys: AttemptKey[]): AttemptResult {
  const now = Date.now();
  let allowed = true;
  let retryAfterSeconds = 0;
  let attemptsRemaining = keys[0]?.limit ?? 0;

  for (const [index, { key, limit }] of keys.entries()) {
    const current = memory.get(key);
    const entry =
      current && current.windowStartedAt > now - WINDOW_SECONDS * 1000
        ? { attempts: current.attempts + 1, windowStartedAt: current.windowStartedAt }
        : { attempts: 1, windowStartedAt: now };
    memory.set(key, entry);

    if (index === 0) attemptsRemaining = Math.max(0, limit - entry.attempts);
    if (entry.attempts > limit) {
      allowed = false;
      const remaining = Math.ceil((entry.windowStartedAt + WINDOW_SECONDS * 1000 - now) / 1000);
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.max(1, remaining));
    }
  }

  return { allowed, retryAfterSeconds, attemptsRemaining };
}
