/**
 * The projection every public (unauthenticated) payload goes through. A locked file is reduced
 * to its id & slug: no extension, mime, size, dates, pathname or blob URL, because each of
 * those tells a stranger something about a file they haven't authenticated for.
 *
 * Client components import this too, so it stays a leaf: types & one pure function.
 */

export type PublicFile =
  | {
      id: string;
      protected: false;
      /** the slug when there is one, else the pathname => what the card shows */
      name: string;
      pathname: string;
      extension: string;
      contentType: string;
      size: number;
      uploadedAt: string | null;
    }
  | { id: string; protected: true; name: string };

type Row = {
  id: string;
  pathname: string;
  extension: string;
  customName: string | null;
  contentType: string;
  size: number;
  protectedAt: Date | null;
  uploadedAt: Date | null;
};

export function toPublicFile(row: Row): PublicFile {
  // a protected file always has a slug (setProtection guarantees it), but fall back rather
  // than emit the pathname if that invariant is ever broken.
  if (row.protectedAt) {
    return { id: row.id, protected: true, name: row.customName ?? row.id };
  }

  return {
    id: row.id,
    protected: false,
    name: row.customName ?? row.pathname,
    pathname: row.pathname,
    extension: row.extension,
    contentType: row.contentType,
    size: row.size,
    uploadedAt: row.uploadedAt ? row.uploadedAt.toISOString() : null,
  };
}
