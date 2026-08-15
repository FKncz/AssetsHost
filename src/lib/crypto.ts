/**
 * Web Crypto only, zero imports. Two reasons for both rules:
 *  - middleware runs on Edge, so node:crypto is off the table & the same code has to verify a
 *    token in middleware & in a route handler
 *  - no config import means no env read at import time, so `node --test` can load this file
 *    directly (see tests/crypto.test.ts). every function takes its secret as an argument.
 *
 * PBKDF2 rather than bcrypt/argon2 because those are native modules, which the Replit sandbox
 * & Vercel's bundler both make painful, & crypto.subtle already covers it.
 */

const encoder = new TextEncoder();

/** iterations, OWASP's current PBKDF2-SHA256 figure. bump freely, old hashes carry their own. */
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

export function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Compares two strings without leaking where they diverge. Length is not secret here. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function hmacSign(secret: string, message: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message));
  return base64UrlEncode(new Uint8Array(signature));
}

/**
 * Recomputes rather than calling crypto.subtle.verify => the comparison stays ours, so a
 * malformed signature can't throw & the check reads the same as the one in session.ts.
 */
export async function hmacVerify(secret: string, message: string, signature: string): Promise<boolean> {
  return timingSafeEqual(signature, await hmacSign(secret, message));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) throw new Error('not hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    // BufferSource wants a plain ArrayBuffer view; a Uint8Array over a SharedArrayBuffer
    // wouldn't typecheck, which is why the slice is spelled out.
    { name: 'PBKDF2', salt: salt.slice(), iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Encoded as pbkdf2$sha256$<iters>$<salt hex>$<hash hex> => self describing, no migration. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPasswordHash(password: string, encoded: string | null | undefined): Promise<boolean> {
  if (!encoded) return false;

  const parts = encoded.split('$');
  if (parts.length !== 5) return false;
  const [scheme, digest, iterations, saltHex, hashHex] = parts;
  if (scheme !== 'pbkdf2' || digest !== 'sha256') return false;

  const rounds = Number(iterations);
  // an absurd iteration count in a tampered string would otherwise be a free CPU burn.
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5_000_000) return false;

  try {
    const derived = await pbkdf2(password, fromHex(saltHex), rounds);
    return timingSafeEqual(toHex(derived), hashHex);
  } catch {
    return false; // malformed salt/hash hex
  }
}
