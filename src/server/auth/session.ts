import { SESSION_MAX_AGE_SECONDS, config } from '../config';
import { base64UrlDecode, base64UrlEncode, hmacSign, timingSafeEqual } from '@/lib/crypto';
import { DEMO_PASSWORD, isDemoMode } from '@/lib/demo';

/**
 * The crypto primitives live in lib/crypto.ts (Web Crypto, no imports) so the same code runs
 * in middleware (Edge) & in route handlers (Node), & so they can be unit tested without env.
 */

const encoder = new TextEncoder();

/** Token format: <base64url payload>.<base64url hmac>, payload = { exp } */
export async function createSessionToken(): Promise<string> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({ exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 })));
  return `${payload}.${await hmacSign(config.sessionSecret, payload)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  if (!timingSafeEqual(signature, await hmacSign(config.sessionSecret, payload))) return false;

  try {
    const { exp } = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

export async function verifyPassword(candidate: string): Promise<boolean> {
  // demo instances have no AUTH_PASSWORD => accept the one public showcase password instead.
  const expected = isDemoMode() ? DEMO_PASSWORD : config.authPassword;
  // compare digests so the check is constant time regardless of length.
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(candidate)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return timingSafeEqual(base64UrlEncode(new Uint8Array(a)), base64UrlEncode(new Uint8Array(b)));
}
