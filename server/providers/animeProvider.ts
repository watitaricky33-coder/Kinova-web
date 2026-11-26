import * as cheerio from 'cheerio';
import {
  TtlLruCache,
  buildDownloadEndpointUrl,
  buildProxyUrl,
  verifyPlayableCandidate,
} from '../proxyEngine.js';
import type { ResolvedStreamSource, ResolvedSubtitleTrack } from './vidzeeProvider.js';

export interface AnimeSearchItem {
  id: string;
  title: string;
  posterUrl: string;
  episodesCount: string;
  isDub: boolean;
  url: string;
  anilistId?: number;
  synopsis?: string;
  releaseYear?: number;
  genres?: string[];
  rating?: number;
  totalEpisodes?: number;
}

export interface AnimeDetail {
  id: string;
  title: string;
  synopsis: string;
  posterUrl: string;
  genres: string[];
  releaseYear: number;
  status: string;
  isDub: boolean;
  totalEpisodes: number;
  episodes: Array<{
    number: number;
    id: string;
    title: string;
  }>;
}

const ANIME_BASE_URL = (process.env.ANIME123_BASE_URL || 'https://123anime.la').replace(/\/+$/, '');
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const animeSearchCache = new TtlLruCache<AnimeSearchItem[]>(300, 300_000);
const animeDetailCache = new TtlLruCache<AnimeDetail>(300, 300_000);
const animeStreamCache = new TtlLruCache<{
  sources: ResolvedStreamSource[];
  subtitles: ResolvedSubtitleTrack[];
  intro?: { start: number; end: number } | null;
  outro?: { start: number; end: number } | null;
}>(400, 180_000);

function padEpisode(ep: number | string): string {
  const n = Number(ep);
  if (Number.isFinite(n) && n < 10) return `0${n}`;
  return String(ep);
}

function getSlugFromHref(href: string): string {
  const clean = href.split('?')[0].replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

async function fetchHtml(url: string, headers: Record<string, string> = {}, timeoutMs = 4500): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': DEFAULT_UA,
        Referer: `${ANIME_BASE_URL}/`,
        ...headers,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function queryAniList(keyword?: string): Promise<AnimeSearchItem[]> {
  try {
    const queryStr = keyword
      ? `query ($search: String) {
          Page(perPage: 18) {
            media(type: ANIME, search: $search, sort: POPULARITY_DESC) {
              id
              title { romaji english }
              description(asHtml: false)
              episodes
              seasonYear
              averageScore
              genres
              coverImage { large extraLarge }
            }
          }
        }`
      : `query {
          Page(perPage: 18) {
            media(type: ANIME, sort: POPULARITY_DESC) {
              id
              title { romaji english }
              description(asHtml: false)
              episodes
              seasonYear
              averageScore
              genres
              coverImage { large extraLarge }
            }
          }
        }`;

    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: queryStr, variables: keyword ? { search: keyword } : {} }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: {
        Page?: {
          media?: Array<{
            id: number;
            title?: { romaji?: string; english?: string };
            description?: string;
            episodes?: number;
            seasonYear?: number;
            averageScore?: number;
            genres?: string[];
            coverImage?: { large?: string; extraLarge?: string };
          }>;
        };
      };
    };
    const list = json.data?.Page?.media || [];
    return list
      .map((m) => {
        const title = String(m.title?.english || m.title?.romaji || '').trim();
        if (!title) return null;
        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        return {
          id: `al_${m.id}_${slug}`,
          anilistId: m.id,
          title,
          posterUrl: m.coverImage?.extraLarge || m.coverImage?.large || '',
          episodesCount: m.episodes ? `${m.episodes} eps` : 'Series',
          totalEpisodes: m.episodes || 12,
          isDub: false,
          url: `${ANIME_BASE_URL}/anime/${slug}`,
          synopsis: String(m.description || '').replace(/<[^>]+>/g, '').trim(),
          releaseYear: m.seasonYear || 2024,
          genres: m.genres && m.genres.length > 0 ? m.genres : ['Anime'],
          rating: m.averageScore ? Number((m.averageScore / 10).toFixed(1)) : 8.2,
        } as AnimeSearchItem;
      })
      .filter((x): x is AnimeSearchItem => Boolean(x));
  } catch {
    return [];
  }
}

// Ported directly from mdtahseen7/123anime-api/scrapeanime/Browse/Search/search.js with AniList GraphQL fallback
export async function searchAnime123(keyword: string): Promise<AnimeSearchItem[]> {
  const q = keyword.trim();
  if (!q) return [];
  const cacheKey = `search:${q.toLowerCase()}`;
  const cached = animeSearchCache.get(cacheKey);
  if (cached) return cached;

  const results: AnimeSearchItem[] = [];
  try {
    const html = await fetchHtml(`${ANIME_BASE_URL}/search?keyword=${encodeURIComponent(q)}`);
    const $ = cheerio.load(html);
    $('.film-list .item').each((_, el) => {
      const link = $(el).find('a.name').first();
      const href = link.attr('href') || '';
      const id = getSlugFromHref(href);
      const title = link.text().trim();
      const posterUrl =
        $(el).find('img').attr('data-src') ||
        $(el).find('img').attr('src') ||
        '';
      const epsText = $(el).find('.status .ep, .ep').text().trim();
      const isDub = /\bdub\b/i.test(title) || /\bdub\b/i.test($(el).text());
      if (id && title) {
        results.push({
          id,
          title,
          posterUrl: posterUrl.startsWith('//') ? `https:${posterUrl}` : posterUrl,
          episodesCount: epsText || 'Series',
          isDub,
          url: href.startsWith('http') ? href : `${ANIME_BASE_URL}${href}`,
        });
      }
    });
  } catch {
    // 123anime.la unavailable — fall through to AniList GraphQL
  }

  if (results.length === 0) {
    const anilist = await queryAniList(q);
    results.push(...anilist);
  }

  if (results.length > 0) {
    animeSearchCache.set(cacheKey, results);
  }
  return results;
}

export async function getPopularAnime123(): Promise<AnimeSearchItem[]> {
  const cached = animeSearchCache.get('popular:home');
  if (cached) return cached;

  const results: AnimeSearchItem[] = [];
  try {
    const html = await fetchHtml(`${ANIME_BASE_URL}/anime`);
    const $ = cheerio.load(html);
    $('.film-list .item').each((_, el) => {
      const link = $(el).find('a.name').first();
      const href = link.attr('href') || '';
      const id = getSlugFromHref(href);
      const title = link.text().trim();
      const posterUrl =
        $(el).find('img').attr('data-src') ||
        $(el).find('img').attr('src') ||
        '';
      const epsText = $(el).find('.status .ep, .ep').text().trim();
      const isDub = /\bdub\b/i.test(title);
      if (id && title) {
        results.push({
          id,
          title,
          posterUrl: posterUrl.startsWith('//') ? `https:${posterUrl}` : posterUrl,
          episodesCount: epsText || 'HD',
          isDub,
          url: href.startsWith('http') ? href : `${ANIME_BASE_URL}${href}`,
        });
      }
    });
  } catch {
    // Fall back cleanly to AniList GraphQL
  }

  if (results.length === 0) {
    const anilist = await queryAniList();
    results.push(...anilist);
  }

  if (results.length > 0) {
    animeSearchCache.set('popular:home', results);
  }
  return results;
}

export async function getAnimeDetails123(animeId: string): Promise<AnimeDetail | null> {
  const cleanId = animeId.trim();
  if (!cleanId) return null;
  const cached = animeDetailCache.get(cleanId);
  if (cached) return cached;

  // Handle AniList ID format `al_{id}_{slug}` directly
  const alMatch = cleanId.match(/^al_(\d+)_/);
  if (alMatch) {
    try {
      const alId = Number(alMatch[1]);
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query ($id: Int) {
            Media(id: $id, type: ANIME) {
              id
              title { romaji english }
              description(asHtml: false)
              episodes
              seasonYear
              status
              genres
              coverImage { large extraLarge }
            }
          }`,
          variables: { id: alId },
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: {
            Media?: {
              title?: { romaji?: string; english?: string };
              description?: string;
              episodes?: number;
              seasonYear?: number;
              status?: string;
              genres?: string[];
              coverImage?: { large?: string; extraLarge?: string };
            };
          };
        };
        const m = json.data?.Media;
        if (m) {
          const total = Math.min(m.episodes || 12, 100);
          const title = String(m.title?.english || m.title?.romaji || cleanId);
          const detail: AnimeDetail = {
            id: cleanId,
            title,
            synopsis: String(m.description || 'Streaming on KINOVA Anime.').replace(/<[^>]+>/g, '').trim(),
            posterUrl: m.coverImage?.extraLarge || m.coverImage?.large || '',
            genres: m.genres && m.genres.length > 0 ? ['Anime', ...m.genres] : ['Anime'],
            releaseYear: m.seasonYear || 2024,
            status: m.status || 'Available',
            isDub: false,
            totalEpisodes: m.episodes || total,
            episodes: Array.from({ length: total }, (_, idx) => ({
              number: idx + 1,
              id: `${cleanId}-ep-${idx + 1}`,
              title: `Episode ${idx + 1}`,
            })),
          };
          animeDetailCache.set(cleanId, detail);
          return detail;
        }
      }
    } catch {
      // Continue below
    }
  }

  try {
    const html = await fetchHtml(`${ANIME_BASE_URL}/anime/${encodeURIComponent(cleanId)}`);
    const $ = cheerio.load(html);
    const title = $('h1.title, .info h1, .heading-name').first().text().trim() || cleanId;
    const synopsis = $('.desc, .shorting, .description').first().text().trim() || 'Streaming on KINOVA Anime.';
    const posterUrl = $('.thumb img, .poster img').first().attr('src') || '';
    const genres: string[] = [];
    $('.meta a[href*="/genre/"]').each((_, el) => {
      const g = $(el).text().trim();
      if (g) genres.push(g);
    });

    const episodes: AnimeDetail['episodes'] = [];
    $('.episodes a, .ep-range a, ul.episodes li a').each((_, el) => {
      const epText = $(el).text().trim();
      const numMatch = epText.match(/\d+/);
      const epNum = numMatch ? Number(numMatch[0]) : episodes.length + 1;
      episodes.push({
        number: epNum,
        id: `${cleanId}-ep-${epNum}`,
        title: `Episode ${epNum}`,
      });
    });

    const dedupEps = Array.from(new Map(episodes.map((e) => [e.number, e])).values()).sort(
      (a, b) => a.number - b.number
    );
    const detail: AnimeDetail = {
      id: cleanId,
      title,
      synopsis,
      posterUrl: posterUrl.startsWith('//') ? `https:${posterUrl}` : posterUrl,
      genres: genres.length > 0 ? genres : ['Anime'],
      releaseYear: 2024,
      status: 'Available',
      isDub: /\bdub\b/i.test(cleanId) || /\bdub\b/i.test(title),
      totalEpisodes: dedupEps.length || 12,
      episodes:
        dedupEps.length > 0
          ? dedupEps
          : Array.from({ length: 12 }, (_, idx) => ({
              number: idx + 1,
              id: `${cleanId}-ep-${idx + 1}`,
              title: `Episode ${idx + 1}`,
            })),
    };
    animeDetailCache.set(cleanId, detail);
    return detail;
  } catch {
    return null;
  }
}

// Ported directly from mdtahseen7/123anime-api/scrapeanime/SingleEpisode/scrapeSingleEpisode.js
export async function resolveAnimeEpisode123(params: {
  animeId: string;
  episode: number;
  originBase: string;
  preferDub?: boolean;
}): Promise<{
  sources: ResolvedStreamSource[];
  subtitles: ResolvedSubtitleTrack[];
  intro?: { start: number; end: number } | null;
  outro?: { start: number; end: number } | null;
}> {
  const { animeId, episode, originBase, preferDub = false } = params;
  const cleanSlug = animeId.replace(/^al_\d+_/, '');
  const candidateIds = preferDub && !cleanSlug.endsWith('-dub')
    ? [`${cleanSlug}-dub`, cleanSlug]
    : [cleanSlug, `${cleanSlug}-dub`];

  for (const slug of candidateIds) {
    const cacheKey = `ep:${slug}:${episode}:${originBase}`;
    const cached = animeStreamCache.get(cacheKey);
    if (cached && cached.sources.length > 0) return cached;

    try {
      const padded = padEpisode(episode);
      const episodeReferer = `${ANIME_BASE_URL}/anime/${encodeURIComponent(slug)}/episode/${padded}`;
      const epr = encodeURIComponent(`${slug}/${episode}/vidstreaming.io`);
      const infoUrl = `${ANIME_BASE_URL}/ajax/episode/info?epr=${epr}&ts=001`;

      const infoRes = await fetch(infoUrl, {
        headers: {
          'User-Agent': DEFAULT_UA,
          'X-Requested-With': 'XMLHttpRequest',
          Referer: episodeReferer,
        },
        signal: AbortSignal.timeout(4500),
      });
      if (!infoRes.ok) continue;

      const infoJson = (await infoRes.json()) as { target?: string; url?: string };
      const targetEmbed = String(infoJson?.target || infoJson?.url || '').trim();
      if (!targetEmbed) continue;

      const embedHtml = await fetchHtml(targetEmbed, { Referer: `${ANIME_BASE_URL}/` }, 5000);
      const zrMatch = embedHtml.match(/var\s+zrpart2\s*=\s*['"]([^'"]+)['"]/i);
      const embedOrigin = new URL(targetEmbed).origin;
      let getSourcesJson: Record<string, unknown> | null = null;

      if (zrMatch?.[1]) {
        const hsHtml = await fetchHtml(`${embedOrigin}/hs/${zrMatch[1]}`, { Referer: targetEmbed }, 5000);
        const dataIdMatch = hsHtml.match(/data-id\s*=\s*["']([^"']+)["']/i);
        if (dataIdMatch?.[1]) {
          const srcRes = await fetch(
            `${embedOrigin}/hs/getSources?id=${encodeURIComponent(dataIdMatch[1])}`,
            {
              headers: {
                'User-Agent': DEFAULT_UA,
                Referer: `${embedOrigin}/hs/${zrMatch[1]}`,
                'X-Requested-With': 'XMLHttpRequest',
              },
              signal: AbortSignal.timeout(5000),
            }
          );
          if (srcRes.ok) {
            getSourcesJson = (await srcRes.json()) as Record<string, unknown>;
          }
        }
      }

      const rawSources: Array<{ file: string; label?: string }> = [];
      if (getSourcesJson && Array.isArray(getSourcesJson.sources)) {
        for (const s of getSourcesJson.sources) {
          if (s && typeof s === 'object' && typeof (s as Record<string, unknown>).file === 'string') {
            rawSources.push({
              file: String((s as Record<string, unknown>).file),
              label: String((s as Record<string, unknown>).label || 'HD'),
            });
          }
        }
      } else {
        const directM3u8 = embedHtml.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/gi) || [];
        for (const u of directM3u8) rawSources.push({ file: u, label: 'Auto HD' });
      }

      const rawTracks = Array.isArray(getSourcesJson?.tracks)
        ? (getSourcesJson?.tracks as Array<Record<string, unknown>>)
        : [];
      const subtitles: ResolvedSubtitleTrack[] = [];
      for (const tr of rawTracks) {
        const trUrl = String(tr.file || tr.url || '').trim();
        if (!trUrl.startsWith('http') || String(tr.kind || '').toLowerCase() === 'thumbnails') continue;
        const label = String(tr.label || 'English').trim();
        subtitles.push({
          language: label.slice(0, 2).toLowerCase() || 'en',
          label,
          url: trUrl,
          proxyUrl:
            buildProxyUrl(trUrl, originBase, '/api/sub-proxy', {
              referer: `${embedOrigin}/`,
              origin: embedOrigin,
            }) + '&format=vtt',
          format: trUrl.toLowerCase().includes('.srt') ? 'srt' : 'vtt',
        });
      }

      const verified: ResolvedStreamSource[] = [];
      const upHeaders = {
        Referer: `${embedOrigin}/`,
        Origin: embedOrigin,
      };
      for (let i = 0; i < rawSources.length; i++) {
        const src = rawSources[i];
        const probe = await verifyPlayableCandidate(src.file, upHeaders, 4500);
        if (!probe.ok) continue;
        const streamType: 'hls' | 'mp4' = probe.streamType || 'hls';
        verified.push({
          id: `anime123_${slug}_${episode}_${i}`,
          provider: 'anime123',
          serverName: slug.endsWith('-dub') ? '123Anime (Dub)' : '123Anime (Sub)',
          label: `123Anime • ${src.label || 'Auto HD'} (${slug.endsWith('-dub') ? 'Dub' : 'Sub'})`,
          quality: src.label || '1080p HD',
          height: 1080,
          language: slug.endsWith('-dub') ? 'English Dub' : 'Japanese (Sub)',
          streamType,
          directUrl: src.file,
          proxyUrl: buildProxyUrl(
            src.file,
            originBase,
            streamType === 'hls' ? '/api/m3u8-proxy' : '/api/proxy',
            { referer: `${embedOrigin}/`, origin: embedOrigin }
          ),
          downloadProxyUrl: buildDownloadEndpointUrl({
            targetRawUrl: src.file,
            originBase,
            streamType,
            filename: `kinova-anime-${slug}-ep${episode}.mp4`,
            referer: `${embedOrigin}/`,
            origin: embedOrigin,
          }),
          headers: upHeaders,
          verified: true,
          isDownloadable: true,
          subtitles,
        });
      }

      if (verified.length > 0) {
        const out = {
          sources: verified,
          subtitles,
          intro: (getSourcesJson?.intro as { start: number; end: number }) || null,
          outro: (getSourcesJson?.outro as { start: number; end: number }) || null,
        };
        animeStreamCache.set(cacheKey, out);
        return out;
      }
    } catch {
      // Try next slug variant
    }
  }

  return { sources: [], subtitles: [] };
}

export async function probeAnime123Health(): Promise<{
  ok: boolean;
  status: number;
  detail: string;
  elapsedMs: number;
}> {
  const started = Date.now();
  try {
    const res = await fetch(`${ANIME_BASE_URL}/search?keyword=naruto`, {
      headers: { 'User-Agent': DEFAULT_UA },
      signal: AbortSignal.timeout(4000),
    });
    return {
      ok: res.ok,
      status: res.status,
      detail: res.ok ? `123anime (${ANIME_BASE_URL}) reachable` : `HTTP ${res.status}`,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      detail: `${ANIME_BASE_URL} unreachable (${msg}) — AniList discovery fallback active`,
      elapsedMs: Date.now() - started,
    };
  }
}
