'use client';

import { useState } from 'react';
import { StatsBar } from '@/components/files/stats-bar';
import { UploadDropzone } from '@/components/files/upload-dropzone';
import { FileGrid } from '@/components/files/file-grid';
import { DemoUploadsProvider } from '@/components/files/demo-uploads';
import { IS_DEMO } from '@/lib/demo';

export default function ControlPanelPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  function handleUploadComplete() {
    setRefreshKey((k) => k + 1);
  }

  const body = (
    <div className="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-6">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-muted)]">Overview</h2>
          <StatsBar refreshKey={refreshKey} />
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-muted)]">Upload</h2>
          <UploadDropzone onBatchComplete={handleUploadComplete} />
        </div>
      </aside>

      <main className="min-w-0">
        <h2 className="mb-4 text-sm font-semibold text-[var(--color-muted)]">Files</h2>
        <FileGrid refreshKey={refreshKey} />
      </main>
    </div>
  );

  // demo => wrap so the dropzone can register fake uploads & the grid can render them.
  return IS_DEMO ? <DemoUploadsProvider>{body}</DemoUploadsProvider> : body;
}
