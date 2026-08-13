'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, LayoutGrid, List, Loader2 } from 'lucide-react';
import type { FileRow } from '@/server/db/schema';
import { FILE_TYPES, type FileCategory } from '@/lib/mime';
import { FileCard } from './file-card';
import { useDemoUploads } from './demo-uploads';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type CategoryFilter = FileCategory | 'all';

const CATEGORIES: { label: string; value: CategoryFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Images', value: 'image' },
  { label: 'Video', value: 'video' },
  { label: 'Audio', value: 'audio' },
  { label: 'Documents', value: 'document' },
  { label: 'Archives', value: 'archive' },
];

interface FileGridProps {
  /** Bump this to trigger a full refresh (e.g. after a new upload completes) */
  refreshKey?: number;
}

export function FileGrid({ refreshKey = 0 }: FileGridProps) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // demo => session-only fake uploads live in context, not the server list. null outside demo.
  const demo = useDemoUploads();

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [search]);

  const load = useCallback(
    async (opts: { replace: boolean; cursorOverride?: string | null }) => {
      const { replace, cursorOverride } = opts;
      if (replace) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (category !== 'all') params.set('category', category);
      const c = cursorOverride === undefined ? cursor : cursorOverride;
      if (c) params.set('cursor', c);

      try {
        const res = await fetch(`/api/files?${params}`);
        if (!res.ok) {
          setError('Could not load files. Please try again.');
          return;
        }
        const data: { rows: FileRow[]; nextCursor: string | null } = await res.json();
        setFiles((prev) => (replace ? data.rows : [...prev, ...data.rows]));
        setCursor(data.nextCursor);
        setHasMore(data.nextCursor !== null);
      } catch {
        setError('Could not load files. Please check your connection & try again.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [debouncedSearch, category, cursor],
  );

  useEffect(() => {
    setCursor(null);
    load({ replace: true, cursorOverride: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, category, refreshKey]);

  function handleDelete(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    demo?.removeUpload(id); // no-op for server rows / outside demo
  }

  function loadMore() {
    load({ replace: false });
  }

  // fake uploads prepend to the fetched list, respecting the active search/category filters so
  // they behave like real rows. deduped in case a session id ever overlaps a fetched one.
  const sessionRows = (demo?.uploads ?? [])
    .map((u) => u.row)
    .filter((r) => {
      if (debouncedSearch && !r.pathname.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
      if (category !== 'all' && FILE_TYPES[r.extension]?.category !== category) return false;
      return true;
    });
  const seen = new Set(sessionRows.map((r) => r.id));
  const visibleFiles = [...sessionRows, ...files.filter((f) => !seen.has(f.id))];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5">
          <button
            onClick={() => setView('grid')}
            className={`rounded p-1.5 transition-colors ${view === 'grid' ? 'bg-[var(--color-border)] text-[var(--color-fg)]' : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'}`}
            aria-label="Grid view"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => setView('list')}
            className={`rounded p-1.5 transition-colors ${view === 'list' ? 'bg-[var(--color-border)] text-[var(--color-fg)]' : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'}`}
            aria-label="List view"
          >
            <List size={14} />
          </button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {CATEGORIES.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setCategory(value)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              category === value
                ? 'bg-[var(--color-accent)] text-white'
                : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-[var(--color-muted)]">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : error ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] text-[var(--color-muted)]">
          <p className="text-sm">{error}</p>
          <button
            className="text-xs text-[var(--color-accent)] hover:underline"
            onClick={() => load({ replace: true, cursorOverride: null })}
          >
            Retry
          </button>
        </div>
      ) : visibleFiles.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] text-[var(--color-muted)]">
          <p className="text-sm">No files found</p>
          {(debouncedSearch || category !== 'all') && (
            <button
              className="text-xs text-[var(--color-accent)] hover:underline"
              onClick={() => {
                setSearch('');
                setCategory('all');
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            className={
              view === 'grid'
                ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                : 'flex flex-col gap-2'
            }
          >
            {visibleFiles.map((file) => (
              <FileCard key={file.id} file={file} onDelete={handleDelete} />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="ghost" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
