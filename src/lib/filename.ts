import { getExtension } from './mime';

const MAX_STEM_LENGTH = 100;

/**
 * The stem becomes a URL path segment, so anything that could alter path parsing
 * (slashes, dots, control chars, percent encoding) is collapsed away rather than escaped.
 */
export function sanitizeStem(input: string): string {
  const stem = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.+/g, '.')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, MAX_STEM_LENGTH)
    .replace(/[-._]+$/, '');

  return stem || 'file';
}

export function splitFilename(filename: string): { stem: string; extension: string } {
  const extension = getExtension(filename);
  const base = extension ? filename.slice(0, -(extension.length + 1)) : filename;
  return { stem: sanitizeStem(base), extension };
}

export function buildPathname(stem: string, extension: string): string {
  return `${stem}.${extension}`;
}

/**
 * Appends -2, -3, ... until the name is free. `taken` must include trashed files:
 * a trashed name stays reserved so restoring it can never collide.
 */
export function uniquifyPathname(stem: string, extension: string, taken: ReadonlySet<string>): string {
  const first = buildPathname(stem, extension);
  if (!taken.has(first)) return first;

  for (let n = 2; n < 10_000; n++) {
    const candidate = buildPathname(`${stem}-${n}`, extension);
    if (!taken.has(candidate)) return candidate;
  }

  throw new Error(`Could not allocate a unique name for "${first}"`);
}

/**
 * A custom name is a vanity alias => lowercase letters/digits in dash joined groups,
 * no leading/trailing/doubled dash, no dot. The no-dot rule is load bearing: real
 * pathnames always carry an extension, so an alias can never shadow one.
 */
const CUSTOM_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_CUSTOM_NAME_LENGTH = 100;

export function isValidCustomName(input: string): boolean {
  return input.length > 0 && input.length <= MAX_CUSTOM_NAME_LENGTH && CUSTOM_NAME_RE.test(input);
}

/**
 * Turns an original filename into a share slug for /p/:slug. A protected file always has one,
 * so this has to succeed for any input => unicode-only or empty names fall back to "file".
 *
 * sanitizeStem gets us most of the way but keeps dots & underscores, which CUSTOM_NAME_RE
 * rejects & which (in the case of a dot) could shadow a real pathname. So collapse those too.
 */
export function deriveSlug(originalFilename: string): string {
  const { stem } = splitFilename(originalFilename);
  const slug = stem
    .replace(/[._]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    // leave room for uniquifySlug's -2 … -9999 suffix, otherwise a collision on a max length
    // slug produces one the validator would reject on a later rename.
    .slice(0, MAX_CUSTOM_NAME_LENGTH - 5)
    .replace(/-+$/, '');

  // paranoia rather than logic: if anything above ever lets a bad shape through, a slug that
  // fails its own validator would be rejected later by PATCH & strand the file.
  return isValidCustomName(slug) ? slug : 'file';
}

/** Appends -2, -3, … until the slug is free, exactly like uniquifyPathname does for filenames. */
export function uniquifySlug(slug: string, taken: ReadonlySet<string>): string {
  if (!taken.has(slug)) return slug;

  for (let n = 2; n < 10_000; n++) {
    const candidate = `${slug}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }

  throw new Error(`Could not allocate a unique slug for "${slug}"`);
}
