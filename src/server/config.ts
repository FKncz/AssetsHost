import { isDemoMode } from '@/lib/demo';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// demo instances deploy with zero secrets => fall back to a fixed key just to sign the session
// cookie. safe because the demo grants no real access (static assets, no db, public password).
const DEMO_SESSION_SECRET = 'assetshost-demo-session-secret-not-a-real-secret';

export const config = {
  get demoMode() {
    return isDemoMode();
  },
  get sessionSecret() {
    if (isDemoMode()) return process.env.SESSION_SECRET || DEMO_SESSION_SECRET;
    return required('SESSION_SECRET');
  },
  get authPassword() {
    return required('AUTH_PASSWORD');
  },
  /** Hostname that serves public files. Empty in development, where /f/:name is used instead. */
  get cdnHost() {
    return process.env.CDN_HOST ?? '';
  },
  get isProduction() {
    return process.env.NODE_ENV === 'production';
  },
} as const;

export const SESSION_COOKIE = 'assetshost_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
