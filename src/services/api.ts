import type {
  MovieRecord,
  ResolvedStreamSource,
  SeriesRecord,
  StreamDiagnosticsItem,
  SubtitleTrackCandidate,
  TmdbHomeDiscovery,
  TrailerItem,
} from '../types/kinova';

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function fetchHomeDiscovery() {
  return apiGet<TmdbHomeDiscovery>('/api/tmdb/home');
}

export function fetchMoviesPage(params: {
  page?: number;
  genre?: string;
  year?: string;
  sort?: string;
}) {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.genre && params.genre !== 'all') q.set('genre', params.genre);
  if (params.year && params.year !== 'all') q.set('year', params.year);
  if (params.sort) q.set('sort', params.sort);
  return apiGet<{ items: MovieRecord[]; page: number; totalPages: number; totalResults: number }>(
    `/api/tmdb/movies?${q.toString()}`
  );
}

export function fetchSeriesPage(params: {
  page?: number;
  genre?: string;
  year?: string;
  sort?: string;
  anime?: boolean;
}) {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.genre && params.genre !== 'all') q.set('genre', params.genre);
  if (params.year && params.year !== 'all') q.set('year', params.year);
  if (params.sort) q.set('sort', params.sort);
  if (params.anime) q.set('anime', '1');
  return apiGet<{ items: SeriesRecord[]; page: number; totalPages: number; totalResults: number }>(
    `/api/tmdb/series?${q.toString()}`
  );
}

export function searchCatalogue(query: string, page = 1) {
  return apiGet<{
    movies: MovieRecord[];
    series: SeriesRecord[];
    anime: SeriesRecord[];
    page: number;
    totalPages: number;
  }>(`/api/tmdb/search?q=${encodeURIComponent(query)}&page=${page}`);
}

export function fetchMovieDetail(movieId: string) {
  return apiGet<{ movie: MovieRecord; trailers: TrailerItem[]; recommended: MovieRecord[] }>(
    `/api/tmdb/movie/${encodeURIComponent(movieId)}`
  );
}

export function fetchSeriesDetail(seriesId: string) {
  return apiGet<{ series: SeriesRecord; trailers: TrailerItem[]; recommended: SeriesRecord[] }>(
    `/api/tmdb/tv/${encodeURIComponent(seriesId)}`
  );
}

export function resolveMovieStreams(movieId: string, vylaUrl = '', preferredProvider = 'auto') {
  const q = new URLSearchParams();
  if (vylaUrl) q.set('vylaUrl', vylaUrl);
  if (preferredProvider && preferredProvider !== 'auto') q.set('preferredProvider', preferredProvider);
  return apiGet<{
    sources: ResolvedStreamSource[];
    subtitles: SubtitleTrackCandidate[];
    diagnostics: StreamDiagnosticsItem[];
  }>(`/api/streams/movie/${encodeURIComponent(movieId)}?${q.toString()}`);
}

export function resolveTvStreams(params: {
  seriesId: string;
  season: number;
  episode: number;
  title?: string;
  isAnime?: boolean;
  preferDub?: boolean;
  animeFallback?: boolean;
  vylaUrl?: string;
  preferredProvider?: string;
}) {
  const q = new URLSearchParams();
  if (params.title) q.set('title', params.title);
  if (params.isAnime) q.set('anime', '1');
  if (params.preferDub) q.set('dub', '1');
  if (params.animeFallback === false) q.set('animeFallback', '0');
  if (params.vylaUrl) q.set('vylaUrl', params.vylaUrl);
  if (params.preferredProvider && params.preferredProvider !== 'auto') {
    q.set('preferredProvider', params.preferredProvider);
  }
  return apiGet<{
    sources: ResolvedStreamSource[];
    subtitles: SubtitleTrackCandidate[];
    diagnostics: StreamDiagnosticsItem[];
  }>(
    `/api/streams/tv/${encodeURIComponent(params.seriesId)}/${params.season}/${params.episode}?${q.toString()}`
  );
}

export function fetchAnimeDetail(animeId: string) {
  return apiGet<{
    id: string;
    title: string;
    synopsis: string;
    posterUrl: string;
    genres: string[];
    releaseYear: number;
    isDub: boolean;
    totalEpisodes: number;
    episodes: Array<{ number: number; id: string; title: string }>;
  }>(`/api/anime/detail/${encodeURIComponent(animeId.replace(/^anime_/, ''))}`);
}

export function probeBackendHealth() {
  return apiGet<{
    ok: boolean;
    tmdbConfigured: boolean;
    proxyEngine: { ok: boolean; detail: string };
    vidzee: { ok: boolean; status: number; detail: string; elapsedMs: number };
    anime123: { ok: boolean; status: number; detail: string; elapsedMs: number };
    timestamp: string;
  }>('/api/health/probe');
}
