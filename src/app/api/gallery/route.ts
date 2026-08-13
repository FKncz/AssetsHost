import { listFiles } from '@/server/services/files.service';
import { listDemoFiles } from '@/server/demo/dataset';
import { isDemoMode } from '@/lib/demo';
import { parseLimit } from '@/lib/list-params';
import type { FileCategory } from '@/lib/mime';

/**
 * Public, unauthenticated. The gallery only ever exposes files the admin has explicitly
 * listed => everything else stays URL only & never surfaces here.
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

  return Response.json(result);
}
