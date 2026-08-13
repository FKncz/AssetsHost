import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

import { isAuthenticated } from '@/server/auth/guard';
import { getFileTypeSpec } from '@/lib/mime';
import { findPendingById, markReady } from '@/server/services/files.service';

/** 5 TB is the Blob ceiling => a sanity bound, not a product limit. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!(await isAuthenticated())) throw new Error('Unauthorized');

        // the token is scoped to a reservation this session already made, so a leaked
        // token cannot be used to write to an arbitrary pathname.
        const reservationId = typeof clientPayload === 'string' ? clientPayload : '';
        const reservation = await findPendingById(reservationId);
        if (!reservation) throw new Error('No matching upload reservation');
        if (reservation.blobPathname !== pathname) throw new Error('Pathname does not match reservation');

        const spec = getFileTypeSpec(reservation.extension);
        if (!spec) throw new Error('Unsupported file type');

        return {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: spec.mime,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          tokenPayload: reservation.id,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // does not fire in local dev (Blob cannot reach localhost) => /api/upload/complete
        // is the primary path. idempotent, so both running is harmless.
        if (!tokenPayload) return;
        await markReady(tokenPayload, {
          size: 'size' in blob ? (blob.size as number) : 0,
          contentType: blob.contentType ?? 'application/octet-stream',
          etag: 'etag' in blob ? (blob.etag as string) : '',
          blobUrl: blob.url,
        });
      },
    });

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
