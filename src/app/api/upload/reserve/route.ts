import { requireAuth } from '@/server/auth/guard';
import { UnsupportedFileTypeError, reserveUpload, sweepStalePending } from '@/server/services/files.service';
import { WeakPasswordError, assertUsablePassword } from '@/server/services/protection.service';
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
  let password: unknown;
  try {
    ({ filename, password } = await request.json());
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (typeof filename !== 'string' || !filename.trim()) {
    return Response.json({ error: 'filename is required' }, { status: 400 });
  }

  // the password only ever arrives in a POST body => never a query string, never a URL.
  let protect: string | undefined;
  if (password !== undefined && password !== null && password !== '') {
    if (typeof password !== 'string') {
      return Response.json({ error: 'password must be a string' }, { status: 400 });
    }
    try {
      assertUsablePassword(password);
    } catch (error) {
      if (error instanceof WeakPasswordError) return Response.json({ error: error.message }, { status: 400 });
      throw error;
    }
    protect = password;
  }

  // same fire & forget as the unlock route: a failed sweep must not become an unhandled rejection
  void sweepStalePending().catch(() => {});

  try {
    const row = await reserveUpload(filename, { password: protect });
    return Response.json({
      id: row.id,
      pathname: row.pathname,
      contentType: row.contentType,
      // the client needs these to show the right share URL for the finished upload
      slug: row.customName,
      protected: row.protectedAt !== null,
    });
  } catch (error) {
    if (error instanceof UnsupportedFileTypeError) {
      return Response.json({ error: error.message }, { status: 415 });
    }
    throw error;
  }
}

