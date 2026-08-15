'use client';

import {
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  FileArchive,
  File,
  Lock,
} from 'lucide-react';
import type { FileCategory } from '@/lib/mime';

/** "locked" isn't a real category => it's what a card shows when it may not know the category. */
export type IconVariant = FileCategory | 'locked';

const ICONS: Record<IconVariant, React.ElementType> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  archive: FileArchive,
  locked: Lock,
};

const BG: Record<IconVariant, string> = {
  image: 'bg-blue-500/10 text-blue-400',
  video: 'bg-purple-500/10 text-purple-400',
  audio: 'bg-teal-500/10 text-teal-400',
  document: 'bg-orange-500/10 text-orange-400',
  archive: 'bg-zinc-500/10 text-zinc-400',
  locked: 'bg-amber-500/10 text-amber-400',
};

interface FileIconProps {
  category: IconVariant;
  size?: number;
  className?: string;
}

export function FileIcon({ category, size = 20, className }: FileIconProps) {
  const Icon = ICONS[category] ?? File;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg p-2 ${BG[category] ?? 'bg-zinc-500/10 text-zinc-400'} ${className ?? ''}`}
    >
      <Icon size={size} strokeWidth={1.5} />
    </span>
  );
}
