'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Copy, Check, ExternalLink, Lock } from 'lucide-react';
import type { PublicFile } from '@/lib/public-file';
import { getFileTypeSpec } from '@/lib/mime';
import { protectedUrlFor, publicUrlFor } from '@/lib/format';
import { IS_DEMO } from '@/lib/demo';
import { FileIcon } from './file-icon';
import { Button } from '@/components/ui/button';

/**
 * Read-only public card. No delete/toggle => the gallery never exposes admin actions.
 *
 * Takes a PublicFile, not a FileRow: for a locked file there is genuinely nothing here to
 * render but the slug, so no <img>, no size, no category badge. The card can't leak what it
 * was never given.
 */
export function GalleryCard({ file }: { file: PublicFile }) {
  const [copied, setCopied] = useState(false);

  if (file.protected) return <LockedCard name={file.name} />;

  const spec = getFileTypeSpec(file.extension);
  const category = spec?.category ?? 'document';
  // the vanity alias is the nicer public URL when it exists. in demo we fetch the real bundled
  // asset by pathname (the alias is just a label there, there's no /demo/:alias file).
  const url = IS_DEMO ? publicUrlFor(file.pathname) : publicUrlFor(file.name);
  const isImage = category === 'image' && file.extension !== 'svg';

  async function handleCopy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors hover:border-[var(--color-accent)]/40">
      <div className="flex h-28 items-center justify-center overflow-hidden bg-[var(--color-bg)]">
        {isImage ? (
          <img
            src={url}
            alt={file.name}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <FileIcon category={category} size={28} />
        )}
      </div>

      <div className="flex flex-col gap-2 p-3">
        <p className="min-w-0 truncate text-sm font-medium leading-snug" title={file.name}>
          {file.name}
        </p>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={handleCopy} aria-label="Copy URL" className="flex-1">
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy URL'}
          </Button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open file"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
}

/** Whole card is the link to the unlock page => there's no second action worth offering. */
function LockedCard({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors hover:border-amber-500/40">
      <Link
        href={`/p/${name}`}
        className="flex h-28 items-center justify-center bg-[var(--color-bg)]"
        aria-label={`Unlock ${name}`}
      >
        <FileIcon category="locked" size={28} />
      </Link>

      <div className="flex flex-col gap-2 p-3">
        <p className="min-w-0 truncate text-sm font-medium leading-snug" title={name}>
          {name}
        </p>
        <p className="flex items-center gap-1 text-xs text-amber-400">
          <Lock size={11} />
          Password protected
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="flex-1"
            aria-label="Copy share URL"
            onClick={async () => {
              await navigator.clipboard.writeText(protectedUrlFor(name));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy URL'}
          </Button>
          <Link
            href={`/p/${name}`}
            aria-label="Unlock file"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium transition-colors hover:border-amber-500 hover:text-amber-400"
          >
            <Lock size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}
