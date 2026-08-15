export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function publicUrlFor(pathname: string): string {
  const host = process.env.NEXT_PUBLIC_CDN_HOST;
  if (host) return `https://${host}/${pathname}`;
  // dev fallback => serve from the current origin under /f/ when no CDN host is set.
  if (typeof window !== 'undefined') return `${window.location.origin}/f/${pathname}`;
  return `/f/${pathname}`;
}

/**
 * Share URL for a password protected file. Deliberately ignores NEXT_PUBLIC_CDN_HOST & stays on
 * the app origin: the unlock cookie is set by whichever host served /p/, so pointing this at the
 * CDN host would unlock on one host & 404 on the other.
 */
export function protectedUrlFor(slug: string): string {
  if (typeof window !== 'undefined') return `${window.location.origin}/p/${slug}`;
  return `/p/${slug}`;
}

/**
 * Same-origin file URL, for the one case where the CDN host must not be used: a protected
 * file's bytes are only served to a request carrying the unlock cookie.
 */
export function originFileUrlFor(name: string): string {
  if (typeof window !== 'undefined') return `${window.location.origin}/f/${name}`;
  return `/f/${name}`;
}
