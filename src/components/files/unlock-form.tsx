'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The gate. Deliberately knows nothing about the file it is guarding — it posts a password and
 * calls router.refresh(), and the server component re-renders with the file's data. So even a
 * bug in this component can't leak anything: it never receives anything to leak.
 */
export function UnlockForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** seconds left on a 429. cosmetic => the server is the enforcement, this just stops the spam. */
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || cooldown > 0) return;

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/protected/${encodeURIComponent(slug)}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        setPassword('');
        router.refresh();
        return;
      }

      const detail = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setCooldown(Number(detail.retryAfterSeconds) || 60);
        setRemaining(null);
        setError('Too many attempts.');
        return;
      }
      setRemaining(typeof detail.attemptsRemaining === 'number' ? detail.attemptsRemaining : null);
      setError(detail.error ?? 'Incorrect password');
    } catch {
      // a thrown fetch never reaches res.ok => without this the button just stops spinning
      setError('Could not reach the server. Check your connection & try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const blocked = cooldown > 0;

  return (
    <form onSubmit={submit} className="w-full space-y-3">
      <Input
        type="password"
        value={password}
        autoComplete="current-password"
        aria-label="File password"
        placeholder="Password"
        onChange={(e) => setPassword(e.target.value)}
        disabled={blocked}
      />

      <Button type="submit" variant="primary" className="w-full" disabled={submitting || blocked || !password}>
        {submitting ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
        {blocked ? `Try again in ${formatCountdown(cooldown)}` : 'Unlock'}
      </Button>

      {error && (
        <p className="text-center text-xs text-red-400" role="alert">
          {error}
          {remaining !== null && remaining > 0 && ` ${remaining} attempt${remaining === 1 ? '' : 's'} left.`}
        </p>
      )}
    </form>
  );
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
