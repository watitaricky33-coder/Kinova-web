import { TtlLruCache } from '../proxyEngine.js';
import { getPopularAnime123, searchAnime123 } from './animeProvider.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

const MOVIE_GENRE_MAP: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
};

const TV_GENRE_MAP: Record<number, string> = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  10762: 'Kids',
  9648: 'Mystery',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
  37: 'Western',
};

const cache = new TtlLruCache<unknown>(800, 600_000);

function getTmdbKey(): string {
  return String(process.env.TMDB_API_KEY || '').trim();
}

export function isTmdbConfigured(): boolean {
  return Boolean(getTmdbKey());
}

async function tmdbFetch<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const apiKey = getTmdbKey();
  if (!apiKey) {
    throw new Error('TMDB_API_KEY is not configured');
  }
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const key = `tmdb:${url.pathname}?${url.searchParams.toString()}`;
  const cached = cache.get(key);
  if (cached) return cached as T;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`TMDB HTTP ${res.status}`);
    }
    const json = (await res.json()) as T;
    cache.set(key, json);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function parseYear(dateStr?: string | null): number {
  if (!dateStr) return 0;
  const m = String(dateStr).match(/^(\d{4})/);
  return m ? Number(m[1]) : 0;
}

export function mapTmdbMovie(raw: Record<string, unknown>) {
  const idNum = Number(raw.id || 0);
  const genreIds = Array.isArray(raw.genre_ids) ? (raw.genre_ids as number[]) : [];
  const genresObj = Array.isArray(raw.genres) ? (raw.genres as Array<{ id: number; name: string }>) : [];
  const genres =
    genresObj.length > 0
      ? genresObj.map((g) => g.name)
      : genreIds.map((gid) => MOVIE_GENRE_MAP[gid]).filter(Boolean);
  const posterPath = typeof raw.poster_path === 'string' ? raw.poster_path : '';
  const backdropPath = typeof raw.backdrop_path === 'string' ? raw.backdrop_path : '';
  const lang = String(raw.original_language || 'en').toUpperCase();

  return {
    id: `tmdb_movie_${idNum}`,
    externalId: String(idNum),
    providerId: 'tmdb',
    title: String(raw.title || raw.original_title || `Movie #${idNum}`),
    originalTitle: String(raw.original_title || raw.title || ''),
    synopsis: String(raw.overview || 'Stream in HD on KINOVA.'),
    releaseYear: parseYear(raw.release_date as string),
    genres: genres.length > 0 ? genres : ['Cinema'],
    runtimeSeconds: Number(raw.runtime || 0) * 60,
    language: lang === 'EN' ? 'English' : lang,
    country: 'International',
    posterUrl: posterPath ? `${TMDB_IMG}/w500${posterPath}` : '',
    backdropUrl: backdropPath ? `${TMDB_IMG}/w1280${backdropPath}` : posterPath ? `${TMDB_IMG}/w780${posterPath}` : '',
    thumbnailUrl: posterPath ? `${TMDB_IMG}/w342${posterPath}` : '',
    rating: Number(raw.vote_average || 0),
    trendingScore: Math.round(Number(raw.popularity || 0)),
    isPlayable: true,
    mediaType: 'movie' as const,
  };
}

export function mapTmdbSeries(raw: Record<string, unknown>) {
  const idNum = Number(raw.id || 0);
  const genreIds = Array.isArray(raw.genre_ids) ? (raw.genre_ids as number[]) : [];
  const genresObj = Array.isArray(raw.genres) ? (raw.genres as Array<{ id: number; name: string }>) : [];
  const genres =
    genresObj.length > 0
      ? genresObj.map((g) => g.name)
      : genreIds.map((gid) => TV_GENRE_MAP[gid]).filter(Boolean);
  const posterPath = typeof raw.poster_path === 'string' ? raw.poster_path : '';
  const backdropPath = typeof raw.backdrop_path === 'string' ? raw.backdrop_path : '';
  const originCountry = Array.isArray(raw.origin_country) ? (raw.origin_country as string[]) : [];
  const isAnime =
    genres.some((g) => g.toLowerCase() === 'animation') &&
    (String(raw.original_language || '').toLowerCase() === 'ja' || originCountry.includes('JP'));

  return {
    id: `tmdb_tv_${idNum}`,
    externalId: String(idNum),
    providerId: isAnime ? 'anime' : 'tmdb',
    title: String(raw.name || raw.original_name || `Series #${idNum}`),
    synopsis: String(raw.overview || 'Watch episodes on KINOVA.'),
    releaseYear: parseYear(raw.first_air_date as string),
    genres: isAnime && !genres.includes('Anime') ? ['Anime', ...genres] : genres.length > 0 ? genres : ['Series'],
    language: String(raw.original_language || 'en').toUpperCase() === 'JA' ? 'Japanese' : 'English',
    country: originCountry[0] || 'International',
    posterUrl: posterPath ? `${TMDB_IMG}/w500${posterPath}` : '',
    backdropUrl: backdropPath ? `${TMDB_IMG}/w1280${backdropPath}` : posterPath ? `${TMDB_IMG}/w780${posterPath}` : '',
    thumbnailUrl: posterPath ? `${TMDB_IMG}/w342${posterPath}` : '',
    seasonCount: Number(raw.number_of_seasons || 1),
    episodeCount: Number(raw.number_of_episodes || 1),
    rating: Number(raw.vote_average || 0),
    trendingScore: Math.round(Number(raw.popularity || 0)),
    isAnime,
    isPlayable: true,
    mediaType: 'tv' as const,
  };
}

// Keyless real public catalog fallback (Internet Archive public-domain feature films + TVMaze + Jikan/123Anime)
async function buildPublicFallbackDiscovery() {
  const cached = cache.get('fallback:home');
  if (cached) return cached;

  const [iaRes, tvRes, animeList] = await Promise.allSettled([
    fetch(
      'https://archive.org/advancedsearch.php?q=mediatype%3Amovies+AND+collection%3Afeature_films+AND+format%3A%22MPEG4%22&fl[]=identifier,title,description,year,subject,downloads&sort[]=downloads+desc&rows=20&output=json'
    ).then((r) => r.json()),
    fetch('https://api.tvmaze.com/shows?page=0').then((r) => r.json()),
    getPopularAnime123(),
  ]);

  const movies: ReturnType<typeof mapTmdbMovie>[] = [];
  if (iaRes.status === 'fulfilled') {
    const docs = ((iaRes.value as { response?: { docs?: Array<Record<string, unknown>> } })?.response?.docs || []);
    for (const d of docs) {
      const ident = String(d.identifier || '').trim();
      const title = String(d.title || ident).trim();
      if (!ident) continue;
      const subj = Array.isArray(d.subject)
        ? (d.subject as string[]).slice(0, 3)
        : typeof d.subject === 'string'
          ? d.subject.split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 3)
          : ['Classic Cinema'];
      movies.push({
        id: `ia_movie_${ident}`,
        externalId: ident,
        providerId: 'archive',
        title,
        originalTitle: title,
        synopsis: String(d.description || 'Public domain classic film on Internet Archive.'),
        releaseYear: Number(d.year || 1960) || 1960,
        genres: subj.length > 0 ? subj : ['Classic Cinema'],
        runtimeSeconds: 5400,
        language: 'English',
        country: 'International',
        posterUrl: `https://archive.org/services/img/${encodeURIComponent(ident)}`,
        backdropUrl: `https://archive.org/services/img/${encodeURIComponent(ident)}`,
        thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(ident)}`,
        rating: 7.4,
        trendingScore: Number(d.downloads || 100),
        isPlayable: true,
        mediaType: 'movie',
      });
    }
  }

  const series: ReturnType<typeof mapTmdbSeries>[] = [];
  if (tvRes.status === 'fulfilled' && Array.isArray(tvRes.value)) {
    for (const s of (tvRes.value as Array<Record<string, unknown>>).slice(0, 20)) {
      const img = s.image as { medium?: string; original?: string } | undefined;
      const summary = String(s.summary || '').replace(/<[^>]+>/g, '').trim();
      const rating = (s.rating as { average?: number } | undefined)?.average || 7.5;
      series.push({
        id: `tvmaze_${s.id}`,
        externalId: String(s.id),
        providerId: 'tvmaze',
        title: String(s.name || 'Series'),
        synopsis: summary || 'Featured television series.',
        releaseYear: parseYear(s.premiered as string),
        genres: Array.isArray(s.genres) && s.genres.length > 0 ? (s.genres as string[]) : ['Drama'],
        language: String(s.language || 'English'),
        country: 'International',
        posterUrl: img?.medium || img?.original || '',
        backdropUrl: img?.original || img?.medium || '',
        thumbnailUrl: img?.medium || '',
        seasonCount: 1,
        episodeCount: 12,
        rating: Number(rating),
        trendingScore: Number(s.weight || 80),
        isAnime: false,
        isPlayable: true,
        mediaType: 'tv',
      });
    }
  }

  const anime =
    animeList.status === 'fulfilled'
      ? animeList.value.map((a) => ({
          id: `anime_${a.id}`,
          externalId: a.id,
          providerId: '123anime',
          title: a.title,
          synopsis: `${a.title} — ${a.episodesCount} (${a.isDub ? 'English Dub' : 'Subbed'}). Stream via KINOVA Anime engine.`,
          releaseYear: 2024,
          genres: ['Anime', 'Animation'],
          language: a.isDub ? 'English Dub' : 'Japanese (Sub)',
          country: 'JP',
          posterUrl: a.posterUrl,
          backdropUrl: a.posterUrl,
          thumbnailUrl: a.posterUrl,
          seasonCount: 1,
          episodeCount: Number(String(a.episodesCount).replace(/[^0-9]/g, '')) || 12,
          rating: 8.3,
          trendingScore: 100,
          isAnime: true,
          isPlayable: true,
          mediaType: 'tv' as const,
        }))
      : [];

  const payload = {
    tmdbConfigured: false,
    trendingMovies: movies.slice(0, 12),
    latestMovieReleases: movies.slice(4, 16),
    popularMovies: movies,
    popularSeries: series,
    trendingSeries: series.slice(0, 12),
    latestTvReleases: series.slice(6, 18),
    popularAnime: anime,
    actionMovies: movies.slice(0, 8),
    comedyMovies: movies.slice(3, 11),
    romanceMovies: movies.slice(5, 13),
    thrillerMovies: movies.slice(2, 10),
    horrorMovies: movies.slice(6, 14),
    africanCinema: [],
    nollywood: [],
    bollywood: [],
    recommendedMovies: movies.slice(0, 10),
  };

  cache.set('fallback:home', payload, 300_000);
  return payload;
}

export async function getHomeDiscovery() {
  if (!isTmdbConfigured()) {
    return await buildPublicFallbackDiscovery();
  }

  const cached = cache.get('tmdb:home_bundle');
  if (cached) return cached;

  const [
    trendingMov,
    nowPlaying,
    popularMov,
    popularTv,
    trendingTv,
    onAirTv,
    animeTv,
    actionMov,
    comedyMov,
    romanceMov,
    thrillerMov,
    horrorMov,
    africanMov,
    nollywoodMov,
    bollywoodMov,
    topRatedMov,
  ] = await Promise.allSettled([
    tmdbFetch<{ results: Record<string, unknown>[] }>('/trending/movie/week', { page: 1 }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/movie/now_playing', { page: 1 }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/movie/popular', { page: 1 }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/tv/popular', { page: 1 }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/trending/tv/week', { page: 1 }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/tv/on_the_air', { page: 1 }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/tv', {
      with_genres: '16',
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      page: 1,
    }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', { with_genres: '28', page: 1 }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', { with_genres: '35', page: 1 }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', { with_genres: '10749', page: 1 }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', { with_genres: '53', page: 1 }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', { with_genres: '27', page: 1 }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', {
      with_origin_country: 'KE|NG|ZA|GH',
      sort_by: 'popularity.desc',
      page: 1,
    }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', {
      with_origin_country: 'NG',
      sort_by: 'popularity.desc',
      page: 1,
    }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/discover/movie', {
      with_origin_country: 'IN',
      with_original_language: 'hi',
      sort_by: 'popularity.desc',
      page: 1,
    }),
    tmdbFetch<{ results: Record<string, unknown>[] }>('/movie/top_rated', { page: 1 }),
  ]);

  const mapM = (r: PromiseSettledResult<{ results: Record<string, unknown>[] }>) =>
    r.status === 'fulfilled' ? (r.value.results || []).map(mapTmdbMovie) : [];
  const mapS = (r: PromiseSettledResult<{ results: Record<string, unknown>[] }>) =>
    r.status === 'fulfilled' ? (r.value.results || []).map(mapTmdbSeries) : [];

  const bundle = {
    tmdbConfigured: true,
    trendingMovies: mapM(trendingMov),
    latestMovieReleases: mapM(nowPlaying),
    popularMovies: mapM(popularMov),
    popularSeries: mapS(popularTv),
    trendingSeries: mapS(trendingTv),
    latestTvReleases: mapS(onAirTv),
    popularAnime: mapS(animeTv),
    actionMovies: mapM(actionMov),
    comedyMovies: mapM(comedyMov),
    romanceMovies: mapM(romanceMov),
    thrillerMovies: mapM(thrillerMov),
    horrorMovies: mapM(horrorMov),
    africanCinema: mapM(africanMov),
    nollywood: mapM(nollywoodMov),
    bollywood: mapM(bollywoodMov),
    recommendedMovies: mapM(topRatedMov),
  };

  cache.set('tmdb:home_bundle', bundle, 300_000);
  return bundle;
}

export async function getMoviesCatalog(params: {
  page?: number;
  genreId?: string;
  year?: string;
  sortBy?: string;
}) {
  const page = Math.max(1, Number(params.page || 1));
  if (!isTmdbConfigured()) {
    const fb = (await buildPublicFallbackDiscovery()) as { popularMovies: ReturnType<typeof mapTmdbMovie>[] };
    return { items: fb.popularMovies, page: 1, totalPages: 1, totalResults: fb.popularMovies.length };
  }
  const query: Record<string, string | number> = {
    page,
    sort_by: params.sortBy || 'popularity.desc',
  };
  if (params.genreId && params.genreId !== 'all') query.with_genres = params.genreId;
  if (params.year && params.year !== 'all') query.primary_release_year = params.year;

  const endpoint = params.genreId || params.year || params.sortBy ? '/discover/movie' : '/movie/popular';
  const dto = await tmdbFetch<{
    results: Record<string, unknown>[];
    page: number;
    total_pages: number;
    total_results: number;
  }>(endpoint, query);

  return {
    items: (dto.results || []).map(mapTmdbMovie),
    page: dto.page || page,
    totalPages: Math.min(dto.total_pages || 1, 500),
    totalResults: dto.total_results || 0,
  };
}

export async function getSeriesCatalog(params: {
  page?: number;
  genreId?: string;
  year?: string;
  sortBy?: string;
  animeOnly?: boolean;
}) {
  const page = Math.max(1, Number(params.page || 1));
  if (!isTmdbConfigured()) {
    const fb = (await buildPublicFallbackDiscovery()) as {
      popularSeries: ReturnType<typeof mapTmdbSeries>[];
      popularAnime: ReturnType<typeof mapTmdbSeries>[];
    };
    const items = params.animeOnly ? fb.popularAnime : [...fb.popularSeries, ...fb.popularAnime];
    return { items, page: 1, totalPages: 1, totalResults: items.length };
  }

  const query: Record<string, string | number> = {
    page,
    sort_by: params.sortBy || 'popularity.desc',
  };
  if (params.animeOnly) {
    query.with_genres = '16';
    query.with_original_language = 'ja';
  } else if (params.genreId && params.genreId !== 'all') {
    query.with_genres = params.genreId;
  }
  if (params.year && params.year !== 'all') query.first_air_date_year = params.year;

  const endpoint =
    params.animeOnly || params.genreId || params.year || params.sortBy ? '/discover/tv' : '/tv/popular';
  const dto = await tmdbFetch<{
    results: Record<string, unknown>[];
    page: number;
    total_pages: number;
    total_results: number;
  }>(endpoint, query);

  return {
    items: (dto.results || []).map(mapTmdbSeries),
    page: dto.page || page,
    totalPages: Math.min(dto.total_pages || 1, 500),
    totalResults: dto.total_results || 0,
  };
}

export async function searchAllCatalog(query: string, page = 1) {
  const q = query.trim();
  if (!q) return { movies: [], series: [], anime: [], page: 1, totalPages: 1 };

  const [animeResults, tmdbResults] = await Promise.allSettled([
    searchAnime123(q),
    isTmdbConfigured()
      ? Promise.all([
          tmdbFetch<{ results: Record<string, unknown>[]; total_pages: number }>('/search/movie', {
            query: q,
            page,
          }),
          tmdbFetch<{ results: Record<string, unknown>[]; total_pages: number }>('/search/tv', {
            query: q,
            page,
          }),
        ])
      : Promise.resolve(null),
  ]);

  let movies: ReturnType<typeof mapTmdbMovie>[] = [];
  let series: ReturnType<typeof mapTmdbSeries>[] = [];
  let totalPages = 1;

  if (tmdbResults.status === 'fulfilled' && tmdbResults.value) {
    movies = (tmdbResults.value[0].results || []).map(mapTmdbMovie);
    series = (tmdbResults.value[1].results || []).map(mapTmdbSeries);
    totalPages = Math.max(tmdbResults.value[0].total_pages || 1, tmdbResults.value[1].total_pages || 1);
  } else if (!isTmdbConfigured()) {
    const fb = (await buildPublicFallbackDiscovery()) as {
      popularMovies: ReturnType<typeof mapTmdbMovie>[];
      popularSeries: ReturnType<typeof mapTmdbSeries>[];
    };
    const lq = q.toLowerCase();
    movies = fb.popularMovies.filter((m) => m.title.toLowerCase().includes(lq));
    series = fb.popularSeries.filter((s) => s.title.toLowerCase().includes(lq));
  }

  const anime =
    animeResults.status === 'fulfilled'
      ? animeResults.value.map((a) => ({
          id: `anime_${a.id}`,
          externalId: a.id,
          providerId: '123anime',
          title: a.title,
          synopsis: `${a.title} • ${a.episodesCount} (${a.isDub ? 'Dub' : 'Sub'})`,
          releaseYear: 2024,
          genres: ['Anime', 'Animation'],
          language: a.isDub ? 'English Dub' : 'Japanese (Sub)',
          country: 'JP',
          posterUrl: a.posterUrl,
          backdropUrl: a.posterUrl,
          thumbnailUrl: a.posterUrl,
          seasonCount: 1,
          episodeCount: Number(String(a.episodesCount).replace(/[^0-9]/g, '')) || 12,
          rating: 8.2,
          trendingScore: 95,
          isAnime: true,
          isPlayable: true,
          mediaType: 'tv' as const,
        }))
      : [];

  return { movies, series, anime, page, totalPages };
}

export async function getMovieDetailsFull(movieId: string) {
  if (movieId.startsWith('ia_movie_')) {
    const ident = movieId.replace('ia_movie_', '');
    const metaRes = await fetch(`https://archive.org/metadata/${encodeURIComponent(ident)}`);
    const meta = (await metaRes.json()) as {
      metadata?: Record<string, unknown>;
      files?: Array<{ name: string; format?: string; size?: string }>;
    };
    const mp4 = (meta.files || []).find((f) => f.name?.toLowerCase().endsWith('.mp4'));
    const directUrl = mp4 ? `https://archive.org/download/${encodeURIComponent(ident)}/${encodeURIComponent(mp4.name)}` : '';
    const m = meta.metadata || {};
    return {
      movie: {
        id: movieId,
        externalId: ident,
        providerId: 'archive',
        title: String(m.title || ident),
        originalTitle: String(m.title || ident),
        synopsis: String(m.description || 'Public domain classic cinema from Internet Archive.'),
        releaseYear: Number(m.year || 1960) || 1960,
        genres: ['Classic Cinema', 'Public Domain'],
        director: String(m.creator || ''),
        cast: [],
        runtimeSeconds: 5400,
        language: 'English',
        country: 'International',
        posterUrl: `https://archive.org/services/img/${encodeURIComponent(ident)}`,
        backdropUrl: `https://archive.org/services/img/${encodeURIComponent(ident)}`,
        thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(ident)}`,
        rating: 7.5,
        trendingScore: 80,
        directVideoUrl: directUrl,
        isPlayable: Boolean(directUrl),
        mediaType: 'movie' as const,
      },
      trailers: [],
      recommended: [],
    };
  }

  const numericId = Number(movieId.replace('tmdb_movie_', ''));
  const [detail, credits, videos, recs] = await Promise.all([
    tmdbFetch<Record<string, unknown>>(`/movie/${numericId}`),
    tmdbFetch<{
      cast?: Array<{ name: string }>;
      crew?: Array<{ name: string; job: string }>;
    }>(`/movie/${numericId}/credits`).catch(() => ({ cast: [], crew: [] })),
    tmdbFetch<{ results?: Array<{ name: string; site: string; key: string; type: string; official: boolean }> }>(
      `/movie/${numericId}/videos`
    ).catch(() => ({ results: [] })),
    tmdbFetch<{ results?: Record<string, unknown>[] }>(`/movie/${numericId}/recommendations`).catch(() => ({
      results: [],
    })),
  ]);

  const base = mapTmdbMovie(detail);
  const director = (credits.crew || []).find((c) => c.job === 'Director')?.name || '';
  const cast = (credits.cast || []).slice(0, 8).map((c) => c.name);
  const trailers = (videos.results || [])
    .filter((v) => v.site === 'YouTube' && v.key)
    .slice(0, 4)
    .map((v) => ({
      name: v.name,
      site: v.site,
      key: v.key,
      type: v.type,
      official: v.official,
      url: `https://www.youtube.com/watch?v=${v.key}`,
    }));

  return {
    movie: {
      ...base,
      director,
      cast,
      productionCompanies: Array.isArray(detail.production_companies)
        ? (detail.production_companies as Array<{ name: string }>).map((c) => c.name)
        : [],
      releaseDate: String(detail.release_date || ''),
    },
    trailers,
    recommended: (recs.results || []).slice(0, 12).map(mapTmdbMovie),
  };
}

export async function getSeriesDetailsFull(seriesId: string) {
  if (seriesId.startsWith('tvmaze_')) {
    const showId = seriesId.replace('tvmaze_', '');
    const [showRes, epsRes] = await Promise.all([
      fetch(`https://api.tvmaze.com/shows/${encodeURIComponent(showId)}`).then((r) => r.json()),
      fetch(`https://api.tvmaze.com/shows/${encodeURIComponent(showId)}/episodes`).then((r) => r.json()),
    ]);
    const s = showRes as Record<string, unknown>;
    const eps = Array.isArray(epsRes) ? (epsRes as Array<Record<string, unknown>>) : [];
    const seasonMap = new Map<number, Array<Record<string, unknown>>>();
    for (const ep of eps) {
      const sn = Number(ep.season || 1);
      if (!seasonMap.has(sn)) seasonMap.set(sn, []);
      seasonMap.get(sn)!.push(ep);
    }
    const seasons = Array.from(seasonMap.entries()).map(([seasonNumber, list]) => ({
      seasonNumber,
      title: `Season ${seasonNumber}`,
      episodes: list.map((ep) => ({
        id: `${seriesId}_s${seasonNumber}_e${ep.number}`,
        seriesId,
        seasonNumber,
        episodeNumber: Number(ep.number || 1),
        title: String(ep.name || `Episode ${ep.number}`),
        description: String(ep.summary || '').replace(/<[^>]+>/g, '').trim() || 'Watch episode on KINOVA.',
        runtimeSeconds: Number(ep.runtime || 42) * 60,
        posterUrl: (ep.image as { medium?: string } | undefined)?.medium || '',
      })),
    }));
    const img = s.image as { medium?: string; original?: string } | undefined;
    return {
      series: {
        id: seriesId,
        externalId: showId,
        providerId: 'tvmaze',
        title: String(s.name || 'Series'),
        synopsis: String(s.summary || '').replace(/<[^>]+>/g, '').trim(),
        releaseYear: parseYear(s.premiered as string),
        genres: Array.isArray(s.genres) ? (s.genres as string[]) : ['Drama'],
        posterUrl: img?.medium || img?.original || '',
        backdropUrl: img?.original || img?.medium || '',
        thumbnailUrl: img?.medium || '',
        seasonCount: seasons.length,
        episodeCount: eps.length,
        seasons,
        rating: Number((s.rating as { average?: number } | undefined)?.average || 7.5),
        isAnime: false,
        isPlayable: true,
        mediaType: 'tv' as const,
      },
      trailers: [],
      recommended: [],
    };
  }

  const numericId = Number(seriesId.replace('tmdb_tv_', ''));
  const [detail, credits, videos, recs] = await Promise.all([
    tmdbFetch<Record<string, unknown>>(`/tv/${numericId}`),
    tmdbFetch<{ cast?: Array<{ name: string }>; crew?: Array<{ name: string; job: string }> }>(
      `/tv/${numericId}/credits`
    ).catch(() => ({ cast: [], crew: [] })),
    tmdbFetch<{ results?: Array<{ name: string; site: string; key: string; type: string; official: boolean }> }>(
      `/tv/${numericId}/videos`
    ).catch(() => ({ results: [] })),
    tmdbFetch<{ results?: Record<string, unknown>[] }>(`/tv/${numericId}/recommendations`).catch(() => ({
      results: [],
    })),
  ]);

  const base = mapTmdbSeries(detail);
  const rawSeasons = Array.isArray(detail.seasons) ? (detail.seasons as Array<Record<string, unknown>>) : [];
  const validSeasons = rawSeasons.filter((s) => Number(s.season_number || 0) >= 1).slice(0, 12);

  const seasonDetails = await Promise.allSettled(
    validSeasons.map((s) =>
      tmdbFetch<{ episodes?: Array<Record<string, unknown>> }>(`/tv/${numericId}/season/${s.season_number}`)
    )
  );

  const seasons = validSeasons.map((s, idx) => {
    const sNum = Number(s.season_number || 1);
    const epResp = seasonDetails[idx];
    const eps =
      epResp.status === 'fulfilled' && Array.isArray(epResp.value.episodes)
        ? epResp.value.episodes.map((ep) => ({
            id: `tmdb_tv_${numericId}_s${sNum}_e${ep.episode_number}`,
            seriesId: base.id,
            seasonNumber: sNum,
            episodeNumber: Number(ep.episode_number || 1),
            title: String(ep.name || `Episode ${ep.episode_number}`),
            description: String(ep.overview || 'Stream episode on KINOVA.'),
            runtimeSeconds: Number(ep.runtime || 42) * 60,
            posterUrl: typeof ep.still_path === 'string' && ep.still_path ? `${TMDB_IMG}/w500${ep.still_path}` : base.backdropUrl,
          }))
        : [];
    return {
      seasonNumber: sNum,
      title: String(s.name || `Season ${sNum}`),
      episodes: eps,
    };
  });

  return {
    series: {
      ...base,
      director: (credits.crew || [])[0]?.name || '',
      cast: (credits.cast || []).slice(0, 8).map((c) => c.name),
      seasons,
    },
    trailers: (videos.results || [])
      .filter((v) => v.site === 'YouTube' && v.key)
      .slice(0, 4)
      .map((v) => ({
        name: v.name,
        site: v.site,
        key: v.key,
        type: v.type,
        official: v.official,
        url: `https://www.youtube.com/watch?v=${v.key}`,
      })),
    recommended: (recs.results || []).slice(0, 12).map(mapTmdbSeries),
  };
}
