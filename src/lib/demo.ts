/**
 * Demo mode flips the whole app into a read only, for-show instance that needs no
 * Postgres, no Vercel Blob & no real password => safe to deploy publicly off the same repo.
 *
 * Two flags because middleware/route handlers read the server one & client components can
 * only see NEXT_PUBLIC_* at build time:
 *   DEMO_MODE            => server (config, routes, middleware)
 *   NEXT_PUBLIC_DEMO_MODE => client (login prefill, fake uploads)
 * Set both to "true" on a demo deploy, leave both unset for a normal self-hosted instance.
 */

/** Server side check. Safe in Edge (middleware) & Node (route handlers). */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

/** Client side flag, inlined at build time. */
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

/** The only password the demo accepts. Intentionally public => it's a showcase, not a secret. */
export const DEMO_PASSWORD = 'outofmemory';
