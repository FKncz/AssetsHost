/**
 * Runs once per server instance, before the first request is served (Next awaits register()).
 * Provisioning here means a cold start pays for the schema check instead of the first visitor.
 *
 * Correctness doesn't depend on this file => every db call goes through getdb(), which awaits
 * the same memoized bootstrap. This is just the earliest convenient place to trigger it, which
 * is also why a failure only logs: a database that's briefly unreachable at boot shouldn't stop
 * the server from starting, the request that actually needs it will retry & report properly.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // middleware runs on Edge, no db there

  const { ensureSchema } = await import('@/server/db/bootstrap');
  try {
    await ensureSchema();
  } catch (error) {
    console.error('[db] schema bootstrap failed at startup, will retry on first request', error);
  }
}
