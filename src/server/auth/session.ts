import { SESSION_MAX_AGE_SECONDS, config } from '../config';
import { DEMO_PASSWORD, isDemoMode } from '@/lib/demo';

/**
 * Web Crypto rather than node:crypto so the same verification runs in middleware (Edge)
 * & in route handlers (Node).
 */

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function getKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(config.sessionSecret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Token format: <base64url payload>.<base64url hmac>, payload = { exp } */
export async function createSessionToken(): Promise<string> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({ exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 })));
  const signature = await crypto.subtle.sign('HMAC', await getKey(), encoder.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = await crypto.subtle.sign('HMAC', await getKey(), encoder.encode(payload));
  if (!timingSafeEqual(signature, base64UrlEncode(new Uint8Array(expected)))) return false;

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
