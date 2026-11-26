import { createHmac, timingSafeEqual } from 'node:crypto';

function signature(path: string, params: URLSearchParams): string | undefined {
  const key = process.env.TMDB_API_KEY?.trim();
  if (!key) return undefined;
  const query = new URLSearchParams(params);
  query.delete('sig');
  query.sort();
  return createHmac('sha256', key).update(`kinova-media-v1\n${path}\n${query}`).digest('hex');
}

export function buildMediaLink(path: string, params: URLSearchParams): string {
  const signed = signature(path, params);
  if (signed) params.set('sig', signed);
  return `${path}?${params}`;
}

export function isSignedMediaLink(rawUrl: string): boolean {
  const url = new URL(rawUrl, 'http://localhost');
  const supplied = url.searchParams.getAll('sig');
  const expected = signature(url.pathname, url.searchParams);
  return Boolean(expected && supplied.length === 1 && /^[a-f0-9]{64}$/.test(supplied[0]) &&
    timingSafeEqual(Buffer.from(supplied[0], 'hex'), Buffer.from(expected, 'hex')));
}
