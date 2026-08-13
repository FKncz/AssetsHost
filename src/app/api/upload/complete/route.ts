import { requireAuth } from '@/server/auth/guard';
import { findPendingById, markReady } from '@/server/services/files.service';
import { headBlob } from '@/server/services/storage.service';

export async function POST(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  let id: unknown;
  try {
    ({ id } = await request.json());
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (typeof id !== 'string') return Response.json({ error: 'id is required' }, { status: 400 });

  const reservation = await findPendingById(id);
  if (!reservation) return Response.json({ error: 'No pending upload with that id' }, { status: 404 });

  // trust the store, not the client, for size/type/etag.
  const metadata = await headBlob(reservation.blobPathname);
  if (!metadata) return Response.json({ error: 'Upload not found in storage' }, { status: 409 });

  const row = await markReady(id, {
    size: metadata.size,
    contentType: reservation.contentType,
    etag: metadata.etag,
    blobUrl: metadata.url,
  });

  // null => the row was swept or deleted between the lookup above & this update.
  if (!row) return Response.json({ error: 'Reservation is no longer available' }, { status: 409 });

  return Response.json({
    id: row.id,
    pathname: row.pathname,
    size: row.size,
    contentType: row.contentType,
  });
}
