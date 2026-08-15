'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Trash2, Check, Eye, EyeOff, Pencil, X, Lock, LockOpen } from 'lucide-react';
import type { FileRow } from '@/server/db/schema';
import { getFileTypeSpec } from '@/lib/mime';
import { formatBytes, originFileUrlFor, protectedUrlFor, publicUrlFor } from '@/lib/format';
import { IS_DEMO } from '@/lib/demo';
import { FileIcon } from './file-icon';
import { useDemoUploads } from './demo-uploads';
import { Button } from '@/components/ui/button';
import { CategoryBadge } from '@/components/ui/badge';

interface FileCardProps {
  file: FileRow;
  onDelete: (id: string) => void;
}

// built once at module load, not on every card render => Intl formatters are expensive
// to construct & this one never changes. timeZone pinned to UTC so the rendered day
// matches the stored timestamp everywhere (a local tz would shift dates near midnight &
// could disagree between server & browser).
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return DATE_FORMAT.format(new Date(d));
}

export function FileCard({ file, onDelete }: FileCardProps) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // local mirrors of the server-owned fields so edits reflect instantly
  const [listed, setListed] = useState(file.listed);
  const [customName, setCustomName] = useState(file.customName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.customName ?? '');
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const togglingRef = useRef(false);

  // per-file password. the hash never comes back from the API, so all the card ever knows is
  // whether one is set.
  const [isProtected, setIsProtected] = useState(file.protectedAt !== null);
  const [editingPassword, setEditingPassword] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [confirmingUnprotect, setConfirmingUnprotect] = useState(false);

  // focus the alias field when the editor opens, replacing the autofocus attribute
  // (which steals focus from assistive tech the moment the card mounts).
  useEffect(() => {
    if (editing) nameInputRef.current?.focus();
  }, [editing]);

  const spec = getFileTypeSpec(file.extension);
  const category = spec?.category ?? 'document';
  // URL resolution:
  //  - session-only fake upload (demo) => its in-browser object URL
  //  - other demo rows => the real bundled asset at /f/:pathname (ignore the alias for the actual
  //    fetch so a for-show rename can't break the thumbnail/open; the alias still shows as a label)
  //  - protected => the /p/ share page, which is the only URL that works for a recipient
  //  - production => the vanity alias when set, else the pathname
  const demo = useDemoUploads();
  const sessionUrl = demo?.urlFor(file.id);
  const isSessionUpload = Boolean(sessionUrl);
  const shareUrl =
    isProtected && customName ? protectedUrlFor(customName) : publicUrlFor(customName ?? file.pathname);
  const url = sessionUrl ?? (IS_DEMO ? publicUrlFor(file.pathname) : shareUrl);
  // previews keep working for the admin because /cdn honours the session cookie as a bypass —
  // but only on the app origin. the session cookie is host scoped, so a protected file routed
  // through NEXT_PUBLIC_CDN_HOST would 404 there; stay on this origin for those.
  const previewUrl =
    sessionUrl ??
    (IS_DEMO
      ? publicUrlFor(file.pathname)
      : isProtected
        ? originFileUrlFor(customName ?? file.pathname)
        : publicUrlFor(customName ?? file.pathname));
  const isImage = category === 'image' && file.extension !== 'svg';

  async function handleCopy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function toggleListed() {
    // guard against a double-click firing two overlapping PATCHes => the optimistic
    // flip + revert can otherwise race & leave the badge out of sync with the server.
    if (togglingRef.current) return;
    togglingRef.current = true;
    const next = !listed;
    setListed(next);
    try {
      const res = await fetch(`/api/files/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listed: next }),
      });
      if (!res.ok) setListed(!next);
    } catch {
      // a thrown fetch (network drop) skips the !res.ok branch entirely => the
      // optimistic flip would stick forever. revert here too so the badge can't
      // claim a state the server never accepted.
      setListed(!next);
    } finally {
      togglingRef.current = false;
    }
  }

  async function saveCustomName() {
    setSavingName(true);
    setNameError('');
    try {
      const res = await fetch(`/api/files/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customName: draft.trim() }),
      });
      // fetch doesn't throw on 4xx/5xx, so gate on res.ok before trusting the body.
      // the error branch still reads the payload since that's where the message lives.
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setNameError(err.error ?? 'Could not save');
        return;
      }
      const data = await res.json().catch(() => ({}));
      setCustomName(data.file?.customName ?? null);
      setEditing(false);
    } catch {
      // network drop throws before res.ok is read => without this the field just
      // silently stops spinning with no message. surface it like the login form does.
      setNameError('Could not save');
    } finally {
      setSavingName(false);
    }
  }

  /**
   * Sets, rotates or removes the password. `password: ''` is the remove signal, matching the
   * empty-string-clears convention the alias field already uses. A rotation invalidates every
   * unlock cookie for this file server side, so nobody keeps access across a change.
   */
  async function savePassword(next: string | '') {
    setSavingPassword(true);
    setPasswordError('');
    try {
      const res = await fetch(`/api/files/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setPasswordError(err.error ?? 'Could not save');
        return;
      }
      const data = await res.json().catch(() => ({}));
      setIsProtected(Boolean(data.file?.protected));
      // setProtection derives a slug when the file had none => pick it up so Copy URL is right
      if (data.file?.slug !== undefined) setCustomName(data.file.slug);
      setPasswordDraft('');
      setEditingPassword(false);
    } catch {
      setPasswordError('Could not save');
    } finally {
      setSavingPassword(false);
      setConfirmingUnprotect(false);
    }
  }

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/files/${file.id}`, { method: 'DELETE' });
      if (res.ok) onDelete(file.id);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors hover:border-[var(--color-accent)]/40">
      <div className="relative flex h-28 items-center justify-center overflow-hidden bg-[var(--color-bg)]">
        {isImage ? (
          <img
            src={previewUrl}
            alt={file.pathname}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <FileIcon category={category} size={28} />
        )}
        <button
          type="button"
          onClick={toggleListed}
          title={listed ? 'Listed in gallery — click to hide' : 'URL-only — click to list in gallery'}
          aria-label={listed ? 'Hide from gallery' : 'Show in gallery'}
          className={`absolute right-2 top-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium backdrop-blur transition-colors ${
            listed
              ? 'bg-[var(--color-accent)]/90 text-white'
              : 'bg-black/50 text-white/80 hover:text-white'
          }`}
        >
          {listed ? <Eye size={12} /> : <EyeOff size={12} />}
          {listed ? 'Listed' : 'Hidden'}
        </button>
        {isProtected && (
          <span
            title="Password protected — recipients need the password to open it"
            className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-amber-500/90 px-2 py-1 text-xs font-medium text-white backdrop-blur"
          >
            <Lock size={12} />
            Protected
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 p-3">
        <p className="min-w-0 truncate text-sm font-medium leading-snug" title={file.pathname}>
          {file.pathname}
        </p>

        {isSessionUpload && (
          <span className="w-fit rounded bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
            Showcase upload — gone on reload
          </span>
        )}

        {editing ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <input
                value={draft}
                ref={nameInputRef}
                aria-label="Custom name"
                onChange={(e) => setDraft(e.target.value)}
                placeholder="custom-name"
                className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
              />
              <Button size="sm" variant="ghost" onClick={saveCustomName} disabled={savingName} aria-label="Save custom name">
                <Check size={12} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(customName ?? '');
                  setNameError('');
                }}
                aria-label="Cancel"
              >
                <X size={12} />
              </Button>
            </div>
            {nameError && <p className="text-xs text-red-400">{nameError}</p>}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 text-left text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-fg)]"
          >
            <Pencil size={11} />
            {customName ? `/f/${customName}` : 'Add custom name'}
          </button>
        )}

        {/* password row. a session-only fake upload has no server row to protect => hide it there. */}
        {!isSessionUpload &&
          (editingPassword ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <input
                  type="password"
                  value={passwordDraft}
                  aria-label={isProtected ? 'New file password' : 'File password'}
                  onChange={(e) => setPasswordDraft(e.target.value)}
                  placeholder={isProtected ? 'New password' : 'Password (6+ characters)'}
                  className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none focus:border-amber-500"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => savePassword(passwordDraft)}
                  disabled={savingPassword || passwordDraft.length === 0}
                  aria-label="Save password"
                >
                  <Check size={12} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditingPassword(false);
                    setPasswordDraft('');
                    setPasswordError('');
                  }}
                  aria-label="Cancel"
                >
                  <X size={12} />
                </Button>
              </div>
              {passwordError && <p className="text-xs text-red-400">{passwordError}</p>}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {/* one label for the state, one verb for the action => the card reads as the same
                  "file password" the upload toggle sets, not as a second kind of password. */}
              <span
                className={`flex items-center gap-1 text-xs ${
                  isProtected ? 'text-amber-400' : 'text-[var(--color-muted)]'
                }`}
              >
                <Lock size={11} />
                {isProtected ? 'Protected' : 'File password'}
              </span>
              <button
                type="button"
                onClick={() => setEditingPassword(true)}
                aria-label={isProtected ? 'Change the file password' : 'Add a file password'}
                className="text-xs text-[var(--color-muted)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--color-fg)]"
              >
                {isProtected ? 'Change' : 'Add'}
              </button>
              {isProtected && (
                /* same two-step the delete button uses => removing a password unlocks the bytes
                   for anyone holding the link, so one stray click shouldn't do it. */
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmingUnprotect) {
                      setConfirmingUnprotect(true);
                      setTimeout(() => setConfirmingUnprotect(false), 3000);
                      return;
                    }
                    savePassword('');
                  }}
                  disabled={savingPassword}
                  aria-label={confirmingUnprotect ? 'Confirm remove password' : 'Remove the file password'}
                  className="ml-auto flex items-center gap-1 text-xs text-[var(--color-muted)] transition-colors hover:text-red-400"
                >
                  <LockOpen size={11} />
                  {confirmingUnprotect ? 'Sure?' : 'Remove'}
                </button>
              )}
            </div>
          ))}
        {!editingPassword && passwordError && <p className="text-xs text-red-400">{passwordError}</p>}

        <div className="flex items-center gap-2">
          <CategoryBadge category={category} />
          <span className="ml-auto text-xs text-[var(--color-muted)]">{formatBytes(file.size)}</span>
        </div>

        <p className="text-xs text-[var(--color-muted)]">{formatDate(file.uploadedAt)}</p>

        <div className="mt-1 flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={handleCopy} aria-label="Copy URL" className="flex-1">
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy URL'}
          </Button>
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open file"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            <ExternalLink size={12} />
          </a>
          <Button
            size="sm"
            variant="danger"
            onClick={handleDelete}
            disabled={deleting}
            aria-label={confirming ? 'Confirm delete' : 'Delete file'}
          >
            <Trash2 size={12} />
            {confirming ? 'Sure?' : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}
