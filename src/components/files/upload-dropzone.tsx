'use client';

import { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';

import { ACCEPT_ATTRIBUTE } from '@/lib/mime';
import { formatBytes, publicUrlFor } from '@/lib/format';
import { uploadFile } from '@/lib/upload-client';
import { IS_DEMO } from '@/lib/demo';
import { useDemoUploads } from './demo-uploads';

type UploadItem = {
  key: string;
  name: string;
  size: number;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  pathname?: string;
  /** demo => the object URL to open/copy, since there's no real /f/ file behind it */
  url?: string;
  error?: string;
};

interface UploadDropzoneProps {
  onBatchComplete?: () => void;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-accent)] transition-colors"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

export function UploadDropzone({ onBatchComplete }: UploadDropzoneProps) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(0);
  const demo = useDemoUploads();

  const update = useCallback((key: string, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }, []);

  // demo => no bytes leave the browser. animate a quick progress bar, register the file as a
  // session-only object URL, & surface it just like a real completed upload.
  const fakeUpload = useCallback(
    (key: string, file: File) => {
      let pct = 0;
      const timer = setInterval(() => {
        pct = Math.min(100, pct + 20 + Math.random() * 25);
        update(key, { progress: Math.round(pct) });
        if (pct >= 100) {
          clearInterval(timer);
          const row = demo?.addUpload(file);
          update(key, {
            status: 'done',
            progress: 100,
            pathname: row?.pathname,
            url: row ? demo?.urlFor(row.id) : undefined,
          });
          pendingRef.current -= 1;
          if (pendingRef.current === 0) onBatchComplete?.();
        }
      }, 220);
    },
    [demo, update, onBatchComplete],
  );

  const start = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length) return;
      const batch = Array.from(fileList);
      pendingRef.current += batch.length;

      for (const [index, file] of batch.entries()) {
        const key = `${Date.now()}-${index}-${file.name}`;
        setItems((current) => [
          { key, name: file.name, size: file.size, progress: 0, status: 'uploading' },
          ...current,
        ]);

        if (IS_DEMO) {
          fakeUpload(key, file);
          continue;
        }

        uploadFile(file, (pct) => update(key, { progress: pct }))
          .then((result) => update(key, { status: 'done', progress: 100, pathname: result.pathname }))
          .catch((err: Error) => update(key, { status: 'error', error: err.message }))
          .finally(() => {
            pendingRef.current -= 1;
            if (pendingRef.current === 0) onBatchComplete?.();
          });
      }
    },
    [update, onBatchComplete, fakeUpload],
  );

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload files"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); start(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          // a real button fires on both Enter & Space => match that so keyboard
          // users aren't stuck (Space would otherwise just scroll the page).
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging
            ? 'border-[var(--color-accent)] bg-[var(--color-surface)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-surface)]'
        }`}
      >
        <UploadCloud
          size={28}
          className={`mx-auto mb-3 transition-colors ${dragging ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}`}
        />
        <p className="text-sm font-medium">Drop files here or click to choose</p>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Images · Video · Audio · Documents · Archives
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(e) => { start(e.target.files); e.target.value = ''; }}
        />
      </div>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => {
            // demo carries its own object URL => real uploads resolve /f/:pathname
            const url = item.url ?? (item.pathname ? publicUrlFor(item.pathname) : '');
            return (
              <li
                key={item.key}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{item.name}</span>
                  <span className="shrink-0 text-xs text-[var(--color-muted)]">{formatBytes(item.size)}</span>
                </div>

                {item.status === 'uploading' && (
                  <div className="mt-2 h-1 overflow-hidden rounded bg-[var(--color-border)]">
                    <div
                      className="h-full bg-[var(--color-accent)] transition-[width] duration-200"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}

                {item.status === 'error' && (
                  <p className="mt-1.5 text-xs text-red-400">{item.error}</p>
                )}

                {item.status === 'done' && url && (
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-muted)]">
                      {url}
                    </code>
                    <CopyButton value={url} />
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-accent)] transition-colors"
                    >
                      Open
                    </a>
                  </div>
                )}

                {item.status === 'done' && IS_DEMO && (
                  <p className="mt-1.5 text-xs text-[var(--color-muted)]">
                    Showcase only — this upload lives in your browser & disappears on reload.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
