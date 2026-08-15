/**
 * Smoke test for the per-file password boundary, against a real Postgres.
 *
 * It talks to the running dev server over HTTP & to the database directly, because the point is
 * the seam between them: a protected row must be unreachable through /cdn until the unlock
 * endpoint has handed out a cookie. Nothing here needs Vercel Blob => the row it inserts points
 * at a blob that doesn't exist, so a pass looks like "404 while locked, then 4xx/5xx from the
 * storage fetch once unlocked", never "200 bytes".
 *
 * usage: pnpm dev  (in one shell)
 *        node scripts/smoke-protected.mjs [baseUrl]
 *
 * cleans up its own row & protection on the way out, including on failure.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import postgres from 'postgres';

const BASE = process.argv[2] ?? 'http://localhost:5000';
const PASSWORD = 'smoke-password-correct';

function loadenv() {
  if (process.env.DATABASE_URL) return;
  for (const file of ['.env.local', '.env']) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      if (process.env[key] === undefined) process.env[key] = raw.trim().replace(/^(['"])(.*)\1$/s, '$2');
    }
  }
}

let failures = 0;

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` => ${detail}` : ''}`);
  }
}

loadenv();
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (put it in .env.local)');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
const id = randomUUID();
const slug = `smoke-${id.slice(0, 8)}`;
const pathname = `${slug}.txt`;
// a second, unprotected row => the control for the header checks. without it "no immutable cache
// on a protected file" would also pass on an app that never sets one.
const plainId = randomUUID();
const plainPathname = `smoke-plain-${plainId.slice(0, 8)}.txt`;

// pbkdf2 hash in the same encoding protection.service writes, built here so the script needs
// none of the app's modules (they're TS & alias imports).
async function hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210_000 },
    key,
    256,
  );
  const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$sha256$210000$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}

async function cleanup() {
  await sql`delete from file_protections where file_id = ${id}`.catch(() => {});
  await sql`delete from unlock_attempts where key like ${`${id}%`}`.catch(() => {});
  await sql`delete from files where id in (${id}, ${plainId})`.catch(() => {});
  await sql.end({ timeout: 5 });
}

try {
  console.log(`smoke: ${BASE}  file ${pathname}  slug ${slug}\n`);

  await sql`
    insert into files (id, pathname, extension, custom_name, listed, protected_at, blob_url,
                       blob_pathname, content_type, size, status, uploaded_at)
    values (${id}, ${pathname}, 'txt', ${slug}, true, now(),
            ${`https://example.invalid/${pathname}`}, ${pathname}, 'text/plain', 12, 'ready', now())
  `;
  await sql`insert into file_protections (file_id, password_hash) values (${id}, ${await hash(PASSWORD)})`;
  await sql`
    insert into files (id, pathname, extension, listed, blob_url, blob_pathname, content_type,
                       size, status, uploaded_at)
    values (${plainId}, ${plainPathname}, 'txt', false, ${`https://example.invalid/${plainPathname}`},
            ${plainPathname}, 'text/plain', 12, 'ready', now())
  `;

  // 1. locked: the bytes are a 404, & so is the alias
  const cold = await fetch(`${BASE}/cdn/${pathname}`, { redirect: 'manual' });
  check('GET /cdn/:pathname is 404 while locked', cold.status === 404, `got ${cold.status}`);
  const coldAlias = await fetch(`${BASE}/cdn/${slug}`, { redirect: 'manual' });
  check('GET /cdn/:slug is 404 while locked', coldAlias.status === 404, `got ${coldAlias.status}`);
  // HEAD answers from the db alone, so it would leak size & mime if it skipped the gate
  const coldHead = await fetch(`${BASE}/cdn/${pathname}`, { method: 'HEAD', redirect: 'manual' });
  check('HEAD /cdn/:pathname is 404 while locked', coldHead.status === 404, `got ${coldHead.status}`);
  check('locked HEAD carries no content-length', !coldHead.headers.get('content-length'));

  // 2. the gallery may name it, but must carry nothing else about it
  const gallery = await fetch(`${BASE}/api/gallery`);
  const rows = gallery.ok ? (await gallery.json()).rows ?? [] : [];
  const listed = rows.find((r) => r.name === slug);
  check('gallery lists the locked file', Boolean(listed));
  check(
    'gallery row carries only id/protected/name',
    !listed || Object.keys(listed).sort().join(',') === 'id,name,protected',
    listed && JSON.stringify(listed),
  );

  // 3. the share page renders without leaking the filename or size
  const page = await fetch(`${BASE}/p/${slug}`);
  const html = page.ok ? await page.text() : '';
  check('GET /p/:slug is 200', page.status === 200, `got ${page.status}`);
  check('share page does not leak the pathname', !html.includes(pathname));
  check('share page is noindex', /noindex/i.test(html) || /noindex/i.test(page.headers.get('x-robots-tag') ?? ''));

  // 4. a wrong password is a 401 & hands out no cookie
  const wrong = await fetch(`${BASE}/api/protected/${slug}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({ password: 'not-it' }),
  });
  check('wrong password is 401', wrong.status === 401, `got ${wrong.status}`);
  check('wrong password sets no cookie', !wrong.headers.get('set-cookie'));

  // 5. the correct password hands out exactly one httponly cookie for this file
  const right = await fetch(`${BASE}/api/protected/${slug}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const setCookie = right.headers.get('set-cookie') ?? '';
  check('correct password is 200', right.status === 200, `got ${right.status}`);
  check('unlock body leaks no file data', JSON.stringify(await right.json()) === '{"ok":true}');
  check('cookie is scoped to this file id', setCookie.startsWith(`ah_unlock_${id}=`), setCookie.slice(0, 40));
  check('cookie is httponly', /HttpOnly/i.test(setCookie));

  // 6. with the cookie, the gate opens. the blob url is fake, so anything but 404 means the
  //    route got past the gate & failed at storage => that's the pass condition here.
  const cookie = setCookie.split(';')[0];
  const warm = await fetch(`${BASE}/cdn/${pathname}`, { headers: { cookie }, redirect: 'manual' });
  check('the cookie gets past the gate', warm.status !== 404, `still ${warm.status}`);

  // 6b. the headers on an unlocked response. checked through HEAD because that path answers from
  //     the db & never touches the (deliberately fake) blob. leaving the immutable/public-CORS
  //     pair here is the one mistake that would hand the bytes to the next anonymous caller.
  const warmHead = await fetch(`${BASE}/cdn/${pathname}`, { method: 'HEAD', headers: { cookie } });
  check('HEAD with the cookie is 200', warmHead.status === 200, `got ${warmHead.status}`);
  check(
    'unlocked bytes are not cacheable',
    /no-store/.test(warmHead.headers.get('cache-control') ?? ''),
    warmHead.headers.get('cache-control') ?? '(none)',
  );
  check('unlocked bytes vary on cookie', /cookie/i.test(warmHead.headers.get('vary') ?? ''), warmHead.headers.get('vary') ?? '(none)');
  check('unlocked bytes carry no wildcard CORS', !warmHead.headers.get('access-control-allow-origin'));
  check('unlocked bytes are noindex', /noindex/i.test(warmHead.headers.get('x-robots-tag') ?? ''));

  // 6c. the control: an ordinary file still gets the immutable/public-CORS pair, so the checks
  //     above are really testing the protected branch & not a private-by-default app.
  const plainHead = await fetch(`${BASE}/cdn/${plainPathname}`, { method: 'HEAD' });
  check('an unprotected file is still 200 without a cookie', plainHead.status === 200, `got ${plainHead.status}`);
  check(
    'an unprotected file keeps the immutable cache',
    /immutable/.test(plainHead.headers.get('cache-control') ?? ''),
    plainHead.headers.get('cache-control') ?? '(none)',
  );
  check('an unprotected file keeps wildcard CORS', plainHead.headers.get('access-control-allow-origin') === '*');

  // 7. rotating the password retires the cookie mid-flight
  await sql`update files set protected_at = now() + interval '1 second' where id = ${id}`;
  const rotated = await fetch(`${BASE}/cdn/${pathname}`, { headers: { cookie }, redirect: 'manual' });
  check('rotating the password retires the cookie', rotated.status === 404, `got ${rotated.status}`);

  // 8. the per-client cap trips inside one window
  let limited = 0;
  for (let n = 0; n < 8; n++) {
    const res = await fetch(`${BASE}/api/protected/${slug}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.7' },
      body: JSON.stringify({ password: 'still-not-it' }),
    });
    if (res.status === 429) limited++;
  }
  check('brute force trips the rate limit', limited > 0, `no 429 in 8 tries`);
} catch (err) {
  failures++;
  console.log(`\nthrew: ${err?.stack ?? err}`);
} finally {
  await cleanup();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
