import express from 'express';
import {
  buildDownloadEndpointUrl,
  buildProxyUrl,
  buildPublicOrigin,
  handleStreamDownloadRequest,
  handleUnifiedProxyRequest,
  verifyPlayableCandidate,
} from '../proxyEngine.ts';
import {
  probeVidZeeHealth,
  resolveMovieOrTvStreams,
  type ResolvedStreamSource,
  type ResolvedSubtitleTrack,
} from '../providers/vidzeeProvider.ts';
import {
  getAnimeDetails123,
  getPopularAnime123,
  probeAnime123Health,
  resolveAnimeEpisode123,
  searchAnime123,
} from '../providers/animeProvider.ts';
import {
  getHomeDiscovery,
  getMovieDetailsFull,
  getMoviesCatalog,
  getSeriesCatalog,
  getSeriesDetailsFull,
  isTmdbConfigured,
  searchAllCatalog,
} from '../providers/tmdbService.ts';

export function createApiRouter(options: { allowPrivateProxyForTest?: boolean } = {}) {
  const router = express.Router();
  const allowPrivate = Boolean(options.allowPrivateProxyForTest);

  // Unified Node.js HLS/Segment/Subtitle/MP4 Proxy Endpoints (Zero Cloudflare)
  router.all('/proxy', (req, res) => void handleUnifiedProxyRequest(req, res, 'auto', allowPrivate));
  router.all('/m3u8-proxy', (req, res) => void handleUnifiedProxyRequest(req, res, 'm3u8', allowPrivate));
  router.all('/ts-proxy', (req, res) => void handleUnifiedProxyRequest(req, res, 'ts', allowPrivate));
  router.all('/sub-proxy', (req, res) => void handleUnifiedProxyRequest(req, res, 'sub', allowPrivate));
  router.all('/streams/download', (req, res) => void handleStreamDownloadRequest(req, res, allowPrivate));
  router.all('/', (req, res, next) => {
    if (typeof req.query.url === 'string') {
      return void handleUnifiedProxyRequest(req, res, 'auto', allowPrivate);
    }
    next();
  });

  // Health & Live Proxy/Provider Diagnostics
  router.get('/health', async (_req, res) => {
    res.json({
      ok: true,
      service: 'kinova-unified-stream-proxy',
      runtime: 'nodejs-express',
      cloudflareDependency: false,
      tmdbConfigured: isTmdbConfigured(),
      providers: ['vidzee', 'x8rr-multi', '123anime-api', 'streamrelay-proxy', 'hls-rules-proxy'],
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/health/probe', async (_req, res) => {
    const [vidzee, anime123] = await Promise.all([probeVidZeeHealth(), probeAnime123Health()]);
    res.json({
      ok: true,
      tmdbConfigured: isTmdbConfigured(),
      proxyEngine: { ok: true, detail: 'Node.js Express HLS/TS/Range proxy active (no Cloudflare)' },
      vidzee,
      anime123,
      timestamp: new Date().toISOString(),
    });
  });

  // Catalogue & Discovery Routes (TMDB v3 + Public Fallback)
  router.get('/tmdb/home', async (_req, res) => {
    try {
      const data = await getHomeDiscovery();
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Discovery failed' });
    }
  });

  router.get('/tmdb/movies', async (req, res) => {
    try {
      const data = await getMoviesCatalog({
        page: Number(req.query.page || 1),
        genreId: typeof req.query.genre === 'string' ? req.query.genre : undefined,
        year: typeof req.query.year === 'string' ? req.query.year : undefined,
        sortBy: typeof req.query.sort === 'string' ? req.query.sort : undefined,
      });
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Movies catalog failed' });
    }
  });

  router.get('/tmdb/series', async (req, res) => {
    try {
      const data = await getSeriesCatalog({
        page: Number(req.query.page || 1),
        genreId: typeof req.query.genre === 'string' ? req.query.genre : undefined,
        year: typeof req.query.year === 'string' ? req.query.year : undefined,
        sortBy: typeof req.query.sort === 'string' ? req.query.sort : undefined,
        animeOnly: req.query.anime === '1' || req.query.anime === 'true',
      });
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Series catalog failed' });
    }
  });

  router.get('/tmdb/search', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const page = Number(req.query.page || 1);
      const data = await searchAllCatalog(q, page);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Search failed' });
    }
  });

  router.get('/tmdb/movie/:movieId', async (req, res) => {
    try {
      const data = await getMovieDetailsFull(req.params.movieId);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Movie detail failed' });
    }
  });

  router.get('/tmdb/tv/:seriesId', async (req, res) => {
    try {
      const data = await getSeriesDetailsFull(req.params.seriesId);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Series detail failed' });
    }
  });

  // Anime API Routes (mdtahseen7/123anime-api)
  router.get('/anime/popular', async (_req, res) => {
    const items = await getPopularAnime123();
    res.json({ items });
  });

  router.get('/anime/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const items = await searchAnime123(q);
    res.json({ items });
  });

  router.get('/anime/detail/:animeId', async (req, res) => {
    const detail = await getAnimeDetails123(req.params.animeId);
    if (!detail) {
      res.status(404).json({ error: 'Anime series not found' });
      return;
    }
    res.json(detail);
  });

  // Unified Movie Stream Resolution (VidZee + X8RR + Vyla + Archive fallback)
  router.get('/streams/movie/:contentId', async (req, res) => {
    const rawId = req.params.contentId;
    const originBase = req.query.absolute === '1' ? buildPublicOrigin(req) : '';
    const vylaBaseUrl = typeof req.query.vylaUrl === 'string' ? req.query.vylaUrl : '';
    const verifyAll = req.query.verify !== 'false';

    // Handle Internet Archive public domain movies cleanly
    if (rawId.startsWith('ia_movie_')) {
      try {
        const detail = await getMovieDetailsFull(rawId);
        const directUrl = (detail.movie as { directVideoUrl?: string }).directVideoUrl || '';
        const sources: ResolvedStreamSource[] = directUrl
          ? [
              {
                id: `ia_${rawId}`,
                provider: 'archive',
                serverName: 'Internet Archive (Direct MP4)',
                label: 'Internet Archive • HD MP4 (Authorized Downloadable)',
                quality: '720p HD',
                height: 720,
                language: 'English',
                streamType: 'mp4',
                directUrl,
                proxyUrl: buildProxyUrl(directUrl, originBase, '/api/proxy'),
                downloadProxyUrl: buildDownloadEndpointUrl({
                  targetRawUrl: directUrl,
                  originBase,
                  streamType: 'mp4',
                  filename: `kinova-${rawId}.mp4`,
                }),
                headers: {},
                verified: true,
                isDownloadable: true,
                subtitles: [],
              },
            ]
          : [];
        res.json({ sources, subtitles: [], diagnostics: [] });
        return;
      } catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : 'Archive stream failed' });
        return;
      }
    }

    const tmdbId = Number(rawId.replace('tmdb_movie_', ''));
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      res.status(400).json({ error: 'Invalid movie ID' });
      return;
    }

    const preferredProvider =
      typeof req.query.preferredProvider === 'string' ? req.query.preferredProvider : 'auto';
    const result = await resolveMovieOrTvStreams({
      mediaType: 'movie',
      tmdbId,
      originBase,
      vylaBaseUrl,
      preferredProvider,
      verifyAll,
    });
    res.json(result);
  });

  // Unified TV & Anime Series Episode Stream Resolution
  router.get('/streams/tv/:contentId/:season/:episode', async (req, res) => {
    const rawId = req.params.contentId;
    const season = Number(req.params.season || 1);
    const episode = Number(req.params.episode || 1);
    const titleHint = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    const isAnimeHint = req.query.anime === '1' || req.query.anime === 'true' || rawId.startsWith('anime_');
    const preferDub = req.query.dub === '1' || req.query.dub === 'true';
    const animeFallback = req.query.animeFallback !== 'false';
    const vylaBaseUrl = typeof req.query.vylaUrl === 'string' ? req.query.vylaUrl : '';
    const originBase = req.query.absolute === '1' ? buildPublicOrigin(req) : '';

    const sources: ResolvedStreamSource[] = [];
    const subtitles: ResolvedSubtitleTrack[] = [];
    const diagnostics: Array<Record<string, unknown>> = [];

    // If explicitly an anime slug from 123anime or flagged as anime, query 123anime-api directly
    if (rawId.startsWith('anime_') || (isAnimeHint && titleHint)) {
      const aStart = Date.now();
      let slug = rawId.startsWith('anime_') ? rawId.replace(/^anime_/, '') : '';
      if (!slug && titleHint) {
        const hits = await searchAnime123(titleHint);
        const match = preferDub ? hits.find((h) => h.isDub) || hits[0] : hits.find((h) => !h.isDub) || hits[0];
        if (match) slug = match.id;
      }
      if (slug) {
        const animeRes = await resolveAnimeEpisode123({
          animeId: slug,
          episode,
          originBase,
          preferDub,
        });
        sources.push(...animeRes.sources);
        subtitles.push(...animeRes.subtitles);
        diagnostics.push({
          provider: '123Anime API',
          status: animeRes.sources.length > 0 ? 'ok' : 'empty',
          count: animeRes.sources.length,
          elapsedMs: Date.now() - aStart,
        });
      }
    }

    const preferredProvider =
      typeof req.query.preferredProvider === 'string' ? req.query.preferredProvider : 'auto';

    // Query VidZee + X8RR + Vyla for TMDB series (directly, or by resolving title -> TMDB ID when anime/tvmaze fallback needed)
    let tmdbTvId: number | null = null;
    const tmdbMatch = rawId.match(/^(?:tmdb_tv_)?(\d+)$/);
    if (tmdbMatch) {
      tmdbTvId = Number(tmdbMatch[1]);
    } else if (sources.length === 0 && titleHint && isTmdbConfigured()) {
      try {
        const searchRes = await searchAllCatalog(titleHint, 1);
        const topSeries = searchRes.series?.[0];
        if (topSeries?.externalId && /^\d+$/.test(topSeries.externalId)) {
          tmdbTvId = Number(topSeries.externalId);
        }
      } catch {
        tmdbTvId = null;
      }
    }

    if (tmdbTvId && (sources.length === 0 || animeFallback || !isAnimeHint)) {
      const tvRes = await resolveMovieOrTvStreams({
        mediaType: 'tv',
        tmdbId: tmdbTvId,
        season,
        episode,
        originBase,
        vylaBaseUrl,
        preferredProvider,
        verifyAll: req.query.verify !== 'false',
      });
      sources.push(...tvRes.sources);
      for (const s of tvRes.subtitles) {
        if (!subtitles.some((x) => x.url === s.url)) subtitles.push(s);
      }
      diagnostics.push(...tvRes.diagnostics);
    }

    // If non-anime TMDB still returned 0 sources and titleHint matches 123anime, try 123anime fallback
    if (sources.length === 0 && titleHint && !rawId.startsWith('anime_') && animeFallback) {
      const hits = await searchAnime123(titleHint);
      if (hits[0]) {
        const animeRes = await resolveAnimeEpisode123({
          animeId: hits[0].id,
          episode,
          originBase,
          preferDub,
        });
        sources.push(...animeRes.sources);
        subtitles.push(...animeRes.subtitles);
      }
    }

    res.json({ sources, subtitles, diagnostics });
  });

  // Verify arbitrary stream URL through proxy checker
  router.get('/streams/verify', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const check = await verifyPlayableCandidate(rawUrl);
    res.json(check);
  });

  return router;
}
