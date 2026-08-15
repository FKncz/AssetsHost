import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Download, ExternalLink, Lock } from 'lucide-react';

import { FileIcon } from '@/components/files/file-icon';
import { UnlockForm } from '@/components/files/unlock-form';
import { CategoryBadge } from '@/components/ui/badge';
import { CopyButton } from '@/components/ui/copy-button';
import { formatBytes } from '@/lib/format';
import { getFileTypeSpec, type FileCategory } from '@/lib/mime';
import { isDemoMode } from '@/lib/demo';
import { hasUnlockAccess } from '@/server/auth/unlock';
import { findById, findProtectedBySlug } from '@/server/services/files.service';
import { findDemoProtectedBySlug } from '@/server/demo/dataset';

/**
 * The share page for a password protected file. Two states, decided server side:
 *
 *  - no grant  => the gate. The slug is the ONLY thing about the file that reaches the HTML.
 *                 No preview, no size, no mime, no extension, no download URL. Check the
 *                 rendered source, not just the screen, when changing this.
 *  - grant     => the full view. The bytes still come from /cdn, which re-checks the cookie.
 *
 * force-dynamic because the answer depends on a cookie; noindex because a share URL has no
 * business in a search index.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Protected file · AssetsHost',
  robots: { index: false, follow: false },
};

export default async function ProtectedFilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // unknown, unprotected, pending or trashed all come back null. an unprotected file's alias
  // 404s here on purpose => it lives at /f/ instead.
  const file = isDemoMode() ? findDemoProtectedBySlug(slug) : await findProtectedBySlug(slug);
  if (!file?.protectedAt) notFound();

  if (!(await hasUnlockAccess(file))) return <Gate slug={slug} />;

  // the gate above only ever loaded three columns => now that access is settled, read the row.
  // (demo has no db, so the seed lookup stands in for findById.)
  const full = isDemoMode() ? findDemoProtectedBySlug(slug) : await findById(file.id);
  if (!full) notFound();

  const spec = getFileTypeSpec(full.extension);
  const category = spec?.category ?? 'document';
  const name = full.customName ?? full.pathname;
  // demo-only shortcut: middleware rewrites /f/ => /demo/ (a static asset) in demo mode, which
  // never reaches our route gate. so the unlocked view points straight at the bundled file. the
  // demo has no real secrets, & the gate above still ran server side before we got here.
  const url = isDemoMode() ? `/demo/${full.pathname}` : `/f/${name}`;

  return (
    <Shell>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
          <Lock size={12} />
          Unlocked for the next hour
        </div>

        <div className="flex h-48 items-center justify-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]">
          <Preview category={category} extension={full.extension} url={url} name={name} />
        </div>

        <div>
          <p className="truncate text-base font-semibold" title={name}>
            {name}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <CategoryBadge category={category} />
            <span className="text-xs text-[var(--color-muted)]">{formatBytes(full.size)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <CopyButton value={url} className="flex-1" />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open file"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            <ExternalLink size={12} />
          </a>
          <a
            href={url}
            download={full.pathname}
            aria-label="Download file"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            <Download size={12} />
          </a>
        </div>
      </div>
    </Shell>
  );
}

function Gate({ slug }: { slug: string }) {
  return (
    <Shell>
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="inline-flex items-center justify-center rounded-lg bg-amber-500/10 p-3 text-amber-400">
          <Lock size={22} strokeWidth={1.5} />
        </span>
        <div className="space-y-1">
          <p className="text-base font-semibold">{slug}</p>
          <p className="text-sm text-[var(--color-muted)]">This file is password protected</p>
        </div>
        <UnlockForm slug={slug} />
      </div>
    </Shell>
  );
}

function Preview({
  category,
  extension,
  url,
  name,
}: {
  category: FileCategory;
  extension: string;
  url: string;
  name: string;
}) {
  // svg is excluded from inline previews for the same reason it's sandboxed on the CDN route
  if (category === 'image' && extension !== 'svg') {
    return <img src={url} alt={name} className="h-full w-full object-contain" />;
  }
  if (category === 'video') {
    return <video src={url} controls className="h-full w-full" />;
  }
  if (category === 'audio') {
    return <audio src={url} controls className="w-full px-4" />;
  }
  return <FileIcon category={category} size={32} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-6">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">{children}</div>
      <Link
        href="/"
        className="mt-4 text-center text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-fg)]"
      >
        AssetsHost
      </Link>
    </main>
  );
}
