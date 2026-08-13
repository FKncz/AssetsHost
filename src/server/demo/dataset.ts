import type { FileCategory } from '@/lib/mime';
import { FILE_TYPES, getFileTypeSpec } from '@/lib/mime';
import type { FileRow } from '../db/schema';

/**
 * The bundled sample files that a demo instance pretends to host. These map 1:1 to the assets
 * committed under public/demo, & middleware rewrites /f/:name => /demo/:name in demo so the
 * public URLs stay real looking while the bytes come straight from static assets (no DB, no Blob).
 *
 * Sizes are hardcoded from the committed files => keeps this module fs & edge free. If you swap
 * an asset, update its size here too (stat public/demo/<file>).
 */
type DemoSeed = {
  pathname: string;
  size: number;
  listed: boolean;
  customName?: string;
  /** minutes ago the file was "uploaded" => gives a stable, sensible ordering */
  agoMinutes: number;
};

// stable fake ids so a client only rename/toggle round-trips against the same row
const SEEDS: DemoSeed[] = [
  { pathname: 'sunset-gradient.jpg', size: 28_940, listed: true, customName: 'sunset', agoMinutes: 12 },
  { pathname: 'neon-orb.png', size: 778_818, listed: true, agoMinutes: 47 },
  { pathname: 'demo-clip.mp4', size: 79_881, listed: true, agoMinutes: 120 },
  { pathname: 'midnight-drive.mp3', size: 13_944_509, listed: true, agoMinutes: 300 },
  { pathname: 'readme.txt', size: 412, listed: false, agoMinutes: 1_440 },
  { pathname: 'welcome.pdf', size: 36_088, listed: false, agoMinutes: 2_880 },
  { pathname: 'assets-bundle.zip', size: 2_081, listed: false, agoMinutes: 4_320 },
];

// pinned epoch so uploadedAt (& therefore cursors) are deterministic across requests
const BASE = new Date('2026-08-01T12:00:00.000Z').getTime();

function extensionOf(pathname: string): string {
  return pathname.slice(pathname.lastIndexOf('.') + 1).toLowerCase();
}

export const DEMO_FILES: FileRow[] = SEEDS.map((seed, i) => {
  const extension = extensionOf(seed.pathname);
  const spec = getFileTypeSpec(extension);
  const uploadedAt = new Date(BASE - seed.agoMinutes * 60_000);
  return {
    // uuid-shaped but obviously fake => never collides with a real row (there is no db here)
    id: `demo-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
    pathname: seed.pathname,
    extension,
    customName: seed.customName ?? null,
    listed: seed.listed,
    blobUrl: null,
    blobPathname: seed.pathname,
    contentType: spec?.mime ?? 'application/octet-stream',
    size: seed.size,
    etag: null,
    status: 'ready',
    createdAt: uploadedAt,
    uploadedAt,
    trashedAt: null,
  } satisfies FileRow;
});

export type ListDemoOptions = {
  q?: string;
  category?: FileCategory | '';
  cursor?: string;
  limit?: number;
  listedOnly?: boolean;
};

/** In-memory mirror of listFiles: same filters, same { rows, nextCursor } contract. */
export function listDemoFiles({ q, category, cursor, limit = 50, listedOnly = false }: ListDemoOptions) {
  const cap = Math.min(limit, 100);

  let rows = DEMO_FILES.filter((f) => !f.trashedAt && f.status === 'ready');

  if (listedOnly) rows = rows.filter((f) => f.listed);

  if (q?.trim()) {
    const needle = q.trim().toLowerCase();
    rows = rows.filter((f) => f.pathname.toLowerCase().includes(needle));
  }

  if (category) {
    rows = rows.filter((f) => FILE_TYPES[f.extension]?.category === category);
  }

  // newest first, matching the desc(uploadedAt) ordering the real query uses
  rows = rows.sort((a, b) => (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0));

  if (cursor) {
    const bound = new Date(cursor).getTime();
    rows = rows.filter((f) => (f.uploadedAt?.getTime() ?? 0) < bound);
  }

  const hasMore = rows.length > cap;
  const page = hasMore ? rows.slice(0, cap) : rows;
  const nextCursor = hasMore ? (page[page.length - 1].uploadedAt?.toISOString() ?? null) : null;

  return { rows: page, nextCursor };
}

/** In-memory mirror of getStats over the demo dataset. */
export function getDemoStats() {
  const ready = DEMO_FILES.filter((f) => !f.trashedAt && f.status === 'ready');
  const byCategory: Record<string, number> = {};
  let totalBytes = 0;
  for (const f of ready) {
    totalBytes += f.size;
    const cat = FILE_TYPES[f.extension]?.category ?? 'other';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }
  return { totalFiles: ready.length, totalBytes, byCategory };
}
