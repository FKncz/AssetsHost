'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Images, LogOut } from 'lucide-react';

export default function ControlPanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/');
    router.refresh();
  }

  return (
    <>
      <header className="border-b border-[var(--color-border)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/control-panel" className="text-lg font-semibold">
            AssetsHost
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href="/gallery"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-fg)]"
            >
              <Images size={14} />
              Gallery
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-fg)]"
            >
              <LogOut size={14} />
              Logout
            </button>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </>
  );
}
