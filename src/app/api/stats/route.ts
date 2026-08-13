import { requireAuth } from '@/server/auth/guard';
import { getStats } from '@/server/services/files.service';
import { getDemoStats } from '@/server/demo/dataset';
import { isDemoMode } from '@/lib/demo';

export async function GET() {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const stats = isDemoMode() ? getDemoStats() : await getStats();
  return Response.json(stats);
}
