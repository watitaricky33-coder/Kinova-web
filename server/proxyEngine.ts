import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Agent, fetch as guardedFetch } from 'undici';
import type { Request, Response } from 'express';
import { buildMediaLink } from './mediaLinks.ts';

// Keep-alive agents inspired by 123anime-api/routes/play.js and streamrelay/server.js
export const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 64,
  keepAliveMsecs: 15_000,
});

export const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  keepAliveMsecs: 15_000,
});

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlLruCache<T = unknown> {
  private maxEntries: number;
  private ttlMs: number;
  private map = new Map<string, CacheEntry<T>>();

  constructor(maxEntries = 1500, ttlMs = 300_000) {
    this.maxEntries = Math.max(10, maxEntries);
    this.ttlMs = Math.max(1000, ttlMs);
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, customTtlMs?: number): void {
    if (this.map.has(key)) this.map.delete(key);
    while (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    this.map.set(key, {
      value,
      expiresAt: Date.now() + (customTtlMs ?? this.ttlMs),
    });
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

export interface ProxyTargetValidation {
  ok: boolean;
  reason?: string;
  url?: URL;
}

const PRIVATE_HOSTNAME_RE = /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i;

export function isPrivateOrReservedIp(ipRaw: string): boolean {
  const ip = ipRaw.trim().replace(/^\[|\]$/g, '').toLowerCase();
  const v4Match = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const ipv4 = v4Match ? v4Match[1] : ip;
  const version = net.isIP(ipv4);
  if (version === 4) {
    const [a, b] = ipv4.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6 || net.isIPv6(ip)) {
    return !/^[23][0-9a-f]{3}:/i.test(ip) || ip.startsWith('2001:db8:');
  }
  return false;
}

export function validateExternalProxyTarget(
  rawUrl: string,
  allowPrivateForTest = false
): ProxyTargetValidation {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return { ok: false, reason: 'Missing target url query parameter' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'Invalid target URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Unsupported URL scheme (http/https only)' };
  }
  if (parsed.username || parsed.password) return { ok: false, reason: 'Credentials are not allowed in media URLs' };
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return { ok: false, reason: 'URL missing hostname' };
  if (!allowPrivateForTest) {
    if (PRIVATE_HOSTNAME_RE.test(hostname) || isPrivateOrReservedIp(hostname)) {
      return { ok: false, reason: 'Blocked private or loopback proxy target' };
    }
  }
  return { ok: true, url: parsed };
}

const mediaAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true, family: options.family }, (error, addresses) => {
        if (error) return callback(error, '', 0);
        const publicAddresses = addresses.filter(({ address }) => !isPrivateOrReservedIp(address));
        if (!publicAddresses.length) return callback(new Error('Blocked private media host'), '', 0);
        if (options.all) return callback(null, publicAddresses);
        return callback(null, publicAddresses[0].address, publicAddresses[0].family);
      });
    },
  },
});

export async function fetchExternalMedia(rawUrl: string, options: {
  headers?: Record<string, string>;
  method?: 'GET' | 'HEAD';
  signal: AbortSignal;
}, allowPrivateForTest = false) {
  let target = rawUrl;
  let headers = options.headers;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const validation = validateExternalProxyTarget(target, allowPrivateForTest);
    if (!validation.ok || !validation.url) throw new Error(validation.reason || 'Invalid media URL');
    const response = await guardedFetch(validation.url, {
      ...options, headers, redirect: 'manual', dispatcher: allowPrivateForTest ? undefined : mediaAgent,
    });
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
    await response.body?.cancel();
    const redirect = new URL(location, validation.url);
    if (redirect.origin !== validation.url.origin && headers) {
      headers = Object.fromEntries(Object.entries(headers).filter(([name]) => !/^(authorization|cookie)$/i.test(name)));
    }
    target = redirect.href;
  }
  throw new Error('Too many media redirects');
}

// Host-based upstream header rule map ported from MHSanaei/HLS-Proxy-Worker + free-moveis-api + x8rr/movies + 123anime-api
export interface HostHeaderRule {
  pattern: RegExp;
  referer?: string;
  origin?: string;
  userAgent?: string;
}

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const HOST_HEADER_RULES: HostHeaderRule[] = [
  {
    pattern: /(^|\.)(vidzee\.wtf|ngcloud\.app|vercetti\.org|hscow\.com)$/i,
    referer: 'https://player.vidzee.wtf/',
    origin: 'https://player.vidzee.wtf',
  },
  {
    pattern: /(^|\.)(vidprime\.top|flixcdn\.cyou|1x2\.space)$/i,
    referer: 'https://vidprime.top/',
    origin: 'https://vidprime.top',
  },
  {
    pattern: /(^|\.)(vidspark\.to)$/i,
    referer: 'https://vidspark.to/',
    origin: 'https://vidspark.to',
  },
  {
    pattern: /(^|\.)(vidsrc\.buzz|streamflixserver\.site)$/i,
    referer: 'https://vidsrc.buzz/',
  },
  {
    pattern: /(^|\.)123anime\.la$/i,
    referer: 'https://123anime.la/',
    origin: 'https://123anime.la',
  },
  {
    pattern: /(^|\.)echovideo\.ru$/i,
    referer: 'https://echovideo.ru/',
    origin: 'https://echovideo.ru',
  },
  {
    pattern: /(^|\.)videasy\.net$/i,
    referer: 'https://player.videasy.net/',
    origin: 'https://player.videasy.net',
  },
  {
    pattern: /(^|\.)vidlink\.pro$/i,
    referer: 'https://vidlink.pro/',
    origin: 'https://vidlink.pro',
  },
  {
    pattern: /(^|\.)vixsrc\.to$/i,
    referer: 'https://vixsrc.to/',
    origin: 'https://vixsrc.to',
  },
];

export function resolveUpstreamHeaders(
  targetUrl: URL,
  explicitHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': DEFAULT_USER_AGENT,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const host = targetUrl.hostname.toLowerCase();
  for (const rule of HOST_HEADER_RULES) {
    if (rule.pattern.test(host)) {
      if (rule.referer) headers['Referer'] = rule.referer;
      if (rule.origin) headers['Origin'] = rule.origin;
      if (rule.userAgent) headers['User-Agent'] = rule.userAgent;
      break;
    }
  }

  if (explicitHeaders) {
    for (const [key, val] of Object.entries(explicitHeaders)) {
      if (!val) continue;
      const lower = key.toLowerCase();
      if (lower === 'referer') headers['Referer'] = val;
      else if (lower === 'origin') headers['Origin'] = val;
      else if (lower === 'user-agent') headers['User-Agent'] = val;
      else if (
        lower === 'cookie' ||
        lower === 'authorization' ||
        lower === 'x-requested-with' ||
        lower === 'range'
      ) {
        headers[lower === 'range' ? 'Range' : key] = val;
      }
    }
  }
  return headers;
}

// Magic-byte inspection & disguised image unwrapping (from vyla-backend / vidzee-mp4)
export function findMediaStartOffset(buffer: Buffer): number {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return -1;

  // MPEG-TS sync byte 0x47 recurring at 188-byte intervals
  const maxScan = Math.min(buffer.length - 377, 1024 * 64);
  for (let i = 0; i <= maxScan; i++) {
    if (
      buffer[i] === 0x47 &&
      buffer[i + 188] === 0x47 &&
      buffer[i + 376] === 0x47
    ) {
      return i;
    }
  }

  // MP4 'ftyp' box
  const ftypIdx = buffer.indexOf(Buffer.from('ftyp', 'ascii'), 0);
  if (ftypIdx >= 4 && ftypIdx < 1024 * 32) {
    return ftypIdx - 4;
  }

  // WebM / Matroska EBML header
  const ebmlIdx = buffer.indexOf(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 0);
  if (ebmlIdx >= 0 && ebmlIdx < 1024 * 32) {
    return ebmlIdx;
  }

  // ID3 tag / AAC ADTS frame
  const id3Idx = buffer.indexOf(Buffer.from('ID3', 'ascii'), 0);
  if (id3Idx >= 0 && id3Idx < 1024 * 16) {
    return id3Idx;
  }

  return -1;
}

export function looksLikePureImage(buffer: Buffer, contentType = ''): boolean {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return false;
  const ct = String(contentType || '').toLowerCase();
  const startsAsPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const startsAsJpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const startsAsGif =
    buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38;
  const startsAsBmp = buffer[0] === 0x42 && buffer[1] === 0x4d;
  const startsAsWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (!(startsAsPng || startsAsJpg || startsAsGif || startsAsBmp || startsAsWebp || ct.startsWith('image/'))) {
    return false;
  }
  return findMediaStartOffset(buffer) === -1;
}

export function looksLikeHtmlOrErrorPayload(buffer: Buffer, contentType = ''): boolean {
  // Note: some CDNs (like vip.1x2.space) label valid MPEG-TS packets as text/html!
  // Check actual media magic bytes FIRST before rejecting on Content-Type.
  if (findMediaStartOffset(buffer) >= 0) {
    return false;
  }
  const ct = contentType.toLowerCase();
  const sample = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (ct.includes('text/html') || sample.startsWith('<!doctype html') || sample.startsWith('<html')) {
    return true;
  }
  if (
    (ct.includes('application/json') || sample.startsWith('{')) &&
    (sample.includes('"error"') || sample.includes('"status":40'))
  ) {
    return true;
  }
  return false;
}

export function inferSegmentContentType(pathname: string, upstreamCt = ''): string {
  const lower = pathname.toLowerCase();
  const ct = upstreamCt.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.mts')) return 'video/mp2t';
  if (lower.endsWith('.m4s') || lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  if (lower.endsWith('.m4a') || lower.endsWith('.aac')) return 'audio/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.key')) return 'application/octet-stream';
  if (lower.endsWith('.vtt')) return 'text/vtt; charset=utf-8';
  if (lower.endsWith('.srt')) return 'application/x-subrip; charset=utf-8';
  if (ct && !ct.startsWith('image/') && !ct.includes('text/plain') && !ct.includes('text/html')) {
    return upstreamCt;
  }
  return 'video/mp2t';
}

export function convertSrtToVtt(srtText: string): string {
  const cleaned = srtText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = cleaned.split(/\n{2,}/);
  const out: string[] = ['WEBVTT', ''];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd());
    if (lines.length === 0) continue;
    let idx = 0;
    if (/^\d+$/.test(lines[0].trim())) {
      idx = 1;
    }
    if (idx >= lines.length) continue;
    const timingLine = lines[idx].replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    if (!timingLine.includes('-->')) continue;
    out.push(timingLine);
    for (let j = idx + 1; j < lines.length; j++) {
      out.push(lines[j]);
    }
    out.push('');
  }
  return out.join('\n');
}

export function buildProxyUrl(
  targetRawUrl: string,
  originBase: string,
  endpointPath: '/api/proxy' | '/api/m3u8-proxy' | '/api/ts-proxy' | '/api/sub-proxy' | '/api' = '/api/proxy',
  upstreamHeaders: { referer?: string; origin?: string; headersJson?: string } = {}
): string {
  const params = new URLSearchParams();
  params.set('url', targetRawUrl);
  if (upstreamHeaders.referer) params.set('referer', upstreamHeaders.referer);
  if (upstreamHeaders.origin) params.set('origin', upstreamHeaders.origin);
  if (upstreamHeaders.headersJson) params.set('headers', upstreamHeaders.headersJson);
  const rel = buildMediaLink(endpointPath, params);
  const base = String(originBase || '').trim().replace(/\/+$/, '');
  return base ? `${base}${rel}` : rel;
}

export function buildDownloadEndpointUrl(params: {
  targetRawUrl: string;
  originBase: string;
  streamType: 'hls' | 'mp4';
  filename: string;
  referer?: string;
  origin?: string;
}): string {
  const q = new URLSearchParams();
  q.set('url', params.targetRawUrl);
  q.set('type', params.streamType);
  q.set('filename', params.filename);
  if (params.referer) q.set('referer', params.referer);
  if (params.origin) q.set('origin', params.origin);
  const rel = buildMediaLink('/api/streams/download', q);
  const base = String(params.originBase || '').trim().replace(/\/+$/, '');
  return base ? `${base}${rel}` : rel;
}

function resolveRelativeUrl(uri: string, baseManifestUrl: string): string {
  try {
    const resolved = new URL(uri.trim(), baseManifestUrl);
    const parentToken = new URL(baseManifestUrl).searchParams.get('token');
    if (parentToken && !resolved.searchParams.has('token')) {
      resolved.searchParams.set('token', parentToken);
    }
    return resolved.toString();
  } catch {
    return uri.trim();
  }
}

export function rewriteHlsManifest(
  manifestText: string,
  manifestUrl: string,
  originBase: string,
  upstreamHeaders: { referer?: string; origin?: string; headersJson?: string } = {}
): string {
  const lines = String(manifestText || '').split(/\r?\n/);
  let expectVariantPlaylistNext = false;

  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // Rewrite URI="..." inside #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, #EXT-X-I-FRAME-STREAM-INF, #EXT-X-SESSION-KEY
      if (trimmed.startsWith('#')) {
        if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
          expectVariantPlaylistNext = true;
        }
        if (!trimmed.includes('URI="')) return line;
        return line.replace(/URI="([^"]+)"/g, (_m, rawUri) => {
          const abs = resolveRelativeUrl(rawUri, manifestUrl);
          const isPlaylistUri =
            abs.toLowerCase().includes('.m3u8') ||
            trimmed.startsWith('#EXT-X-MEDIA') ||
            trimmed.startsWith('#EXT-X-I-FRAME-STREAM-INF');
          const endpoint = isPlaylistUri ? '/api/m3u8-proxy' : '/api/ts-proxy';
          return `URI="${buildProxyUrl(abs, originBase, endpoint, upstreamHeaders)}"`;
        });
      }

      // Direct media / variant playlist URL line
      const abs = resolveRelativeUrl(trimmed, manifestUrl);
      const isNestedPlaylist =
        expectVariantPlaylistNext ||
        abs.toLowerCase().includes('.m3u8') ||
        abs.toLowerCase().includes('playlist');
      expectVariantPlaylistNext = false;
      const endpoint = isNestedPlaylist ? '/api/m3u8-proxy' : '/api/ts-proxy';
      return buildProxyUrl(abs, originBase, endpoint, upstreamHeaders);
    })
    .join('\n');
}

function pickFirstHlsEntry(manifestText: string, baseManifestUrl: string): string | null {
  const lines = manifestText.split(/\r?\n/).map((l) => l.trim());
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXT-X-MAP:')) {
      const m = line.match(/URI="([^"]+)"/);
      if (m?.[1]) return resolveRelativeUrl(m[1], baseManifestUrl);
      continue;
    }
    if (!line.startsWith('#')) {
      return resolveRelativeUrl(line, baseManifestUrl);
    }
  }
  return null;
}

export function pickBestHlsVariant(manifestText: string, baseManifestUrl: string): string | null {
  const lines = manifestText.split(/\r?\n/).map((l) => l.trim());
  let bestUrl: string | null = null;
  let bestBw = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
      const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/i);
      const bw = bwMatch ? Number(bwMatch[1]) : 0;
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j]) continue;
        if (!lines[j].startsWith('#')) {
          if (bw >= bestBw) {
            bestBw = bw;
            bestUrl = resolveRelativeUrl(lines[j], baseManifestUrl);
          }
          break;
        }
      }
    }
  }
  return bestUrl || pickFirstHlsEntry(manifestText, baseManifestUrl);
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  streamType?: 'hls' | 'mp4';
}

async function fetchSegmentBytes(
  segUrl: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  allowPrivateForTest: boolean
): Promise<{ status: number; ct: string; buf: Buffer }> {
  const sliceHeaders = resolveUpstreamHeaders(segUrl, {
    ...headers,
    Range: 'bytes=0-65535',
  });
  let res = await fetchExternalMedia(segUrl.toString(), {
    method: 'GET',
    headers: sliceHeaders,
    signal,
  }, allowPrivateForTest);

  if (res.status === 403 || res.status === 416) {
    const noRangeHeaders = resolveUpstreamHeaders(segUrl, headers);
    await res.body?.cancel();
    res = await fetchExternalMedia(segUrl.toString(), {
      method: 'GET',
      headers: noRangeHeaders,
      signal,
    }, allowPrivateForTest);
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const buf = await readProbeBytes(res, 128 * 1024);
  return { status: res.status, ct, buf };
}

async function readProbeBytes(response: Awaited<ReturnType<typeof fetchExternalMedia>>, limit: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let remaining = limit;
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.subarray(0, remaining);
      chunks.push(Buffer.from(take));
      remaining -= take.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function verifyPlayableCandidate(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 5500,
  allowPrivateForTest = false
): Promise<VerifyResult> {
  const validation = validateExternalProxyTarget(url, allowPrivateForTest);
  if (!validation.ok || !validation.url) {
    return { ok: false, reason: validation.reason };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = validation.url;

    for (let depth = 0; depth < 3; depth++) {
      const isLikelyM3u8 =
        depth > 0 || currentUrl.pathname.toLowerCase().includes('.m3u8');
      const extraHeaders: Record<string, string> = isLikelyM3u8
        ? { ...headers }
        : { ...headers, Range: 'bytes=0-131071' };
      const mergedHeaders = resolveUpstreamHeaders(currentUrl, extraHeaders);

      let response = await fetchExternalMedia(currentUrl.toString(), {
        method: 'GET',
        headers: mergedHeaders,
        signal: controller.signal,
      }, allowPrivateForTest);

      if ((response.status === 403 || response.status === 416) && 'Range' in mergedHeaders) {
        const retryHeaders = { ...mergedHeaders };
        delete retryHeaders['Range'];
        await response.body?.cancel();
        response = await fetchExternalMedia(currentUrl.toString(), {
          method: 'GET',
          headers: retryHeaders,
          signal: controller.signal,
        }, allowPrivateForTest);
      }

      if (!response.ok && response.status !== 206) {
        await response.body?.cancel();
        return { ok: false, reason: `HTTP ${response.status}` };
      }

      const ct = (response.headers.get('content-type') || '').toLowerCase();
      const buf = await readProbeBytes(response, isLikelyM3u8 || ct.includes('mpegurl') ? 2 * 1024 * 1024 : 128 * 1024);
      if (buf.length === 0) {
        return { ok: false, reason: 'Empty upstream body' };
      }

      const headText = buf.subarray(0, 512).toString('utf8').trimStart();
      if (headText.includes('#EXTM3U')) {
        const fullText = buf.toString('utf8');
        const resolvedBase = response.url || currentUrl.toString();

        // Master playlist -> drill into first/best variant playlist
        if (fullText.includes('#EXT-X-STREAM-INF')) {
          const variantRaw = pickBestHlsVariant(fullText, resolvedBase);
          if (!variantRaw) {
            return { ok: false, reason: 'Master HLS playlist has no variant entries' };
          }
          const variantVal = validateExternalProxyTarget(variantRaw, allowPrivateForTest);
          if (!variantVal.ok || !variantVal.url) {
            return { ok: false, reason: 'Invalid HLS variant URL' };
          }
          currentUrl = variantVal.url;
          continue;
        }

        // Media playlist -> probe segment[0] so rate-limited (429) or 70-byte dummy PNG CDNs fail fast
        const segRaw = pickFirstHlsEntry(fullText, resolvedBase);
        if (!segRaw) {
          return { ok: false, reason: 'Media HLS playlist has no segment entries' };
        }
        const segVal = validateExternalProxyTarget(segRaw, allowPrivateForTest);
        if (!segVal.ok || !segVal.url) {
          return { ok: false, reason: 'Invalid HLS segment URL' };
        }

        const seg = await fetchSegmentBytes(segVal.url, headers, controller.signal, allowPrivateForTest);
        if (seg.status !== 200 && seg.status !== 206) {
          return { ok: false, reason: `HLS segment[0] returned HTTP ${seg.status}` };
        }
        if (seg.buf.length < 512) {
          return { ok: false, reason: `HLS segment[0] too small (${seg.buf.length} bytes)` };
        }
        if (looksLikeHtmlOrErrorPayload(seg.buf, seg.ct)) {
          return { ok: false, reason: 'HLS segment[0] returned HTML/JSON error payload' };
        }
        if (looksLikePureImage(seg.buf, seg.ct)) {
          return { ok: false, reason: 'HLS segment[0] is pure image placeholder without media frames' };
        }
        return { ok: true, streamType: 'hls' };
      }

      // Direct media file (MP4 / MKV / WebM)
      if (looksLikeHtmlOrErrorPayload(buf, ct)) {
        return { ok: false, reason: 'Upstream returned HTML or JSON error page' };
      }
      if (looksLikePureImage(buf, ct)) {
        return { ok: false, reason: 'Upstream returned image disguise without media frames' };
      }

      const offset = findMediaStartOffset(buf);
      if (
        offset >= 0 ||
        ct.startsWith('video/') ||
        ct.startsWith('audio/') ||
        ct.includes('matroska') ||
        ct.includes('octet-stream')
      ) {
        return { ok: true, streamType: 'mp4' };
      }

      return { ok: false, reason: `Unrecognized media signature (${ct || 'unknown'})` };
    }

    return { ok: false, reason: 'Exceeded HLS variant redirect depth' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg.includes('abort') ? 'Verification timeout' : msg };
  } finally {
    clearTimeout(timer);
  }
}

export function buildPublicOrigin(req: Request, fallbackPort = 3000): string {
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const hostHeader = String(
    req.headers['x-forwarded-host'] || req.headers['host'] || `localhost:${fallbackPort}`
  )
    .split(',')[0]
    .trim();
  const proto =
    protoHeader ||
    (hostHeader.startsWith('localhost') || hostHeader.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${proto}://${hostHeader}`;
}

export function parseExplicitQueryHeaders(req: Request): {
  referer?: string;
  origin?: string;
  headersJson?: string;
  headersMap: Record<string, string>;
} {
  const headersMap: Record<string, string> = {};
  const qHeaders = typeof req.query.headers === 'string' ? req.query.headers : '';
  if (qHeaders) {
    try {
      const parsed = JSON.parse(qHeaders);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string' && v.trim()) {
            headersMap[k] = v.trim();
          }
        }
      }
    } catch {
      // Ignore malformed JSON headers parameter
    }
  }
  const qReferer = typeof req.query.referer === 'string' ? req.query.referer.trim() : '';
  const qOrigin = typeof req.query.origin === 'string' ? req.query.origin.trim() : '';
  if (qReferer) headersMap['Referer'] = qReferer;
  if (qOrigin) headersMap['Origin'] = qOrigin;
  return {
    referer: qReferer || headersMap['Referer'] || headersMap['referer'],
    origin: qOrigin || headersMap['Origin'] || headersMap['origin'],
    headersJson: qHeaders || undefined,
    headersMap,
  };
}

export async function handleUnifiedProxyRequest(
  req: Request,
  res: Response,
  mode: 'auto' | 'm3u8' | 'ts' | 'sub' = 'auto',
  allowPrivateForTest = false
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type'
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  const validation = validateExternalProxyTarget(rawUrl, allowPrivateForTest);
  if (!validation.ok || !validation.url) {
    res.status(400).json({ error: validation.reason || 'Invalid proxy URL' });
    return;
  }

  const { referer, origin, headersJson, headersMap } = parseExplicitQueryHeaders(req);
  const forwardHeaders = resolveUpstreamHeaders(validation.url, headersMap);
  const targetPathLowerPre = validation.url.pathname.toLowerCase();
  const rawRangeHeader = typeof req.headers['range'] === 'string' ? req.headers['range'].trim() : '';
  const isOpenZeroRange = /^bytes=0-\s*$/i.test(rawRangeHeader);
  const rangeHeader =
    rawRangeHeader &&
    mode !== 'm3u8' &&
    !targetPathLowerPre.endsWith('.m3u8') &&
    !(mode === 'ts' && isOpenZeroRange)
      ? rawRangeHeader
      : '';
  if (rangeHeader) {
    forwardHeaders['Range'] = rangeHeader;
  }

  const wantsAbsolute =
    req.query.abs === '1' ||
    req.query.absolute === '1' ||
    /lavf|ffmpeg/i.test(String(req.headers['user-agent'] || ''));
  const originBase = wantsAbsolute ? buildPublicOrigin(req) : '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);

  try {
    let upstream = await fetchExternalMedia(validation.url.toString(), {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: forwardHeaders,
      signal: controller.signal,
    }, allowPrivateForTest);

    // Fallback once without Origin header if CDN rejected cross-origin header on segment fetch
    if (upstream.status === 403 && 'Origin' in forwardHeaders) {
      const stripped = { ...forwardHeaders };
      delete stripped['Origin'];
      await upstream.body?.cancel();
      upstream = await fetchExternalMedia(validation.url.toString(), {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: stripped,
        signal: controller.signal,
      }, allowPrivateForTest);
    }

    const upstreamCt = (upstream.headers.get('content-type') || 'application/octet-stream').toLowerCase();
    const targetPathLower = validation.url.pathname.toLowerCase();

    const isSubtitle =
      mode === 'sub' ||
      targetPathLower.endsWith('.vtt') ||
      targetPathLower.endsWith('.srt') ||
      upstreamCt.includes('text/vtt') ||
      upstreamCt.includes('subrip');

    if (isSubtitle && req.method !== 'HEAD') {
      const subText = await upstream.text();
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `Upstream subtitle returned HTTP ${upstream.status}` });
        return;
      }
      const wantsVtt =
        req.query.format === 'vtt' ||
        targetPathLower.endsWith('.srt') ||
        !subText.trimStart().startsWith('WEBVTT');
      const finalSub = wantsVtt && !subText.trimStart().startsWith('WEBVTT')
        ? convertSrtToVtt(subText)
        : subText;
      res.status(200);
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.send(finalSub);
      return;
    }

    const isPlaylistHint =
      mode === 'm3u8' ||
      targetPathLower.endsWith('.m3u8') ||
      upstreamCt.includes('mpegurl') ||
      upstreamCt.includes('x-mpegurl');

    if (isPlaylistHint && req.method !== 'HEAD') {
      const playlistText = await upstream.text();
      if (!upstream.ok || !playlistText.includes('#EXTM3U')) {
        res
          .status(upstream.ok ? 502 : upstream.status)
          .json({ error: 'Upstream returned invalid HLS playlist' });
        return;
      }
      const rewritten = rewriteHlsManifest(
        playlistText,
        upstream.url || validation.url.toString(),
        originBase,
        { referer, origin, headersJson }
      );
      res.status(200);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(rewritten);
      return;
    }

    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status).json({ error: `Upstream returned HTTP ${upstream.status}` });
      return;
    }

    const hasRangeHeader = Boolean(rangeHeader) && !isOpenZeroRange;
    const isImageDisguised = upstreamCt.startsWith('image/');
    const contentLengthHeader = upstream.headers.get('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;

    // Stream directly when bounded Range request or large MP4/MKV file (> 4 MB) without image disguise
    if (
      req.method !== 'HEAD' &&
      upstream.body &&
      !isImageDisguised &&
      (hasRangeHeader || contentLength > 4 * 1024 * 1024 || upstreamCt.startsWith('video/') && mode === 'auto')
    ) {
      res.status(upstream.status === 206 ? 206 : 200);
      res.setHeader('Content-Type', inferSegmentContentType(targetPathLower, upstreamCt));
      res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
      if (contentLengthHeader) res.setHeader('Content-Length', contentLengthHeader);
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);
      if (req.query.download === '1') {
        const fname = typeof req.query.filename === 'string' ? req.query.filename : 'kinova-video.mp4';
        res.setHeader('Content-Disposition', `attachment; filename="${fname.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
      }

      clearTimeout(timer);
      res.flushHeaders();
      await pipeline(upstream.body, res);
      return;
    }

    const rawBuf = Buffer.from(await upstream.arrayBuffer());

    // Handle extensionless HLS variant playlists (e.g. vercetti.org/seg/...) even if routed via /api/ts-proxy
    if (!hasRangeHeader && rawBuf.subarray(0, 64).toString('utf8').includes('#EXTM3U')) {
      const rewritten = rewriteHlsManifest(
        rawBuf.toString('utf8'),
        upstream.url || validation.url.toString(),
        originBase,
        { referer, origin, headersJson }
      );
      res.status(200);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(rewritten);
      return;
    }

    if (!hasRangeHeader && looksLikePureImage(rawBuf, upstreamCt)) {
      res.status(502).json({ error: 'Upstream returned non-media image payload' });
      return;
    }
    if (!hasRangeHeader && looksLikeHtmlOrErrorPayload(rawBuf, upstreamCt)) {
      res.status(502).json({ error: 'Upstream returned HTML/JSON error instead of media' });
      return;
    }

    let outBuf = rawBuf;
    let unwrapped = false;
    let normalizedCt = inferSegmentContentType(targetPathLower, upstreamCt);
    if (!hasRangeHeader || isImageDisguised) {
      const mediaOffset = findMediaStartOffset(rawBuf);
      if (mediaOffset > 0) {
        outBuf = rawBuf.subarray(mediaOffset);
        unwrapped = true;
      }
      if ((isImageDisguised || upstreamCt.includes('text/html')) && mediaOffset >= 0) {
        normalizedCt = targetPathLower.endsWith('.mp4') ? 'video/mp4' : 'video/mp2t';
      }
    }

    const sendPartial = !unwrapped && !isOpenZeroRange && upstream.status === 206;
    res.status(sendPartial ? 206 : 200);
    res.setHeader('Content-Type', normalizedCt);
    res.setHeader('Accept-Ranges', unwrapped ? 'none' : upstream.headers.get('accept-ranges') || 'bytes');
    res.setHeader('Content-Length', String(outBuf.length));
    const contentRange = sendPartial ? upstream.headers.get('content-range') : null;
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (req.query.download === '1') {
      const fname = typeof req.query.filename === 'string' ? req.query.filename : 'kinova-video.mp4';
      res.setHeader('Content-Disposition', `attachment; filename="${fname.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    }

    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.send(outBuf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = msg.toLowerCase().includes('abort') ? 504 : 502;
    if (!res.headersSent) {
      res.status(code).json({ error: msg || 'Upstream proxy error' });
    }
  } finally {
    clearTimeout(timer);
  }
}

// Direct downloadable stream endpoint:
// - Direct MP4/MKV: streams through proxy with Content-Disposition: attachment
// - HLS (.m3u8): routes through our local Node m3u8/ts proxy (unwrapping PNG/JPEG disguises!)
//   and remuxes via ffmpeg into a universal fragmented MP4 stream (`video/mp4`),
//   with pure-Node MPEG-TS fallback if ffmpeg is unavailable.
export async function handleStreamDownloadRequest(
  req: Request,
  res: Response,
  allowPrivateForTest = false
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  const validation = validateExternalProxyTarget(rawUrl, allowPrivateForTest);
  if (!validation.ok || !validation.url) {
    res.status(400).json({ error: validation.reason || 'Invalid download URL' });
    return;
  }

  const streamTypeHint = String(req.query.type || '').toLowerCase();
  const isDirectFile =
    streamTypeHint === 'mp4' ||
    streamTypeHint === 'file' ||
    /\.(mp4|mkv|webm|m4v)(\?|$)/i.test(validation.url.pathname);

  const rawFilename =
    typeof req.query.filename === 'string' && req.query.filename.trim()
      ? req.query.filename.trim()
      : 'kinova-video.mp4';
  const safeFilename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');

  if (isDirectFile) {
    req.query.download = '1';
    req.query.filename = safeFilename;
    await handleUnifiedProxyRequest(req, res, 'auto', allowPrivateForTest);
    return;
  }

  const { referer, origin, headersJson } = parseExplicitQueryHeaders(req);
  const localPort = req.socket.localPort || Number(process.env.KINOVA_PORT || 3000);
  const localBase = `http://127.0.0.1:${localPort}`;
  const proxiedM3u8Url = buildProxyUrl(validation.url.toString(), localBase, '/api/m3u8-proxy', {
    referer,
    origin,
    headersJson,
  });
  const deadline = Date.now() + 17_000;

  if (req.method === 'HEAD') {
    const check = await verifyPlayableCandidate(
      validation.url.toString(),
      parseExplicitQueryHeaders(req).headersMap,
      5000,
      allowPrivateForTest
    );
    if (!check.ok) {
      res.status(502).json({ error: check.reason || 'Download source unavailable' });
      return;
    }
    res.status(200);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename.endsWith('.mp4') ? safeFilename : `${safeFilename}.mp4`}"`);
    res.end();
    return;
  }

  // Pre-resolve master playlist to its highest-bandwidth single variant so ffmpeg
  // does not waste 15-30s probing all bitrate variants sequentially.
  let ffmpegInputUrl = proxiedM3u8Url;
  try {
    const manifestProbe = await fetch(proxiedM3u8Url, { signal: AbortSignal.timeout(3500) });
    if (manifestProbe.ok) {
      const manifestText = await manifestProbe.text();
      if (manifestText.includes('#EXT-X-STREAM-INF') && !manifestText.includes('#EXT-X-MEDIA:')) {
        const bestVariant = pickBestHlsVariant(manifestText, proxiedM3u8Url);
        if (bestVariant) {
          ffmpegInputUrl = bestVariant;
        }
      }
    }
  } catch {
    // Fall back to proxiedM3u8Url if pre-resolution fails
  }

  const mp4Filename = safeFilename.endsWith('.mp4') ? safeFilename : `${safeFilename}.mp4`;
  const inputs = [...new Set([ffmpegInputUrl, proxiedM3u8Url])];
  for (const input of inputs) {
    const budget = Math.min(deadline - Date.now(), 6_000);
    if (budget <= 0) break;
    const outcome = await remuxToMp4({ url: input }, res, mp4Filename, budget);
    if (outcome === 'done' || res.destroyed) return;
    if (outcome === 'unavailable') {
      await streamConcatenatedHlsTs(proxiedM3u8Url, res, safeFilename.replace(/\.mp4$/i, '.ts'));
      return;
    }
  }
  const budget = deadline - Date.now();
  if (budget > 0) {
    const segments = await findTransportStreamSegments(ffmpegInputUrl, AbortSignal.timeout(budget)).catch(() => null);
    const remaining = deadline - Date.now();
    if (segments?.length && remaining > 0 && !res.destroyed) {
      const outcome = await remuxToMp4({ segments }, res, mp4Filename, remaining);
      if (outcome === 'done' || res.destroyed) return;
    }
  }
  if (res.destroyed) return;
  res.status(502).json({ error: 'This source could not be packaged. Try another stream source.' });
}

async function findTransportStreamSegments(manifestUrl: string, signal: AbortSignal): Promise<string[] | null> {
  const response = await fetch(manifestUrl, { signal });
  if (!response.ok) return null;
  const text = await response.text();
  if (!text.includes('#EXT-X-ENDLIST') || /#EXT-X-(?:STREAM-INF|MAP|BYTERANGE|DISCONTINUITY)\b|#EXT-X-KEY:METHOD=(?!NONE)/.test(text)) {
    return null;
  }
  const localOrigin = new URL(manifestUrl).origin;
  const segments = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const urls = segments.map((segment) => new URL(segment, manifestUrl));
  if (urls.some((url) => url.origin !== localOrigin || url.pathname !== '/api/ts-proxy')) return null;
  return urls.map((url) => url.href);
}

async function* transportStreamChunks(segments: string[], signal: AbortSignal) {
  for (const segment of segments) {
    const response = await fetch(segment, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    if (!response.ok || !response.body) throw new Error('Download segment unavailable');
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

function remuxToMp4(
  input: { url: string } | { segments: string[] },
  res: Response,
  filename: string,
  startupTimeout: number
): Promise<'done' | 'retry' | 'unavailable'> {
  const inputArgs = 'segments' in input ? ['-f', 'mpegts', '-i', 'pipe:0'] : [
    '-protocol_whitelist',
    'http,tcp,crypto',
    '-analyzeduration',
    '2000000',
    '-rw_timeout',
    '7000000',
    '-http_seekable',
    '0',
    '-http_persistent',
    '0',
    '-http_multiple',
    '0',
    '-f',
    'hls',
    '-i',
    input.url,
  ];
  const ffArgs = [
    '-hide_banner',
    '-loglevel',
    'error',
    ...inputArgs,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c',
    'copy',
    '-f',
    'mp4',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  ];

  let executable = 'ffmpeg';
  try {
    const packagePath = createRequire(import.meta.url).resolve('ffmpeg-static/package.json');
    executable = join(dirname(packagePath), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  } catch {
    executable = 'ffmpeg';
  }
  return new Promise((resolve) => {
    const ff = spawn(executable, ffArgs, { stdio: ['pipe', 'pipe', 'ignore'] });
    const controller = new AbortController();
    let started = false;
    const stop = () => { if (ff.exitCode === null && !ff.killed) ff.kill('SIGKILL'); };
    const timer = setTimeout(stop, startupTimeout);
    res.once('close', stop);
    if ('segments' in input) {
      void pipeline(transportStreamChunks(input.segments, controller.signal), ff.stdin).catch(stop);
    } else {
      ff.stdin.end();
    }

    ff.stdout.once('data', (firstChunk: Buffer) => {
      if (res.destroyed) return;
      started = true;
      clearTimeout(timer);
      res.status(200);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'none');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.write(firstChunk);
      ff.stdout.pipe(res, { end: false });
    });

    ff.once('error', () => {
      clearTimeout(timer);
      res.off('close', stop);
      resolve('unavailable');
    });
    ff.once('close', (code) => {
      controller.abort();
      clearTimeout(timer);
      res.off('close', stop);
      if (started && !res.destroyed) {
        if (code === 0) res.end();
        else res.destroy();
      }
      resolve(started || res.destroyed ? 'done' : 'retry');
    });
  });
}

async function streamConcatenatedHlsTs(
  proxiedM3u8Url: string,
  res: Response,
  filename: string
): Promise<void> {
  try {
    let manifestRes = await fetch(proxiedM3u8Url, { signal: AbortSignal.timeout(10_000) });
    if (!manifestRes.ok) {
      res.status(502).json({ error: `Failed to fetch HLS playlist (${manifestRes.status})` });
      return;
    }
    let text = await manifestRes.text();
    let manifestUrl = proxiedM3u8Url;
    if (text.includes('#EXT-X-STREAM-INF')) {
      const variant = pickBestHlsVariant(text, proxiedM3u8Url);
      if (!variant) {
        res.status(502).json({ error: 'No HLS variant found' });
        return;
      }
      manifestRes = await fetch(variant, { signal: AbortSignal.timeout(10_000) });
      if (!manifestRes.ok) {
        res.status(502).json({ error: `Failed to fetch variant playlist (${manifestRes.status})` });
        return;
      }
      text = await manifestRes.text();
      manifestUrl = variant;
    }

    if (/#EXT-X-(?:MAP|BYTERANGE):|#EXT-X-KEY:METHOD=(?!NONE)/.test(text)) {
      res.status(502).json({ error: 'This download requires the MP4 packager.' });
      return;
    }

    const segments = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    if (segments.length === 0) {
      res.status(502).json({ error: 'Playlist has no segments' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    for (const segUrl of segments) {
      if (res.writableEnded) break;
      const segRes = await fetch(new URL(segUrl, manifestUrl), { signal: AbortSignal.timeout(15_000) });
      if (!segRes.ok) throw new Error(`Segment HTTP ${segRes.status}`);
      const buf = Buffer.from(await segRes.arrayBuffer());
      res.write(buf);
    }
    if (!res.writableEnded) res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Download stream error' });
    } else if (!res.writableEnded) {
      res.destroy();
    }
  }
}
