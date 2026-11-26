import {
  DEFAULT_USER_AGENT,
  TtlLruCache,
  buildDownloadEndpointUrl,
  buildProxyUrl,
  verifyPlayableCandidate,
} from '../proxyEngine.js';

export interface ResolvedSubtitleTrack {
  language: string;
  label: string;
  url: string;
  proxyUrl: string;
  format: 'vtt' | 'srt';
}

export interface ResolvedStreamSource {
  id: string;
  provider: 'vidzee' | 'x8rr' | 'anime123' | 'vyla' | 'archive';
  serverName: string;
  label: string;
  quality: string;
  height: number;
  language: string;
  streamType: 'hls' | 'mp4';
  directUrl: string;
  proxyUrl: string;
  downloadProxyUrl?: string;
  headers: Record<string, string>;
  verified: boolean;
  isDownloadable: boolean;
  subtitles: ResolvedSubtitleTrack[];
}

export interface StreamResolutionResult {
  sources: ResolvedStreamSource[];
  subtitles: ResolvedSubtitleTrack[];
  diagnostics: Array<{
    provider: string;
    status: 'ok' | 'empty' | 'error';
    count: number;
    detail?: string;
    elapsedMs: number;
  }>;
}

const streamCache = new TtlLruCache<StreamResolutionResult>(600, 180_000);

const VIDZEE_HEADERS = {
  Referer: 'https://player.vidzee.wtf/',
  Origin: 'https://player.vidzee.wtf',
  'User-Agent': DEFAULT_USER_AGENT,
  Accept: 'application/json, text/plain, */*',
};

const VIDPRIME_PLAYER_KEY = 'f3b72e73c80c9a996574379798703796a1936efa3516a7105cb0e43048b46b5a';
const VIDSPARK_PLAYER_KEY = '3a67e8866ae1d2bb9e81fe7f73315a56eb3bdf5e3e755c7554c8be6910aa6b13';

function parseHeightFromQuality(raw: string): number {
  const q = String(raw || '').toLowerCase();
  if (q.includes('2160') || q.includes('4k') || q.includes('uhd')) return 2160;
  if (q.includes('1440') || q.includes('2k')) return 1440;
  if (q.includes('1080') || q.includes('fhd')) return 1080;
  if (q.includes('720') || q.includes('hd')) return 720;
  if (q.includes('480') || q.includes('sd')) return 480;
  if (q.includes('360')) return 360;
  const num = Number(q.replace(/[^0-9]/g, ''));
  return Number.isFinite(num) && num >= 240 ? num : 720;
}

function normalizeSubtitleTracks(
  rawTracks: unknown,
  originBase: string,
  headers: Record<string, string>
): ResolvedSubtitleTrack[] {
  if (!Array.isArray(rawTracks)) return [];
  const seen = new Set<string>();
  const tracks: ResolvedSubtitleTrack[] = [];
  for (const item of rawTracks) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const rawUrl = String(rec.url || rec.file || rec.src || '').trim();
    if (!rawUrl || !rawUrl.startsWith('http') || seen.has(rawUrl)) continue;
    seen.add(rawUrl);
    const label = String(rec.lang || rec.label || rec.language || 'English').trim();
    const language = String(rec.code || rec.srclang || label.slice(0, 2).toLowerCase() || 'en').trim();
    const format: 'vtt' | 'srt' = rawUrl.toLowerCase().includes('.srt') ? 'srt' : 'vtt';
    const proxyUrl =
      buildProxyUrl(rawUrl, originBase, '/api/sub-proxy', {
        referer: headers.Referer || headers.referer,
        origin: headers.Origin || headers.origin,
      }) + '&format=vtt';
    tracks.push({
      language,
      label,
      url: rawUrl,
      proxyUrl,
      format,
    });
  }
  return tracks;
}

async function fetchJsonWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 5500
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

interface RawExtractedCandidate {
  provider: 'vidzee' | 'x8rr';
  serverName: string;
  url: string;
  quality: string;
  language: string;
  streamType?: 'hls' | 'mp4';
  headers: Record<string, string>;
  subtitles: ResolvedSubtitleTrack[];
}

// 1. VidZee extraction combining neilbauman21-hub/free-moveis-api + x8rr/movies/src/vidzee.js
async function fetchVidZeeServers(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  originBase: string,
  season?: number,
  episode?: number
): Promise<RawExtractedCandidate[]> {
  const path =
    mediaType === 'tv' && season && episode
      ? `tv/${tmdbId}/${season}/${episode}`
      : `movie/${tmdbId}`;

  let langs: string[] = [];
  try {
    const langDto = (await fetchJsonWithTimeout(
      `https://core.vidzee.wtf/streams/languages/${path}`,
      VIDZEE_HEADERS,
      3500
    )) as { languages?: unknown };
    if (Array.isArray(langDto?.languages)) {
      langs = langDto.languages.filter((l): l is string => typeof l === 'string' && l.trim().length > 0);
    }
  } catch {
    langs = [];
  }

  // Prioritize English/Hindi first on v4 servers, plus peak (movies), v6:English, v6:Hindi, dcloud, tik
  const orderedLangs = [
    ...langs.filter((l) => /^en/i.test(l)),
    ...langs.filter((l) => !/^en/i.test(l)).slice(0, 2),
  ];

  const serverList: Array<{ id: string; label: string }> = [
    ...(mediaType === 'movie' ? [{ id: 'peak', label: 'Peak HD' }] : []),
    { id: 'v6:English', label: 'V6 English' },
    { id: 'dcloud', label: 'dcloud' },
    { id: 'tik', label: 'TCloud' },
    { id: 'v6:Hindi', label: 'V6 Hindi' },
    ...orderedLangs.map((l) => ({ id: `v4:${l}`, label: `Acme ${l}` })),
  ];

  const settled = await Promise.allSettled(
    serverList.map(async (srv): Promise<RawExtractedCandidate[]> => {
      const endpoint = `https://core.vidzee.wtf/streams/${path}?s=${encodeURIComponent(srv.id)}&e=0`;
      const data = (await fetchJsonWithTimeout(endpoint, VIDZEE_HEADERS, 5000)) as Record<string, unknown>;
      const apiHeaders =
        data?.headers && typeof data.headers === 'object'
          ? (data.headers as Record<string, string>)
          : {};
      const rawHeaders: Record<string, string> = {
        Referer: 'https://player.vidzee.wtf/',
        Origin: 'https://player.vidzee.wtf',
        ...Object.fromEntries(Object.entries(apiHeaders).filter(([, v]) => Boolean(v))),
      };

      const tracks = normalizeSubtitleTracks(
        data?.tracks || data?.subtitles || data?.captions,
        originBase,
        rawHeaders
      );

      const rawList: Array<Record<string, unknown>> = [];
      if (Array.isArray(data?.url)) {
        for (const entry of data.url) {
          if (entry && typeof entry === 'object') rawList.push(entry as Record<string, unknown>);
          else if (typeof entry === 'string') rawList.push({ link: entry });
        }
      } else if (Array.isArray(data?.sources)) {
        for (const entry of data.sources) {
          if (entry && typeof entry === 'object') rawList.push(entry as Record<string, unknown>);
        }
      } else if (typeof data?.url === 'string') {
        rawList.push({ link: data.url, name: data.name, type: data.type, language: data.language });
      } else if (typeof data?.link === 'string') {
        rawList.push({ link: data.link, name: data.name, type: data.type, language: data.language });
      }

      const out: RawExtractedCandidate[] = [];
      for (const item of rawList) {
        const link = String(item.link || item.url || item.file || '').trim();
        if (!link || !link.startsWith('http')) continue;
        const itemHeaders =
          item.headers && typeof item.headers === 'object'
            ? { ...rawHeaders, ...(item.headers as Record<string, string>) }
            : rawHeaders;
        const quality = String(item.quality || item.name || item.label || '1080p HD').trim();
        const rawLang = String(
          item.lang ||
            item.language ||
            data?.language ||
            (srv.id.includes(':') ? srv.id.split(':')[1] : 'English')
        ).trim();
        const language = rawLang.toLowerCase() === 'auto' ? 'English' : rawLang;
        const typeHint = String(item.type || '').toLowerCase();
        const streamType: 'hls' | 'mp4' =
          typeHint === 'mp4' || /\.(mp4|mkv|webm)(\?|$)/i.test(link) ? 'mp4' : 'hls';
        out.push({
          provider: 'vidzee',
          serverName: `VidZee (${srv.label})`,
          url: link,
          quality,
          language,
          streamType,
          headers: itemHeaders,
          subtitles: tracks,
        });
      }
      return out;
    })
  );

  const candidates: RawExtractedCandidate[] = [];
  for (const res of settled) {
    if (res.status === 'fulfilled' && res.value.length > 0) {
      candidates.push(...res.value);
    }
  }
  return candidates;
}

// 2. X8RR Multi-Source extractors (VidPrime + TwoEmbed + VidSpark + VixSrc + Videasy)
async function queryVidPrimeSources(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  originBase: string,
  season?: number,
  episode?: number
): Promise<RawExtractedCandidate[]> {
  const base = 'https://vidprime.top';
  const path =
    mediaType === 'tv' && season && episode
      ? `/v1/tv/${tmdbId}/${season}/${episode}`
      : `/v1/movie/${tmdbId}`;
  const pageUrl =
    mediaType === 'tv' && season && episode
      ? `${base}/tv/${tmdbId}/${season}/${episode}`
      : `${base}/movie/${tmdbId}`;

  const servers: Array<[string, string]> = [
    ['x9pv', 'Helix'],
    ['w7dn', 'Orion'],
    ['vjej', 'Zenith'],
  ];

  const out: RawExtractedCandidate[] = [];
  const results = await Promise.allSettled(
    servers.map(async ([key, label]) => {
      const json = (await fetchJsonWithTimeout(
        `${base}/api/vidora${path}?source=${key}`,
        {
          'User-Agent': DEFAULT_USER_AGENT,
          Referer: pageUrl,
          'x-player-key': VIDPRIME_PLAYER_KEY,
        },
        5500
      )) as {
        result?: boolean;
        sources?: Array<{ url?: string; quality?: string; language?: string }>;
        subtitles?: unknown;
        tracks?: unknown;
      };
      if (!json?.result || !Array.isArray(json.sources)) return [];
      const subs = normalizeSubtitleTracks(json.subtitles || json.tracks, originBase, {
        Referer: `${base}/`,
        Origin: base,
      });
      return json.sources
        .filter((s) => s?.url && s.url.startsWith('http') && !/dash-mpd|\.mpd(\?|$)/i.test(s.url))
        .map((s) => ({
          provider: 'x8rr' as const,
          serverName: `VidPrime (${label})`,
          url: String(s.url),
          quality: String(s.quality || '1080p HD'),
          language: String(s.language || 'English'),
          streamType: /\.(mp4|mkv|webm)(\?|$)/i.test(String(s.url)) ? ('mp4' as const) : ('hls' as const),
          headers: { Referer: `${base}/`, Origin: base },
          subtitles: subs,
        }));
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled') out.push(...r.value);
  }
  return out;
}

async function queryTwoEmbedSources(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number
): Promise<RawExtractedCandidate[]> {
  const base = 'https://vidsrc.buzz';
  const api = `${base}/pl/api.php`;
  const path =
    mediaType === 'tv' && season && episode
      ? `/embed/tv/${tmdbId}/${season}/${episode}`
      : `/embed/movie/${tmdbId}`;

  try {
    const res = await fetch(`${base}${path}`, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Referer: 'https://www.2embed.cc/',
      },
      signal: AbortSignal.timeout(5500),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const match = html.match(/var Q = (\{.*?\});\n/s);
    if (!match) return [];
    const q = JSON.parse(match[1]) as {
      t?: string;
      ssr?: { servers?: Array<{ ref: string; name?: string; lang?: string }> };
    };
    const servers = q.ssr?.servers || [];
    if (!q.t || servers.length === 0) return [];

    const ordered = [
      ...servers.filter((s) => !/XPM/i.test(s.name || '')),
      ...servers.filter((s) => /XPM/i.test(s.name || '')),
    ].slice(0, 10);

    const refs = ordered.map((s) => s.ref).join(',');
    const raceJson = (await fetchJsonWithTimeout(
      `${api}?a=race&refs=${encodeURIComponent(refs)}`,
      { 'User-Agent': DEFAULT_USER_AGENT },
      5500
    )) as { cands?: Array<{ ref: string; url: string; type?: string }> };

    const cands = raceJson?.cands || [];
    const out: RawExtractedCandidate[] = [];
    for (const c of cands.slice(0, 4)) {
      if (!c?.url) continue;
      const absUrl = new URL(c.url, `${base}/`).href;
      const meta = ordered.find((s) => s.ref === c.ref);
      const isFile = c.type === 'mp4' || /\.(mp4|mkv|webm)(\?|$)/i.test(absUrl);
      const isMkv = /\.mkv(\?|$)/i.test(absUrl);
      out.push({
        provider: 'x8rr',
        serverName: meta?.name ? `2Embed (${meta.name})` : '2Embed Direct',
        url: absUrl,
        quality: isMkv ? '1080p MKV' : isFile ? '1080p MP4' : 'Auto HD',
        language: meta?.lang || 'English',
        streamType: isFile ? 'mp4' : 'hls',
        headers: { Referer: `${base}/` },
        subtitles: [],
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function queryVidSparkSources(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  originBase: string,
  season?: number,
  episode?: number
): Promise<RawExtractedCandidate[]> {
  const base = 'https://vidspark.to';
  const path =
    mediaType === 'tv' && season && episode
      ? `/tv/${tmdbId}/${season}/${episode}`
      : `/movie/${tmdbId}`;
  try {
    const json = (await fetchJsonWithTimeout(
      `${base}/api/vidora/v1${path}`,
      {
        'User-Agent': DEFAULT_USER_AGENT,
        Referer: `${base}${path}`,
        'x-player-key': VIDSPARK_PLAYER_KEY,
      },
      4000
    )) as {
      result?: boolean;
      sources?: Array<{ url?: string; quality?: string }>;
      subtitles?: unknown;
    };
    if (!json?.result || !Array.isArray(json.sources)) return [];
    const subs = normalizeSubtitleTracks(json.subtitles, originBase, {
      Referer: `${base}/`,
      Origin: base,
    });
    return json.sources
      .filter((s) => s?.url && s.url.startsWith('http'))
      .map((s) => ({
        provider: 'x8rr' as const,
        serverName: 'VidSpark HD',
        url: String(s.url),
        quality: String(s.quality || '1080p'),
        language: 'English',
        streamType: String(s.url).includes('.m3u8') ? ('hls' as const) : ('mp4' as const),
        headers: { Referer: `${base}/`, Origin: base },
        subtitles: subs,
      }));
  } catch {
    return [];
  }
}

async function queryX8rrMultiSources(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  originBase: string,
  season?: number,
  episode?: number
): Promise<RawExtractedCandidate[]> {
  const candidates: RawExtractedCandidate[] = [];

  const [vidPrimeRes, twoEmbedRes, vidSparkRes, videasyRes, vixSrcRes] = await Promise.allSettled([
    queryVidPrimeSources(mediaType, tmdbId, originBase, season, episode),
    queryTwoEmbedSources(mediaType, tmdbId, season, episode),
    queryVidSparkSources(mediaType, tmdbId, originBase, season, episode),
    (async (): Promise<RawExtractedCandidate[]> => {
      const videasyEndpoints =
        mediaType === 'tv' && season && episode
          ? [
              `https://api.videasy.net/myflixerzupcloud/sources-with-title?title=TV&mediaType=tv&tmdbId=${tmdbId}&seasonId=${season}&episodeId=${episode}`,
              `https://api.videasy.net/1movies/sources-with-title?title=TV&mediaType=tv&tmdbId=${tmdbId}&seasonId=${season}&episodeId=${episode}`,
            ]
          : [
              `https://api.videasy.net/myflixerzupcloud/sources-with-title?title=Movie&mediaType=movie&tmdbId=${tmdbId}`,
              `https://api.videasy.net/1movies/sources-with-title?title=Movie&mediaType=movie&tmdbId=${tmdbId}`,
            ];
      const out: RawExtractedCandidate[] = [];
      await Promise.allSettled(
        videasyEndpoints.map(async (ep, idx) => {
          const vHeaders = {
            Referer: 'https://player.videasy.net/',
            Origin: 'https://player.videasy.net',
            'User-Agent': DEFAULT_USER_AGENT,
          };
          const json = (await fetchJsonWithTimeout(ep, vHeaders, 3500)) as Record<string, unknown>;
          const subs = normalizeSubtitleTracks(json?.subtitles || json?.tracks, originBase, vHeaders);
          const list = Array.isArray(json?.sources) ? (json.sources as Array<Record<string, unknown>>) : [];
          for (const s of list) {
            const url = String(s.url || s.file || '').trim();
            if (!url.startsWith('http')) continue;
            out.push({
              provider: 'x8rr',
              serverName: idx === 0 ? 'X8RR / MyFlixer' : 'X8RR / 1Movies',
              url,
              quality: String(s.quality || '1080p'),
              language: String(s.language || 'English'),
              streamType: url.toLowerCase().includes('.mp4') ? 'mp4' : 'hls',
              headers: vHeaders,
              subtitles: subs,
            });
          }
        })
      );
      return out;
    })(),
    (async (): Promise<RawExtractedCandidate[]> => {
      const vixUrl =
        mediaType === 'tv' && season && episode
          ? `https://vixsrc.to/tv/${tmdbId}/${season}/${episode}`
          : `https://vixsrc.to/movie/${tmdbId}`;
      const res = await fetch(vixUrl, {
        headers: { Referer: 'https://vixsrc.to/', 'User-Agent': DEFAULT_USER_AGENT },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return [];
      const html = await res.text();
      const playlistMatch = html.match(/window\.masterPlaylist\s*=\s*\{[\s\S]*?url:\s*['"]([^'"]+)['"]/i);
      const tokenMatch = html.match(/token['"]?\s*:\s*['"]([^'"]+)['"]/i);
      const expiresMatch = html.match(/expires['"]?\s*:\s*['"]?(\d+)['"]?/i);
      if (!playlistMatch?.[1]) return [];
      const baseM3u8 = new URL(playlistMatch[1]);
      if (tokenMatch?.[1]) baseM3u8.searchParams.set('token', tokenMatch[1]);
      if (expiresMatch?.[1]) baseM3u8.searchParams.set('expires', expiresMatch[1]);
      baseM3u8.searchParams.set('h', '1');
      return [
        {
          provider: 'x8rr',
          serverName: 'X8RR / VixSrc',
          url: baseM3u8.toString(),
          quality: '1080p HD',
          language: 'Multi',
          streamType: 'hls',
          headers: { Referer: 'https://vixsrc.to/', Origin: 'https://vixsrc.to' },
          subtitles: [],
        },
      ];
    })(),
  ]);

  for (const r of [vidPrimeRes, twoEmbedRes, vidSparkRes, videasyRes, vixSrcRes]) {
    if (r.status === 'fulfilled' && r.value.length > 0) {
      candidates.push(...r.value);
    }
  }

  return candidates;
}

export async function resolveMovieOrTvStreams(params: {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  season?: number;
  episode?: number;
  originBase: string;
  vylaBaseUrl?: string;
  preferredProvider?: string;
  verifyAll?: boolean;
}): Promise<StreamResolutionResult> {
  const {
    mediaType,
    tmdbId,
    season,
    episode,
    originBase,
    vylaBaseUrl,
    preferredProvider = 'auto',
    verifyAll = true,
  } = params;
  const cacheKey = `v2:${mediaType}:${tmdbId}:${season ?? 0}:${episode ?? 0}:${originBase}:${preferredProvider}`;
  const cached = streamCache.get(cacheKey);
  if (cached && cached.sources.length > 0) {
    return cached;
  }

  const diagnostics: StreamResolutionResult['diagnostics'] = [];
  const rawCandidates: RawExtractedCandidate[] = [];

  // Query VidZee and X8RR Multi-Source extractors concurrently
  const vidzeeStart = Date.now();
  const x8rrStart = Date.now();

  const [vidzeeSettled, x8rrSettled] = await Promise.allSettled([
    fetchVidZeeServers(mediaType, tmdbId, originBase, season, episode).then((list) => {
      diagnostics.push({
        provider: 'VidZee (free-moveis-api)',
        status: list.length > 0 ? 'ok' : 'empty',
        count: list.length,
        elapsedMs: Date.now() - vidzeeStart,
      });
      return list;
    }),
    queryX8rrMultiSources(mediaType, tmdbId, originBase, season, episode).then((list) => {
      diagnostics.push({
        provider: 'X8RR Multi-Source',
        status: list.length > 0 ? 'ok' : 'empty',
        count: list.length,
        elapsedMs: Date.now() - x8rrStart,
      });
      return list;
    }),
  ]);

  if (vidzeeSettled.status === 'fulfilled') rawCandidates.push(...vidzeeSettled.value);
  else {
    diagnostics.push({
      provider: 'VidZee (free-moveis-api)',
      status: 'error',
      count: 0,
      detail: vidzeeSettled.reason instanceof Error ? vidzeeSettled.reason.message : String(vidzeeSettled.reason),
      elapsedMs: Date.now() - vidzeeStart,
    });
  }

  if (x8rrSettled.status === 'fulfilled') rawCandidates.push(...x8rrSettled.value);
  else {
    diagnostics.push({
      provider: 'X8RR Multi-Source',
      status: 'error',
      count: 0,
      detail: x8rrSettled.reason instanceof Error ? x8rrSettled.reason.message : String(x8rrSettled.reason),
      elapsedMs: Date.now() - x8rrStart,
    });
  }

  // Deduplicate by URL
  const uniqueMap = new Map<string, RawExtractedCandidate>();
  for (const cand of rawCandidates) {
    if (!uniqueMap.has(cand.url)) {
      uniqueMap.set(cand.url, cand);
    }
  }
  const deduped = Array.from(uniqueMap.values()).slice(0, 16);

  // Verify candidates (playlist + segment[0] probe so 429/70-byte dummy CDNs are excluded)
  const verifiedSources: ResolvedStreamSource[] = [];
  const allSubtitles: ResolvedSubtitleTrack[] = [];
  const subSeen = new Set<string>();
  const defaultFilename =
    mediaType === 'tv' && season && episode
      ? `kinova-tv-${tmdbId}-s${season}e${episode}.mp4`
      : `kinova-movie-${tmdbId}.mp4`;

  await Promise.allSettled(
    deduped.map(async (cand, idx) => {
      for (const s of cand.subtitles) {
        if (!subSeen.has(s.url)) {
          subSeen.add(s.url);
          allSubtitles.push(s);
        }
      }

      let isVerified = true;
      let resolvedType = cand.streamType || (/\.(mp4|mkv|webm)(\?|$)/i.test(cand.url) ? 'mp4' : 'hls');

      if (verifyAll) {
        const probe = await verifyPlayableCandidate(cand.url, cand.headers, 5500);
        isVerified = probe.ok;
        if (probe.streamType) resolvedType = probe.streamType;
      }

      if (!isVerified) return;

      const endpoint = resolvedType === 'hls' ? '/api/m3u8-proxy' : '/api/proxy';
      const referer = cand.headers.Referer || cand.headers.referer;
      const origin = cand.headers.Origin || cand.headers.origin;
      const proxyUrl = buildProxyUrl(cand.url, originBase, endpoint, { referer, origin });
      const downloadProxyUrl = buildDownloadEndpointUrl({
        targetRawUrl: cand.url,
        originBase,
        streamType: resolvedType,
        filename: defaultFilename,
        referer,
        origin,
      });

      verifiedSources.push({
        id: `${cand.provider}_${idx}_${Buffer.from(cand.url).toString('base64url').slice(0, 10)}`,
        provider: cand.provider,
        serverName: cand.serverName,
        label: `${cand.serverName} • ${cand.quality} (${cand.language})`,
        quality: cand.quality,
        height: parseHeightFromQuality(cand.quality),
        language: cand.language,
        streamType: resolvedType,
        directUrl: cand.url,
        proxyUrl,
        downloadProxyUrl,
        headers: cand.headers,
        verified: true,
        isDownloadable: true,
        subtitles: cand.subtitles,
      });
    })
  );

  // Optional Vyla Gateway probe if user configured a Vyla base URL in Settings
  if (vylaBaseUrl && /^https?:\/\//i.test(vylaBaseUrl.trim())) {
    const vylaStart = Date.now();
    try {
      const cleanVyla = vylaBaseUrl.trim().replace(/\/+$/, '');
      const sseEndpoint =
        mediaType === 'tv' && season && episode
          ? `${cleanVyla}/tv?id=${tmdbId}&season=${season}&episode=${episode}`
          : `${cleanVyla}/movie?id=${tmdbId}`;
      const res = await fetch(sseEndpoint, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const body = await res.text();
        let added = 0;
        for (const line of body.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (evt.type === 'source' && evt.directUrl) {
              const sType: 'hls' | 'mp4' = evt.streamType === 'mp4' ? 'mp4' : 'hls';
              const ref = evt.headers?.Referer || evt.headers?.referer;
              const ori = evt.headers?.Origin || evt.headers?.origin;
              verifiedSources.push({
                id: `vyla_${added}_${evt.source || 'src'}`,
                provider: 'vyla',
                serverName: `Vyla (${evt.label || evt.source || 'Gateway'})`,
                label: `Vyla • ${evt.label || evt.source} ${evt.quality || ''}`.trim(),
                quality: evt.quality || 'HD',
                height: parseHeightFromQuality(evt.quality || '720p'),
                language: 'English',
                streamType: sType,
                directUrl: evt.directUrl,
                proxyUrl: buildProxyUrl(evt.directUrl, originBase, sType === 'hls' ? '/api/m3u8-proxy' : '/api/proxy', {
                  referer: ref,
                  origin: ori,
                }),
                downloadProxyUrl: buildDownloadEndpointUrl({
                  targetRawUrl: evt.directUrl,
                  originBase,
                  streamType: sType,
                  filename: defaultFilename,
                  referer: ref,
                  origin: ori,
                }),
                headers: evt.headers || {},
                verified: true,
                isDownloadable: true,
                subtitles: [],
              });
              added++;
            }
          } catch {
            // Skip malformed SSE line
          }
        }
        diagnostics.push({
          provider: 'Vyla Gateway',
          status: added > 0 ? 'ok' : 'empty',
          count: added,
          elapsedMs: Date.now() - vylaStart,
        });
      }
    } catch (err) {
      diagnostics.push({
        provider: 'Vyla Gateway',
        status: 'error',
        count: 0,
        detail: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - vylaStart,
      });
    }
  }

  // Sort by preferred provider (if set), browser-compatible HLS/MP4 ahead of MKV, English priority, then quality
  verifiedSources.sort((a, b) => {
    const aMkv = /\.mkv(\?|$)/i.test(a.directUrl) ? 1 : 0;
    const bMkv = /\.mkv(\?|$)/i.test(b.directUrl) ? 1 : 0;
    if (aMkv !== bMkv) return aMkv - bMkv;

    if (preferredProvider === 'x8rr' && a.provider !== b.provider) {
      if (a.provider === 'x8rr') return -1;
      if (b.provider === 'x8rr') return 1;
    } else if (preferredProvider === 'vidzee' && a.provider !== b.provider) {
      if (a.provider === 'vidzee') return -1;
      if (b.provider === 'vidzee') return 1;
    }
    const aEn = /eng|multi|auto/i.test(a.language) ? 1 : 0;
    const bEn = /eng|multi|auto/i.test(b.language) ? 1 : 0;
    if (bEn !== aEn) return bEn - aEn;
    if (b.height !== a.height) return b.height - a.height;
    if (a.provider !== b.provider) {
      if (a.provider === 'vidzee') return -1;
      if (b.provider === 'vidzee') return 1;
    }
    return 0;
  });

  const result: StreamResolutionResult = {
    sources: verifiedSources,
    subtitles: allSubtitles,
    diagnostics,
  };
  if (verifiedSources.length > 0) {
    streamCache.set(cacheKey, result);
  }
  return result;
}

export async function probeVidZeeHealth(): Promise<{ ok: boolean; status: number; detail: string; elapsedMs: number }> {
  const started = Date.now();
  try {
    // Probe Inception (TMDB 27205) on peak
    const res = await fetch('https://core.vidzee.wtf/streams/movie/27205?s=peak&e=0', {
      headers: VIDZEE_HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    return {
      ok: res.ok,
      status: res.status,
      detail: res.ok ? 'VidZee core API reachable' : `HTTP ${res.status}`,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      detail: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - started,
    };
  }
}
