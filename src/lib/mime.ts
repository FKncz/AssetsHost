export type FileCategory = 'image' | 'video' | 'audio' | 'document' | 'archive';

export type Disposition = 'inline' | 'attachment';

type FileTypeSpec = {
  mime: string;
  category: FileCategory;
  disposition: Disposition;
  /** Serve under a restrictive CSP because the format can carry executable script. */
  sandbox?: true;
};

export const FILE_TYPES: Record<string, FileTypeSpec> = {
  png: { mime: 'image/png', category: 'image', disposition: 'inline' },
  jpg: { mime: 'image/jpeg', category: 'image', disposition: 'inline' },
  jpeg: { mime: 'image/jpeg', category: 'image', disposition: 'inline' },
  gif: { mime: 'image/gif', category: 'image', disposition: 'inline' },
  webp: { mime: 'image/webp', category: 'image', disposition: 'inline' },
  avif: { mime: 'image/avif', category: 'image', disposition: 'inline' },
  svg: { mime: 'image/svg+xml', category: 'image', disposition: 'inline', sandbox: true },

  mp4: { mime: 'video/mp4', category: 'video', disposition: 'inline' },
  webm: { mime: 'video/webm', category: 'video', disposition: 'inline' },
  mov: { mime: 'video/quicktime', category: 'video', disposition: 'inline' },

  mp3: { mime: 'audio/mpeg', category: 'audio', disposition: 'inline' },
  wav: { mime: 'audio/wav', category: 'audio', disposition: 'inline' },
  ogg: { mime: 'audio/ogg', category: 'audio', disposition: 'inline' },

  pdf: { mime: 'application/pdf', category: 'document', disposition: 'inline' },
  txt: { mime: 'text/plain; charset=utf-8', category: 'document', disposition: 'inline' },
  json: { mime: 'application/json', category: 'document', disposition: 'attachment' },
  html: { mime: 'text/html; charset=utf-8', category: 'document', disposition: 'attachment', sandbox: true },

  zip: { mime: 'application/zip', category: 'archive', disposition: 'attachment' },
  rar: { mime: 'application/vnd.rar', category: 'archive', disposition: 'attachment' },
  '7z': { mime: 'application/x-7z-compressed', category: 'archive', disposition: 'attachment' },
};

export const ALLOWED_EXTENSIONS = Object.keys(FILE_TYPES);

export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',');

/** Only ever returns a plain alphanumeric token, so an extension can never carry path separators. */
export function getExtension(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : '';
}

export function isAllowedExtension(ext: string): boolean {
  return Object.hasOwn(FILE_TYPES, ext);
}

export function getFileTypeSpec(ext: string): FileTypeSpec | null {
  return isAllowedExtension(ext) ? FILE_TYPES[ext] : null;
}
