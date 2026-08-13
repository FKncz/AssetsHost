import Link from 'next/link';
import { Images, LockKeyhole } from 'lucide-react';

/** Public landing => two doors. The gallery is open; the control panel is behind login. */
export default function LandingPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold">AssetsHost</h1>
          <p className="text-sm text-[var(--color-muted)]">Self-hosted asset CDN.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/gallery"
            className="group flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 transition-colors hover:border-[var(--color-accent)]"
          >
            <Images size={24} className="text-[var(--color-accent)]" />
            <div>
              <p className="font-medium">Open files gallery</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">Browse the files shared publicly.</p>
            </div>
          </Link>

          <Link
            href="/control-panel"
            className="group flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 transition-colors hover:border-[var(--color-accent)]"
          >
            <LockKeyhole size={24} className="text-[var(--color-muted)]" />
            <div>
              <p className="font-medium">Open control panel</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">Admin only — upload & manage files.</p>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}
