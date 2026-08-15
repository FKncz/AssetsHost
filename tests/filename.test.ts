import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPathname,
  deriveSlug,
  isValidCustomName,
  sanitizeStem,
  splitFilename,
  uniquifyPathname,
  uniquifySlug,
} from '../src/lib/filename.ts';

test('a space becomes a hyphen, everywhere', () => {
  assert.equal(sanitizeStem('My Picture'), 'my-picture');
  // buildPathname takes an already sanitized stem => it only joins on the extension
  assert.equal(buildPathname(sanitizeStem('My Picture'), 'jpg'), 'my-picture.jpg');
});

test('splitFilename keeps the last dot as the extension boundary', () => {
  assert.deepEqual(splitFilename('archive.tar.gz'), { stem: 'archive.tar', extension: 'gz' });
  assert.deepEqual(splitFilename('noext'), { stem: 'noext', extension: '' });
});

test('deriveSlug flattens a filename into one url safe token', () => {
  assert.equal(deriveSlug('My picture.jpg'), 'my-picture');
  assert.equal(deriveSlug('report_final.v2.pdf'), 'report-final-v2');
  assert.equal(deriveSlug('  spaced   out .png'), 'spaced-out');
});

test('deriveSlug falls back to "file" when nothing usable survives', () => {
  assert.equal(deriveSlug('...'), 'file');
  assert.equal(deriveSlug('___.png'), 'file');
  assert.equal(deriveSlug('日本語.png'), 'file');
  assert.equal(deriveSlug(''), 'file');
});

test('a derived slug is always an acceptable custom name', () => {
  for (const name of ['My picture.jpg', 'report_final.v2.pdf', '...', '日本語.png']) {
    assert.equal(isValidCustomName(deriveSlug(name)), true, name);
  }
});

test('uniquifySlug walks -2, -3 past what is taken', () => {
  assert.equal(uniquifySlug('photo', new Set()), 'photo');
  assert.equal(uniquifySlug('photo', new Set(['photo'])), 'photo-2');
  assert.equal(uniquifySlug('photo', new Set(['photo', 'photo-2'])), 'photo-3');
  // a gap doesn't matter => it takes the first free one
  assert.equal(uniquifySlug('photo', new Set(['photo', 'photo-3'])), 'photo-2');
});

test('a long filename leaves room for the uniquify suffix', () => {
  const slug = deriveSlug(`${'a'.repeat(400)}.png`);
  // taken up to -9999, the widest suffix uniquifySlug can produce
  const collided = uniquifySlug(slug, new Set([slug, ...Array.from({ length: 20 }, (_, i) => `${slug}-${i + 2}`)]));
  assert.ok(isValidCustomName(slug), slug);
  assert.ok(isValidCustomName(collided), collided);
  assert.ok(`${slug}-9999`.length <= 100, `${slug}-9999`.length.toString());
});

test('uniquifyPathname keeps the extension while suffixing the stem', () => {
  assert.equal(uniquifyPathname('a-b', 'png', new Set()), 'a-b.png');
  assert.equal(uniquifyPathname('a-b', 'png', new Set(['a-b.png'])), 'a-b-2.png');
});
