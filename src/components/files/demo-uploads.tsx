'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import type { FileRow } from '@/server/db/schema';
import { splitFilename, uniquifyPathname } from '@/lib/filename';
import { getFileTypeSpec } from '@/lib/mime';

/**
 * Session-only store for fake uploads in demo mode. Files live purely in browser memory as
 * object URLs => they show up & are interactive, but nothing is persisted & a reload wipes
 * everything (the state & the object URLs both die with the page).
 */

export type DemoUpload = { row: FileRow; objectUrl: string };

type DemoUploadsContext = {
  uploads: DemoUpload[];
  /** Builds a synthetic row (space => hyphen in name & URL, same as a real upload) & returns it. */
  addUpload: (file: File) => FileRow;
  removeUpload: (id: string) => void;
  urlFor: (id: string) => string | undefined;
};

const Context = createContext<DemoUploadsContext | null>(null);

export function DemoUploadsProvider({ children }: { children: React.ReactNode }) {
  const [uploads, setUploads] = useState<DemoUpload[]>([]);
  // keep the object URLs around so we can revoke them on unmount without stale closures
  const urlsRef = useRef<Set<string>>(new Set());

  const addUpload = useCallback((file: File): FileRow => {
    const { stem, extension } = splitFilename(file.name);
    const objectUrl = URL.createObjectURL(file);
    urlsRef.current.add(objectUrl);

    let row!: FileRow;
    setUploads((current) => {
      // uniquify against names already faked this session so "a b.png" twice => a-b.png, a-b-2.png
      const taken = new Set(current.map((u) => u.row.pathname));
      const pathname = uniquifyPathname(stem, extension || 'bin', taken);
      const spec = getFileTypeSpec(extension);
      const now = new Date();
      row = {
        id: `demo-upload-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        pathname,
        extension,
        customName: null,
        listed: false,
        // fake uploads are never protected => the demo's one locked file is a seed row
        protectedAt: null,
        blobUrl: null,
        blobPathname: pathname,
        contentType: spec?.mime ?? file.type ?? 'application/octet-stream',
        size: file.size,
        etag: null,
        status: 'ready',
        createdAt: now,
        uploadedAt: now,
        trashedAt: null,
      };
      return [{ row, objectUrl }, ...current];
    });
    return row;
  }, []);

  const removeUpload = useCallback((id: string) => {
    setUploads((current) => {
      const hit = current.find((u) => u.row.id === id);
      if (hit) {
        URL.revokeObjectURL(hit.objectUrl);
        urlsRef.current.delete(hit.objectUrl);
      }
      return current.filter((u) => u.row.id !== id);
    });
  }, []);

  const urlFor = useCallback(
    (id: string) => uploads.find((u) => u.row.id === id)?.objectUrl,
    [uploads],
  );

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
      urls.clear();
    };
  }, []);

  return (
    <Context.Provider value={{ uploads, addUpload, removeUpload, urlFor }}>{children}</Context.Provider>
  );
}

/** Returns null outside a provider (i.e. non-demo) so callers can no-op cleanly. */
export function useDemoUploads(): DemoUploadsContext | null {
  return useContext(Context);
}
