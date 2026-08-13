'use client';

import {
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  FileArchive,
  File,
} from 'lucide-react';
import type { FileCategory } from '@/lib/mime';

const ICONS: Record<FileCategory, React.ElementType> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  archive: FileArchive,
};

const BG: Record<FileCategory, string> = {
  image: 'bg-blue-500/10 text-blue-400',
  video: 'bg-purple-500/10 text-purple-400',
  audio: 'bg-teal-500/10 text-teal-400',
  document: 'bg-orange-500/10 text-orange-400',
  archive: 'bg-zinc-500/10 text-zinc-400',
};

interface FileIconProps {
  category: FileCategory;
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
