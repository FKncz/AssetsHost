import { requireAuth } from '@/server/auth/guard';
import { UnsupportedFileTypeError, reserveUpload, sweepStalePending } from '@/server/services/files.service';
import { isDemoMode } from '@/lib/demo';

export async function POST(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  // uploads are faked entirely client side in demo => this endpoint should never be reached.
  // guard anyway so a stray call can't try to touch Blob/Postgres.
  if (isDemoMode()) {
    return Response.json({ error: 'Uploads are simulated in the demo' }, { status: 403 });
  }

  let filename: unknown;
  try {
    ({ filename } = await request.json());
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (typeof filename !== 'string' || !filename.trim()) {
    return Response.json({ error: 'filename is required' }, { status: 400 });
  }

  void sweepStalePending();

  try {
    const row = await reserveUpload(filename);
    return Response.json({ id: row.id, pathname: row.pathname, contentType: row.contentType });
  } catch (error) {
    if (error instanceof UnsupportedFileTypeError) {
      return Response.json({ error: error.message }, { status: 415 });
    }
    throw error;
  }
}
