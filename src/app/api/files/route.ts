import { requireAuth } from '@/server/auth/guard';
import { listFiles } from '@/server/services/files.service';
import { listDemoFiles } from '@/server/demo/dataset';
import { isDemoMode } from '@/lib/demo';
import { parseLimit } from '@/lib/list-params';
import type { FileCategory } from '@/lib/mime';

export async function GET(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const category = (searchParams.get('category') ?? '') as FileCategory | '';
  const cursor = searchParams.get('cursor') ?? undefined;
  const limit = parseLimit(searchParams.get('limit'));

  const result = isDemoMode()
    ? listDemoFiles({ q, category, cursor, limit })
    : await listFiles({ q, category, cursor, limit });

  return Response.json(result);
}
