import { applyPrivateHeaders, applyPublicCors, buildFileHeaders } from '@/server/http/headers';
import { hasUnlockAccess } from '@/server/auth/unlock';
import { findServableByName } from '@/server/services/files.service';
import { getBlobStream } from '@/server/services/storage.service';
import type { FileRow } from '@/server/db/schema';

/**
 * Public, unauthenticated. Trashed or still-uploading files are indistinguishable from missing.
 *
 * This route is also the ONLY gate on a password protected file's bytes: storage.service stores
 * every blob with access: 'private', so there is no second path to them. Middleware can't help
 * (it runs on Edge with no DB), which is why the check lives here, in both GET and HEAD.
 */
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;

  // flat namespace => a nested path can never be a real file.
  if (path.length !== 1) return notFound();

  const name = decodeURIComponent(path[0]);
  const file = await findServableByName(name);
  if (!file) return notFound();
  if (!(await hasUnlockAccess(file))) return notFound();

  const ifNoneMatch = request.headers.get('if-none-match') ?? undefined;
  if (file.etag && ifNoneMatch && matchesEtag(ifNoneMatch, file.etag)) {
    return new Response(null, { status: 304, headers: headersFor(file) });
  }

  const range = request.headers.get('range') ?? undefined;

  const result = await getBlobStream(file.blobPathname, { range });
  if (!result) return notFound();

  const headers = headersFor(file);

  if (result.status === 206) {
    if (result.contentRange) headers.set('Content-Range', result.contentRange);
    if (result.contentLength) headers.set('Content-Length', result.contentLength);
    return new Response(result.stream, { status: 206, headers });
  }

  headers.set('Content-Length', String(file.size));
  return new Response(result.stream, { status: 200, headers });
}

/**
 * Answered from the DB alone => no reason to pull bytes just to discard them. Content-Length &
 * Content-Type are metadata, so this needs the identical gate, not a lighter one.
 */
export async function HEAD(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.length !== 1) return new Response(null, { status: 404 });

  const file = await findServableByName(decodeURIComponent(path[0]));
  if (!file) return new Response(null, { status: 404 });
  if (!(await hasUnlockAccess(file))) return new Response(null, { status: 404 });

  const headers = headersFor(file);
  headers.set('Content-Length', String(file.size));
  return new Response(null, { status: 200, headers });
}

/**
 * Protected files swap the immutable/public-CORS pair for private, no-store + Vary: Cookie.
 * Leaving the public pair on would let a shared cache serve the bytes to the next caller,
 * which would defeat the gate above entirely.
 */
function headersFor(file: FileRow): Headers {
  const headers = buildFileHeaders(file);
  if (file.protectedAt) applyPrivateHeaders(headers);
  else applyPublicCors(headers);
  return headers;
}

function matchesEtag(ifNoneMatch: string, etag: string): boolean {
  const normalize = (v: string) => v.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  if (ifNoneMatch.trim() === '*') return true;
  return ifNoneMatch.split(',').some((candidate) => normalize(candidate) === normalize(etag));
}

/** Byte for byte what a missing file returns => a protected file without a grant IS missing. */
function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}
