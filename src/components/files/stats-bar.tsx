'use client';

import { useEffect, useState } from 'react';
import { HardDrive, Files } from 'lucide-react';
import { formatBytes } from '@/lib/format';

interface Stats {
  totalFiles: number;
  totalBytes: number;
  byCategory: Record<string, number>;
}

interface StatsBarProps {
  refreshKey?: number;
}

export function StatsBar({ refreshKey = 0 }: StatsBarProps) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => {
        // fetch resolves on 4xx/5xx too, so an unchecked r.json() would feed an
        // error body straight into the stat cards. bail instead of rendering junk.
        if (!r.ok) throw new Error(`stats request failed: ${r.status}`);
        return r.json();
      })
      .then(setStats)
      .catch(() => null);
  }, [refreshKey]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <StatCard
        icon={<Files size={16} />}
        label="Total files"
        value={stats ? String(stats.totalFiles) : '—'}
      />
      <StatCard
        icon={<HardDrive size={16} />}
        label="Storage used"
        value={stats ? formatBytes(stats.totalBytes) : '—'}
      />
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center gap-2 text-[var(--color-muted)]">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
