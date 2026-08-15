import { test } from 'node:test';
import assert from 'node:assert/strict';

// unlock.ts reads SESSION_SECRET through server/config at call time => set it before importing.
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars-long';

const { createGrant, verifyGrant, buildGrantCookie, grantCookieName, GRANT_MAX_AGE_SECONDS } =
  await import('../src/server/auth/unlock.ts');
const { createSessionToken } = await import('../src/server/auth/session.ts');

const file = { id: '11111111-1111-4111-8111-111111111111', protectedAt: new Date('2026-01-01T00:00:00Z') };

test('a fresh grant verifies for the file it was minted for', async () => {
  const token = await createGrant(file);
  assert.equal(await verifyGrant(token, file), true);
});

test('a grant is bound to one file id', async () => {
  const token = await createGrant(file);
  const other = { ...file, id: '22222222-2222-4222-8222-222222222222' };
  assert.equal(await verifyGrant(token, other), false);
});

test('rotating the password retires every outstanding grant', async () => {
  const token = await createGrant(file);
  const rotated = { ...file, protectedAt: new Date('2026-01-02T00:00:00Z') };
  assert.equal(await verifyGrant(token, rotated), false);
});

test('an unprotected file accepts no grant at all', async () => {
  const token = await createGrant(file);
  assert.equal(await verifyGrant(token, { ...file, protectedAt: null }), false);
});

test('a missing, empty or tampered token verifies false', async () => {
  const token = await createGrant(file);
  const [payload, signature] = token.split('.');

  assert.equal(await verifyGrant(undefined, file), false);
  assert.equal(await verifyGrant('', file), false);
  assert.equal(await verifyGrant('not-a-token', file), false);
  assert.equal(await verifyGrant(payload!, file), false);
  // payload rewritten to another file, old signature kept
  const forged = Buffer.from(JSON.stringify({ f: 'other', v: 0, exp: 9e12 })).toString('base64url');
  assert.equal(await verifyGrant(`${forged}.${signature}`, file), false);
});

test('an expired grant verifies false', async () => {
  const expired = { f: file.id, v: file.protectedAt.getTime(), exp: Math.floor(Date.now() / 1000) - 1 };
  // signed properly, just stale => this is the clock check, not the mac check
  const { hmacSign } = await import('../src/lib/crypto.ts');
  const payload = Buffer.from(JSON.stringify(expired)).toString('base64url');
  const token = `${payload}.${await hmacSign(process.env.SESSION_SECRET!, `unlock:v1.${payload}`)}`;
  assert.equal(await verifyGrant(token, file), false);
});

test('a login session token cannot be pasted in as a grant', async () => {
  const session = await createSessionToken();
  assert.equal(await verifyGrant(session, file), false);
});

test('the cookie is per file, httponly & capped at the grant lifetime', async () => {
  const cookie = buildGrantCookie(file.id, await createGrant(file));
  assert.equal(grantCookieName(file.id), `ah_unlock_${file.id}`);
  assert.match(cookie, new RegExp(`^ah_unlock_${file.id}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, new RegExp(`Max-Age=${GRANT_MAX_AGE_SECONDS}`));
});
