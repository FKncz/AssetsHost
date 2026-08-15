import { cookies } from 'next/headers';

import { base64UrlDecode, base64UrlEncode, hmacSign, timingSafeEqual } from '@/lib/crypto';
import { config } from '../config';
import { isAuthenticated } from './guard';

/**
 * Unlock grants => proof that a visitor typed the right password for one specific file.
 *
 * Signed with SESSION_SECRET like the login cookie, but under its own prefix so a session
 * token can never be pasted in as a grant (or the other way round). HttpOnly, so the browser
 * can hold it but no script can read or forge it.
 */

const GRANT_PREFIX = 'unlock:v1';
export const GRANT_MAX_AGE_SECONDS = 60 * 60;

type ProtectedFile = { id: string; protectedAt: Date | null };

type GrantPayload = {
  /** file id */
  f: string;
  /** protectedAt in ms => the grant version. rotating the password moves it & retires the grant. */
  v: number;
  exp: number;
};

const encoder = new TextEncoder();

/** One cookie per file, so a visitor with many unlocked files can't blow past the 4KB header cap. */
export function grantCookieName(fileId: string): string {
  return `ah_unlock_${fileId}`;
}

function signedMessage(payload: string): string {
  return `${GRANT_PREFIX}.${payload}`;
}

export async function createGrant(file: ProtectedFile): Promise<string> {
  if (!file.protectedAt) throw new Error('Cannot grant access to an unprotected file');

  const claims: GrantPayload = {
    f: file.id,
    v: file.protectedAt.getTime(),
    exp: Date.now() + GRANT_MAX_AGE_SECONDS * 1000,
  };
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  return `${payload}.${await hmacSign(config.sessionSecret, signedMessage(payload))}`;
}

export async function verifyGrant(token: string | undefined, file: ProtectedFile): Promise<boolean> {
  if (!token || !file.protectedAt) return false;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  if (!timingSafeEqual(signature, await hmacSign(config.sessionSecret, signedMessage(payload)))) return false;

  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as GrantPayload;
    if (typeof claims.exp !== 'number' || claims.exp <= Date.now()) return false;
    if (claims.f !== file.id) return false;
    // a stale version means the password was rotated (or protection was removed & re-added)
    return claims.v === file.protectedAt.getTime();
  } catch {
    return false;
  }
}

/**
 * Path=/ because the page (/p/:slug) sets it & the bytes (/cdn/:name) read it. SameSite=Lax so a
 * normal top level navigation to the file URL still carries it.
 */
export function buildGrantCookie(fileId: string, token: string): string {
  const parts = [
    `${grantCookieName(fileId)}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${GRANT_MAX_AGE_SECONDS}`,
  ];
  if (config.isProduction) parts.push('Secure');
  return parts.join('; ');
}

/**
 * The one question every protected surface asks: may this request see this file? An admin
 * session bypasses per-file passwords so dashboard previews keep working.
 */
export async function hasUnlockAccess(file: ProtectedFile): Promise<boolean> {
  if (!file.protectedAt) return true;

  const store = await cookies();
  if (await verifyGrant(store.get(grantCookieName(file.id))?.value, file)) return true;
  return isAuthenticated();
}
