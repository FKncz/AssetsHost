import { upload } from '@vercel/blob/client';

/** Files above this go multipart => Vercel recommends it past ~100MB. */
const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;

export type UploadResult = {
  id: string;
  pathname: string;
  size: number;
  contentType: string;
};

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function errorFrom(response: Response, fallback: string): Promise<Error> {
  const detail = await response.json().catch(() => null);
  return new Error(detail?.error ?? fallback);
}

/**
 * Three steps: reserve a unique name server side, upload browser to Blob (bypassing the
 * 4.5MB function body limit), then confirm so the server records authoritative metadata.
 */
export async function uploadFile(file: File, onProgress: (percentage: number) => void): Promise<UploadResult> {
  const reserveResponse = await postJson('/api/upload/reserve', { filename: file.name });
  if (!reserveResponse.ok) throw await errorFrom(reserveResponse, 'Could not reserve a filename');
  const reservation = await reserveResponse.json();

  await upload(reservation.pathname, file, {
    access: 'private',
    handleUploadUrl: '/api/upload/token',
    clientPayload: reservation.id,
    contentType: reservation.contentType,
    multipart: file.size > MULTIPART_THRESHOLD_BYTES,
    onUploadProgress: ({ percentage }) => onProgress(percentage),
  });

  const completeResponse = await postJson('/api/upload/complete', { id: reservation.id });
  if (!completeResponse.ok) throw await errorFrom(completeResponse, 'Could not finalize the upload');

  return completeResponse.json();
}
