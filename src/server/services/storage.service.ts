import { del, get, head, type PutBlobResult } from '@vercel/blob';

/**
 * The sole boundary to Vercel Blob. Everything else speaks in terms of these functions,
 * so swapping the storage backend stays a contained change.
 *
 * All blobs are stored with access: 'private'. The only path to the bytes is our CDN route,
 * which is what makes "trashed files 404" & the sandboxed headers for HTML/SVG actually
 * enforceable rather than advisory.
 */

const ACCESS = 'private' as const;

export type BlobMetadata = {
  size: number;
  contentType: string;
  etag: string;
  url: string;
};

export async function headBlob(blobPathname: string): Promise<BlobMetadata | null> {
  try {
    const result = await head(blobPathname);
    return {
      size: result.size,
      contentType: result.contentType,
      etag: result.etag,
      url: result.url,
    };
  } catch {
    return null;
  }
}

export type BlobStream = {
  status: 200 | 206 | 304;
  stream: ReadableStream<Uint8Array> | null;
  /** Only what the CDN route needs => avoids leaking undici's Headers type across the boundary. */
  contentRange: string | null;
  contentLength: string | null;
};

/**
 * Range is forwarded via the `headers` escape hatch because get() types itself as 200|304
 * & does not model 206. The upstream status is read back off the response headers.
 */
export async function getBlobStream(
  blobPathname: string,
  options: { range?: string; ifNoneMatch?: string } = {},
): Promise<BlobStream | null> {
  const result = await get(blobPathname, {
    access: ACCESS,
    // read from origin, not the edge cache => the cache path can silently drop the Range
    // header, & our 206 detection below hinges on upstream returning content-range
    useCache: false,
    ...(options.ifNoneMatch ? { ifNoneMatch: options.ifNoneMatch } : {}),
    ...(options.range ? { headers: { Range: options.range } } : {}),
  });

  if (!result) return null;

  const contentRange = result.headers.get('content-range');
  const contentLength = result.headers.get('content-length');

  if (result.statusCode === 304) {
    return { status: 304, stream: null, contentRange, contentLength };
  }

  return {
    status: contentRange ? 206 : 200,
    stream: result.stream as ReadableStream<Uint8Array>,
    contentRange,
    contentLength,
  };
}

export async function deleteBlob(blobPathname: string): Promise<void> {
  await del(blobPathname);
}

export type { PutBlobResult };
export { ACCESS as BLOB_ACCESS };
