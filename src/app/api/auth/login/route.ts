import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, config } from '@/server/config';
import { createSessionToken, verifyPassword } from '@/server/auth/session';
import { consumeAttempt, loginKeysFor, resetAttempts, sweepStaleAttempts } from '@/server/services/ratelimit.service';

/**
 * Public (it has to be — it's the door). Same shape as the per-file unlock endpoint: count the
 * attempt first, then check the password, & wipe the counters once someone gets in.
 *
 * Worth being explicit about why this is rate limited at all, since verifyPassword is two cheap
 * SHA-256 digests rather than a KDF: AUTH_PASSWORD has no length floor & one correct guess owns
 * every file in the instance, so unlimited tries at a possibly short password was the widest hole
 * left in the app. The limiter is also what turns a slow drip of 401s in the logs into something
 * that stops on its own.
 */
export async function POST(request: Request) {
  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
  // a malformed body never reaches the comparison, so it doesn't burn an attempt
  if (typeof password !== 'string' || password === '') {
    return Response.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const keys = await loginKeysFor(request);
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

  if (!(await verifyPassword(password))) {
    return Response.json(
      { error: 'Incorrect password', attemptsRemaining: limit.attemptsRemaining },
      { status: 401 },
    );
  }

  // only this client's counter, never the global backstop => a successful login shouldn't hand
  // an IP rotating attacker a fresh budget just because the owner happened to sign in.
  await resetAttempts(keys.slice(0, 1));

  const response = Response.json({ ok: true });
  response.headers.append(
    'Set-Cookie',
    [
      `${SESSION_COOKIE}=${await createSessionToken()}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
      config.isProduction ? 'Secure' : '',
    ]
      .filter(Boolean)
      .join('; '),
  );
  return response;
}
