'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { FileRow } from '@/server/db/schema';
import { GalleryCard } from '@/components/files/gallery-card';
import { Button } from '@/components/ui/button';

export default function GalleryPage() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (opts: { replace: boolean; cursorOverride?: string | null }) => {
    const { replace, cursorOverride } = opts;
    if (replace) setLoading(true);
    else setLoadingMore(true);
    setError(null);

    const params = new URLSearchParams();
    if (cursorOverride) params.set('cursor', cursorOverride);

    try {
      const res = await fetch(`/api/gallery?${params}`);
      if (!res.ok) {
        setError('Could not load the gallery. Please try again.');
        return;
      }
      const data: { rows: FileRow[]; nextCursor: string | null } = await res.json();
      setFiles((prev) => (replace ? data.rows : [...prev, ...data.rows]));
      setCursor(data.nextCursor);
      setHasMore(data.nextCursor !== null);
    } catch {
      setError('Could not load the gallery. Please check your connection & try again.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    load({ replace: true, cursorOverride: null });
  }, [load]);

  return (
    <>
      <header className="border-b border-[var(--color-border)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-1.5 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-fg)]">
            <ArrowLeft size={14} />
            Back
          </Link>
          <h1 className="text-lg font-semibold">Gallery</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 p-6">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-[var(--color-muted)]">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] text-sm text-[var(--color-muted)]">
            <p>{error}</p>
            <button
              className="text-xs text-[var(--color-accent)] hover:underline"
              onClick={() => load({ replace: true, cursorOverride: null })}
            >
              Retry
            </button>
          </div>
        ) : files.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] text-sm text-[var(--color-muted)]">
            No files shared yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {files.map((file) => (
                <GalleryCard key={file.id} file={file} />
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center pt-6">
                <Button variant="ghost" onClick={() => load({ replace: false, cursorOverride: cursor })} disabled={loadingMore}>
                  {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
