import { listFiles } from '@/server/services/files.service';
import { listDemoFiles } from '@/server/demo/dataset';
import { isDemoMode } from '@/lib/demo';
import { parseLimit } from '@/lib/list-params';
import { toPublicFile } from '@/lib/public-file';
import type { FileCategory } from '@/lib/mime';

/**
 * Public, unauthenticated. The gallery only ever exposes files the admin has explicitly
 * listed => everything else stays URL only & never surfaces here.
 *
 * Every row goes through toPublicFile, which strips a protected file down to its id & slug.
 * The search & category filters in listFiles get the same treatment in listedOnly mode =>
 * see the comments there, the payload being clean is not on its own enough.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const category = (searchParams.get('category') ?? '') as FileCategory | '';
  const cursor = searchParams.get('cursor') ?? undefined;
  const limit = parseLimit(searchParams.get('limit'));

  const result = isDemoMode()
    ? listDemoFiles({ q, category, cursor, limit, listedOnly: true })
    : await listFiles({ q, category, cursor, limit, listedOnly: true });

  return Response.json({
    rows: result.rows.map(toPublicFile),
    nextCursor: result.nextCursor,
  });
}
