import { getFileTypeSpec } from '@/lib/mime';

/**
 * Safe because a pathname is never reused for different bytes: uploads auto-suffix on
 * collision, so a given URL always maps to the same content.
 */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** RFC 5987 encoding so non-ASCII filenames survive the header intact. */
function contentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function buildFileHeaders(file: {
  pathname: string;
  extension: string;
  contentType: string;
  etag: string | null;
}): Headers {
  const spec = getFileTypeSpec(file.extension);
  const headers = new Headers();

  headers.set('Content-Type', file.contentType);
  headers.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);
  headers.set('Accept-Ranges', 'bytes');

  // never let a browser second-guess the declared type into something executable.
  headers.set('X-Content-Type-Options', 'nosniff');

  if (file.etag) headers.set('ETag', file.etag);

  headers.set('Content-Disposition', contentDisposition(spec?.disposition ?? 'attachment', file.pathname));

  // SVG & HTML can carry script. they are served from a cookieless host, & this strips
  // their ability to load or execute anything even if opened directly.
  if (spec?.sandbox) {
    headers.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  }

  return headers;
}

/** Discord & friends need permissive CORS to fetch & render embeds. */
export function applyPublicCors(headers: Headers): void {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Timing-Allow-Origin', '*');
}

/**
 * For a password protected file, used INSTEAD OF applyPublicCors + IMMUTABLE_CACHE_CONTROL.
 * That pair is the single most dangerous thing that could survive onto a protected response:
 * Vercel's edge cache (or any shared proxy) would happily keep the bytes for a year & hand
 * them to the next anonymous caller, & wildcard CORS would let any page fetch them.
 */
export function applyPrivateHeaders(headers: Headers): void {
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Vary', 'Cookie');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.delete('Access-Control-Allow-Origin');
  headers.delete('Timing-Allow-Origin');
}
