import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, config } from '@/server/config';
import { createSessionToken, verifyPassword } from '@/server/auth/session';

export async function POST(request: Request) {
  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (typeof password !== 'string' || !(await verifyPassword(password))) {
    return Response.json({ error: 'Incorrect password' }, { status: 401 });
  }

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
