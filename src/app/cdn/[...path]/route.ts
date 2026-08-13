import { applyPublicCors, buildFileHeaders } from '@/server/http/headers';
import { findServableByName } from '@/server/services/files.service';
import { getBlobStream } from '@/server/services/storage.service';

/** Public, unauthenticated. Trashed or still-uploading files are indistinguishable from missing. */
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;

  // flat namespace => a nested path can never be a real file.
  if (path.length !== 1) return notFound();

  const name = decodeURIComponent(path[0]);
  const file = await findServableByName(name);
  if (!file) return notFound();

  const ifNoneMatch = request.headers.get('if-none-match') ?? undefined;
  if (file.etag && ifNoneMatch && matchesEtag(ifNoneMatch, file.etag)) {
    const headers = buildFileHeaders(file);
    applyPublicCors(headers);
    return new Response(null, { status: 304, headers });
  }

  const range = request.headers.get('range') ?? undefined;

  const result = await getBlobStream(file.blobPathname, { range });
  if (!result) return notFound();

  const headers = buildFileHeaders(file);
  applyPublicCors(headers);

  if (result.status === 206) {
    if (result.contentRange) headers.set('Content-Range', result.contentRange);
    if (result.contentLength) headers.set('Content-Length', result.contentLength);
    return new Response(result.stream, { status: 206, headers });
  }

  headers.set('Content-Length', String(file.size));
  return new Response(result.stream, { status: 200, headers });
}

/** Answered from the DB alone => no reason to pull bytes just to discard them. */
export async function HEAD(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.length !== 1) return new Response(null, { status: 404 });

  const file = await findServableByName(decodeURIComponent(path[0]));
  if (!file) return new Response(null, { status: 404 });

  const headers = buildFileHeaders(file);
  applyPublicCors(headers);
  headers.set('Content-Length', String(file.size));
  return new Response(null, { status: 200, headers });
}

function matchesEtag(ifNoneMatch: string, etag: string): boolean {
  const normalize = (v: string) => v.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  if (ifNoneMatch.trim() === '*') return true;
  return ifNoneMatch.split(',').some((candidate) => normalize(candidate) === normalize(etag));
}

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}
