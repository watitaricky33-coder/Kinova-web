import type { DownloadRecord } from '../types/kinova';

const DB_NAME = 'kinova_offline_db';
const DB_VERSION = 1;
const STORE_MEDIA = 'media_blobs';

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveOfflineMediaBlob(id: string, blob: Blob, mimeType: string): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_MEDIA, 'readwrite');
    tx.objectStore(STORE_MEDIA).put({
      id,
      blob,
      mimeType,
      sizeBytes: blob.size,
      savedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getOfflineMediaBlobUrl(id: string): Promise<{ url: string; mimeType: string } | null> {
  const db = await openOfflineDb();
  const record = await new Promise<{ blob?: Blob; mimeType?: string } | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_MEDIA, 'readonly');
    const req = tx.objectStore(STORE_MEDIA).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!record?.blob) return null;
  return {
    url: URL.createObjectURL(record.blob),
    mimeType: record.mimeType || 'video/mp4',
  };
}

export async function deleteOfflineMediaBlob(id: string): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_MEDIA, 'readwrite');
    tx.objectStore(STORE_MEDIA).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function clearAllOfflineMediaBlobs(): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_MEDIA, 'readwrite');
    tx.objectStore(STORE_MEDIA).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function estimateStorageQuota(): Promise<{ usedBytes: number; quotaBytes: number }> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      return {
        usedBytes: est.usage || 0,
        quotaBytes: est.quota || 0,
      };
    } catch {
      // Fallback
    }
  }
  return { usedBytes: 0, quotaBytes: 0 };
}

export function triggerFileDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function exportOfflineBlobToDevice(id: string, filename: string): Promise<boolean> {
  const media = await getOfflineMediaBlobUrl(id);
  if (!media) return false;
  triggerFileDownload(media.url, filename.endsWith('.mp4') ? filename : `${filename}.mp4`);
  window.setTimeout(() => URL.revokeObjectURL(media.url), 60_000);
  return true;
}

export async function downloadStreamToOfflineStorage(params: {
  record: DownloadRecord;
  proxyUrl: string;
  signal: AbortSignal;
  onProgress: (downloadedBytes: number, totalBytes: number) => void;
}): Promise<{ totalBytes: number }> {
  const { record, proxyUrl, signal, onProgress } = params;

  // proxyUrl points to /api/streams/download (universal MP4/remuxed HLS stream) or /api/proxy
  const response = await fetch(proxyUrl, { signal });
  if (!response.ok) {
    const errJson = await response.json().catch(() => null);
    throw new Error(errJson?.error || `HTTP ${response.status} downloading stream`);
  }

  const contentType = response.headers.get('content-type') || 'video/mp4';
  const total = Number(response.headers.get('content-length') || 0);
  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    await saveOfflineMediaBlob(record.id, blob, contentType);
    onProgress(blob.size, blob.size);
    return { totalBytes: blob.size };
  }

  const chunks: BlobPart[] = [];
  let downloaded = 0;
  let lastProgressAt = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      downloaded += value.byteLength;
      const now = Date.now();
      if (now - lastProgressAt > 250) {
        lastProgressAt = now;
        onProgress(downloaded, total || downloaded);
      }
    }
  }

  const normalizedMime = contentType.includes('mp2t') ? 'video/mp2t' : 'video/mp4';
  const blob = new Blob(chunks, { type: normalizedMime });
  await saveOfflineMediaBlob(record.id, blob, normalizedMime);
  onProgress(blob.size, blob.size);
  return { totalBytes: blob.size };
}
