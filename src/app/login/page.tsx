'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { IS_DEMO, DEMO_PASSWORD } from '@/lib/demo';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // demo => hand the visitor the password so signing in is a single click.
  const [password, setPassword] = useState(IS_DEMO ? DEMO_PASSWORD : '');
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  /** seconds left on a 429. cosmetic => the server is the enforcement, this just stops the spam. */
  const [cooldown, setCooldown] = useState(0);
  const passwordRef = useRef<HTMLInputElement>(null);

  // focus the password field on mount without the autofocus attribute, which yanks
  // screen reader / keyboard users to it before they've heard the page.
  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || cooldown > 0) return;

    setPending(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        router.replace(params.get('next') || '/control-panel');
        router.refresh();
        return;
      }

      const detail = await response.json().catch(() => ({}));
      if (response.status === 429) {
        setCooldown(Number(detail.retryAfterSeconds) || 60);
        setRemaining(null);
        setError('Too many attempts.');
        return;
      }
      // the count only shows up once it's low enough to matter, so a first typo doesn't
      // read like an accusation.
      setRemaining(typeof detail.attemptsRemaining === 'number' ? detail.attemptsRemaining : null);
      setError('Incorrect password');
    } finally {
      // a thrown fetch (network drop) used to leave pending stuck true => button
      // frozen on "Signing in…" forever. finally guarantees we reset either way.
      setPending(false);
    }
  }

  const blocked = cooldown > 0;

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">AssetsHost</h1>
        <p className="text-sm text-[var(--color-muted)]">Sign in to manage your files.</p>
      </div>

      {IS_DEMO && (
        <div className="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-xs text-[var(--color-muted)]">
          Demo instance — password is prefilled (<code>{DEMO_PASSWORD}</code>), just hit Sign in.
        </div>
      )}

      <input
        type="password"
        value={password}
        ref={passwordRef}
        aria-label="Password"
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        disabled={blocked}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
      />

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
          {remaining !== null && remaining > 0 && remaining <= 3 && (
            <> {remaining} attempt{remaining === 1 ? '' : 's'} left.</>
          )}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || blocked || !password}
        className="w-full rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {blocked ? `Try again in ${formatCountdown(cooldown)}` : pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
