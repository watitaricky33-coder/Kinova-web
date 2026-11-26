export type ContentType = 'MOVIE' | 'SERIES';

export type DownloadStatus =
  | 'QUEUED'
  | 'DOWNLOADING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export interface SubtitleTrackCandidate {
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
  subtitles: SubtitleTrackCandidate[];
}

export interface StreamDiagnosticsItem {
  provider: string;
  status: 'ok' | 'empty' | 'error';
  count: number;
  detail?: string;
  elapsedMs: number;
}

export interface MovieRecord {
  id: string;
  externalId: string;
  providerId: string;
  title: string;
  originalTitle?: string;
  synopsis: string;
  releaseYear: number;
  genres: string[];
  director?: string;
  cast?: string[];
  runtimeSeconds: number;
  language: string;
  country: string;
  posterUrl: string;
  backdropUrl: string;
  thumbnailUrl: string;
  rating: number;
  trendingScore: number;
  productionCompanies?: string[];
  releaseDate?: string;
  directVideoUrl?: string;
  isPlayable: boolean;
  mediaType?: 'movie';
}

export interface EpisodeRecord {
  id: string;
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  description: string;
  runtimeSeconds: number;
  posterUrl: string;
}

export interface SeasonRecord {
  seasonNumber: number;
  title: string;
  episodes: EpisodeRecord[];
}

export interface SeriesRecord {
  id: string;
  externalId: string;
  providerId: string;
  title: string;
  synopsis: string;
  releaseYear: number;
  genres: string[];
  director?: string;
  cast?: string[];
  language: string;
  country: string;
  posterUrl: string;
  backdropUrl: string;
  thumbnailUrl: string;
  seasonCount: number;
  episodeCount: number;
  seasons?: SeasonRecord[];
  rating: number;
  trendingScore: number;
  isAnime?: boolean;
  isPlayable: boolean;
  mediaType?: 'tv';
}

export interface TrailerItem {
  name: string;
  site: string;
  key: string;
  type: string;
  official: boolean;
  url: string;
}

export interface WatchlistRecord {
  contentId: string;
  contentType: ContentType;
  title: string;
  posterUrl: string;
  releaseYear: number;
  genre: string;
  runtimeSeconds: number;
  isPlayable: boolean;
  addedAtMillis: number;
}

export interface WatchProgressRecord {
  progressKey: string;
  contentId: string;
  episodeId: string;
  contentType: 'MOVIE' | 'EPISODE';
  title: string;
  subtitle: string;
  posterUrl: string;
  positionMs: number;
  durationMs: number;
  completed: boolean;
  lastWatchedAtMillis: number;
}

export interface ViewingHistoryRecord {
  id: string;
  contentId: string;
  episodeId: string;
  contentType: 'MOVIE' | 'EPISODE';
  title: string;
  posterUrl: string;
  watchedSeconds: number;
  completed: boolean;
  watchedAtMillis: number;
}

export interface DownloadRecord {
  id: string;
  contentId: string;
  episodeId: string;
  contentType: ContentType;
  title: string;
  subtitle: string;
  posterUrl: string;
  remoteUrl: string;
  streamType: 'hls' | 'mp4';
  quality: string;
  totalBytes: number;
  downloadedBytes: number;
  status: DownloadStatus;
  errorMessage?: string;
  updatedAtMillis: number;
}

export interface UserProfileRecord {
  userId: string;
  isGuest: boolean;
  displayName: string;
  email: string;
  avatarUrl: string;
  market: string;
  preferredLanguage: string;
  preferredQuality: 'Auto' | '1080p' | '720p' | 'Data Saver';
  wifiOnlyStreaming: boolean;
  wifiOnlyDownloads: boolean;
}

export interface KinovaAppSettings {
  onboardingCompleted: boolean;
  market: string;
  preferredLanguage: string;
  preferredQuality: 'Auto' | '1080p' | '720p' | 'Data Saver';
  wifiOnlyStreaming: boolean;
  wifiOnlyDownloads: boolean;
  autoPlayNextEpisode: boolean;
  playbackProviderPriority: 'auto' | 'vidzee' | 'x8rr' | 'anime123';
  animeSubDubPreference: 'sub' | 'dub';
  animeFallbackEnabled: boolean;
  vylaBaseUrl: string;
}

export interface TmdbHomeDiscovery {
  tmdbConfigured: boolean;
  trendingMovies: MovieRecord[];
  latestMovieReleases: MovieRecord[];
  popularMovies: MovieRecord[];
  popularSeries: SeriesRecord[];
  trendingSeries: SeriesRecord[];
  latestTvReleases: SeriesRecord[];
  popularAnime: SeriesRecord[];
  actionMovies: MovieRecord[];
  comedyMovies: MovieRecord[];
  romanceMovies: MovieRecord[];
  thrillerMovies: MovieRecord[];
  horrorMovies: MovieRecord[];
  africanCinema: MovieRecord[];
  nollywood: MovieRecord[];
  bollywood: MovieRecord[];
  recommendedMovies: MovieRecord[];
}

export function formatRuntime(seconds: number): string {
  if (!seconds || seconds <= 0) return 'HD Feature';
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${Math.max(1, totalMinutes)}m`;
}

export function formatTimecode(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}
