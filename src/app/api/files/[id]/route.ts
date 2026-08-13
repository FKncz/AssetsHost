import { requireAuth } from '@/server/auth/guard';
import { CustomNameTakenError, setCustomName, setListed, trashFile } from '@/server/services/files.service';
import { isValidCustomName } from '@/lib/filename';
import { isDemoMode } from '@/lib/demo';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

  // demo => nothing is real to delete. pretend it worked, the client drops the row locally
  // & a reload brings the seed dataset back untouched.
  if (isDemoMode()) return Response.json({ ok: true });

  const row = await trashFile(id);
  if (!row) return Response.json({ error: 'File not found or already trashed' }, { status: 404 });

  return Response.json({ ok: true });
}

/**
 * Admin only edits to a single file: gallery visibility (`listed`) & the vanity alias
 * (`customName`). Both are optional => send just the field you're changing. An empty
 * customName clears the alias.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

  let body: { listed?: unknown; customName?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // demo => edits are for show only. validate the alias like normal (so the demo still teaches
  // the real rules) but persist nothing, & echo the requested values back so the optimistic
  // UI reflects the change until the next reload wipes it.
  if (isDemoMode()) {
    const patch: { listed?: boolean; customName?: string | null } = {};
    if (typeof body.listed === 'boolean') patch.listed = body.listed;
    if (body.customName !== undefined) {
      const raw = String(body.customName).trim();
      const next = raw === '' ? null : raw;
      if (next !== null && !isValidCustomName(next)) {
        return Response.json(
          { error: 'Custom name may only contain lowercase letters, digits & single dashes' },
          { status: 400 },
        );
      }
      patch.customName = next;
    }
    if (patch.listed === undefined && patch.customName === undefined) {
      return Response.json({ error: 'Nothing to update' }, { status: 400 });
    }
    return Response.json({ ok: true, file: patch });
  }

  let row = null;

  if (typeof body.listed === 'boolean') {
    row = await setListed(id, body.listed);
    if (!row) return Response.json({ error: 'File not found' }, { status: 404 });
  }

  if (body.customName !== undefined) {
    // empty string => clear the alias; anything else must pass the alias format
    const raw = String(body.customName).trim();
    const next = raw === '' ? null : raw;
    if (next !== null && !isValidCustomName(next)) {
      return Response.json(
        { error: 'Custom name may only contain lowercase letters, digits & single dashes' },
        { status: 400 },
      );
    }
    try {
      row = await setCustomName(id, next);
    } catch (error) {
      if (error instanceof CustomNameTakenError) {
        return Response.json({ error: 'That custom name is already taken' }, { status: 409 });
      }
      throw error;
    }
    if (!row) return Response.json({ error: 'File not found' }, { status: 404 });
  }

  if (!row) return Response.json({ error: 'Nothing to update' }, { status: 400 });

  return Response.json({ ok: true, file: row });
}
