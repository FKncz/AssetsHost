import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  base64UrlDecode,
  base64UrlEncode,
  hashPassword,
  hmacSign,
  hmacVerify,
  timingSafeEqual,
  verifyPasswordHash,
} from '../src/lib/crypto.ts';

test('base64url survives a roundtrip & stays url safe', () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
  const encoded = base64UrlEncode(bytes);
  assert.doesNotMatch(encoded, /[+/=]/);
  assert.deepEqual([...base64UrlDecode(encoded)], [...bytes]);
});

test('timingSafeEqual only accepts an exact match', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('', ''), true);
});

test('hashPassword round trips & rejects the wrong password', async () => {
  const encoded = await hashPassword('correct horse battery');
  assert.match(encoded, /^pbkdf2\$sha256\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(await verifyPasswordHash('correct horse battery', encoded), true);
  assert.equal(await verifyPasswordHash('correct horse batteryy', encoded), false);
  assert.equal(await verifyPasswordHash('', encoded), false);
});

test('the same password hashes differently every time => the salt is per hash', async () => {
  const a = await hashPassword('same input');
  const b = await hashPassword('same input');
  assert.notEqual(a, b);
  assert.equal(await verifyPasswordHash('same input', a), true);
  assert.equal(await verifyPasswordHash('same input', b), true);
});

test('a malformed or tampered hash string verifies false, never throws', async () => {
  const encoded = await hashPassword('pw');
  const parts = encoded.split('$');

  assert.equal(await verifyPasswordHash('pw', null), false);
  assert.equal(await verifyPasswordHash('pw', undefined), false);
  assert.equal(await verifyPasswordHash('pw', ''), false);
  assert.equal(await verifyPasswordHash('pw', 'nonsense'), false);
  // wrong scheme, & a digest swapped for one of a different password
  assert.equal(await verifyPasswordHash('pw', encoded.replace('pbkdf2', 'scrypt')), false);
  assert.equal(await verifyPasswordHash('pw', `${parts.slice(0, 4).join('$')}$deadbeef`), false);
  // an absurd iteration count in a tampered string must be refused, not honoured
  assert.equal(await verifyPasswordHash('pw', `${parts[0]}$${parts[1]}$999999999$${parts[3]}$${parts[4]}`), false);
  assert.equal(await verifyPasswordHash('pw', `${parts[0]}$${parts[1]}$0$${parts[3]}$${parts[4]}`), false);
});

test('hmac verifies only under the same secret, message & signature', async () => {
  const sig = await hmacSign('secret-key', 'unlock:v1.payload');
  assert.equal(await hmacVerify('secret-key', 'unlock:v1.payload', sig), true);
  assert.equal(await hmacVerify('other-key', 'unlock:v1.payload', sig), false);
  assert.equal(await hmacVerify('secret-key', 'unlock:v1.payloae', sig), false);
  // flip one character of the signature
  const flipped = `${sig.slice(0, -1)}${sig.at(-1) === 'A' ? 'B' : 'A'}`;
  assert.equal(await hmacVerify('secret-key', 'unlock:v1.payload', flipped), false);
});

test('prefix domain separation => a session signature is not a grant signature', async () => {
  const payload = 'eyJmIjoiMSJ9';
  const asSession = await hmacSign('k', `session:v1.${payload}`);
  assert.equal(await hmacVerify('k', `unlock:v1.${payload}`, asSession), false);
});
