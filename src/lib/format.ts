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
