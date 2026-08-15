/**
 * Smoke test for the dashboard login rate limit, against a real Postgres.
 *
 * Talks to the running dev server over HTTP & to the database directly, because the counters live
 * in `unlock_attempts` and the point is that the route & the table agree. Every attempt here is
 * deliberately wrong except one, so nothing is created & nothing is uploaded.
 *
 * DON'T POINT THIS AT A LIVE INSTANCE. It burns the login limiter on purpose, which would lock
 * the real owner out for up to the length of one window. Default target is localhost.
 *
 * usage: AUTH_PASSWORD=… pnpm dev  (in one shell)
 *        AUTH_PASSWORD=… node scripts/smoke-login-limit.mjs [baseUrl]
 *
 * clears the login counters it inflated on the way out, including on failure.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import postgres from 'postgres';

const BASE = process.argv[2] ?? 'http://localhost:5000';
/** 10 per client per window, from LOGIN_PER_CLIENT_LIMIT in ratelimit.service.ts */
const PER_CLIENT = 10;

function loadenv() {
  if (process.env.DATABASE_URL && process.env.AUTH_PASSWORD) return;
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
if (!process.env.DATABASE_URL || !process.env.AUTH_PASSWORD) {
  console.error('DATABASE_URL & AUTH_PASSWORD are required, and must match the running server');
  process.exit(1);
}
if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  console.error(`refusing to run against ${BASE} => this test burns the login limiter`);
  process.exit(1);
}

const PASSWORD = process.env.AUTH_PASSWORD;
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
// a fresh pair of client identities per run, so a rerun isn't limited by the last one's rows
const ip = () => `198.18.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;
const attacker = ip();
const bystander = ip();

async function login(password, from) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': from },
    body: JSON.stringify({ password }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}

async function cleanup() {
  await sql`delete from unlock_attempts where key like 'login:%'`.catch(() => {});
  await sql.end({ timeout: 5 });
}

try {
  console.log(`smoke: ${BASE}  login limiter\n`);

  // 1. the first wrong guess is a plain 401 & reports what's left
  const first = await login(`wrong-${randomUUID()}`, attacker);
  check('a wrong password is 401', first.status === 401, `got ${first.status}`);
  check(
    'the 401 reports attemptsRemaining',
    first.body.attemptsRemaining === PER_CLIENT - 1,
    JSON.stringify(first.body),
  );

  // 2. walk the rest of the window down. the cap is inclusive => attempt PER_CLIENT is still 401,
  //    the one after it is the first 429.
  let last;
  for (let n = 1; n < PER_CLIENT; n++) last = await login('still-wrong', attacker);
  check(`attempt ${PER_CLIENT} is still 401`, last.status === 401, `got ${last.status}`);
  check('the last allowed attempt reports 0 left', last.body.attemptsRemaining === 0, JSON.stringify(last.body));

  const blocked = await login('still-wrong', attacker);
  check(`attempt ${PER_CLIENT + 1} is 429`, blocked.status === 429, `got ${blocked.status}`);
  check('the 429 carries Retry-After', Number(blocked.headers.get('retry-after')) > 0, blocked.headers.get('retry-after') ?? '(none)');
  check('the 429 body has no password detail', JSON.stringify(Object.keys(blocked.body).sort()) === '["error","retryAfterSeconds"]', JSON.stringify(blocked.body));

  // 3. a correct password from the blocked client is still refused => the gate is ahead of the
  //    comparison, so the cap can't be walked past by finally guessing right.
  const rightButBlocked = await login(PASSWORD, attacker);
  check('the limit outranks a correct password', rightButBlocked.status === 429, `got ${rightButBlocked.status}`);
  check('a blocked correct password sets no cookie', !rightButBlocked.headers.get('set-cookie'));

  // 4. the cap is per client, not global => somebody else is unaffected
  const other = await login('wrong-too', bystander);
  check('another client is not caught by it', other.status === 401, `got ${other.status}`);
  check('the other client has its own count', other.body.attemptsRemaining === PER_CLIENT - 1, JSON.stringify(other.body));

  // 5. logging in wipes the counters => an honest typo streak costs nothing
  const success = await login(PASSWORD, bystander);
  check('the correct password is 200', success.status === 200, `got ${success.status}`);
  check('a successful login sets the session cookie', /assetshost_session=/.test(success.headers.get('set-cookie') ?? ''));
  const afterSuccess = await login('wrong-again', bystander);
  check('a success resets the count', afterSuccess.body.attemptsRemaining === PER_CLIENT - 1, JSON.stringify(afterSuccess.body));

  // 6. the counters really are in Postgres, under their own namespace
  const rows = await sql`select key from unlock_attempts where key like 'login:%'`;
  const keys = rows.map((r) => r.key);
  check('counters are stored under login:', keys.length >= 2, keys.join(','));
  check('there is a global backstop row', keys.includes('login:all'), keys.join(','));
  check('no raw ip is stored', !keys.some((k) => k.includes(attacker) || k.includes(bystander)), keys.join(','));
} catch (err) {
  failures++;
  console.log(`\nthrew: ${err?.stack ?? err}`);
} finally {
  await cleanup();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
