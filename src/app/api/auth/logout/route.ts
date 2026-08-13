import { SESSION_COOKIE, config } from '@/server/config';

export async function POST() {
  const response = Response.json({ ok: true });
  response.headers.append(
    'Set-Cookie',
    [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', config.isProduction ? 'Secure' : '']
      .filter(Boolean)
      .join('; '),
  );
  return response;
}
