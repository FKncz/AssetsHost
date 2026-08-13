import { clsx } from 'clsx';
import type { FileCategory } from '@/lib/mime';

const COLORS: Record<FileCategory, string> = {
  image: 'bg-blue-500/15 text-blue-300',
  video: 'bg-purple-500/15 text-purple-300',
  audio: 'bg-teal-500/15 text-teal-300',
  document: 'bg-orange-500/15 text-orange-300',
  archive: 'bg-zinc-500/15 text-zinc-300',
};

interface BadgeProps {
  category: FileCategory;
  className?: string;
}

export function CategoryBadge({ category, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-block rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
        COLORS[category],
        className,
      )}
    >
      {category}
    </span>
  );
}
