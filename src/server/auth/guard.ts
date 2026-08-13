import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '../config';
import { verifySessionToken } from './session';

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** Returns a 401 Response when unauthenticated, or null when the caller may proceed. */
export async function requireAuth(): Promise<Response | null> {
  if (await isAuthenticated()) return null;
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
