/**
 * Shared parse for the `?limit=` query on the file listing endpoints.
 * absent/empty/non-numeric/<1 all fall back to 50 (Number(null) is 0, not NaN),
 * & anything past 100 is clamped so a client can't ask for an unbounded page.
 * kept in one place so /api/files & /api/gallery can't drift apart.
 */
export function parseLimit(raw: string | null): number {
  const parsed = Number(raw ?? '');
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(Math.floor(parsed), 100) : 50;
}
