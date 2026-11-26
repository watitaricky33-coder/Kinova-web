import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bookmark,
  Check,
  Download,
  ExternalLink,
  HardDrive,
  Play,
  Server,
  Share2,
  Tv,
} from 'lucide-react';
import { KinovaPosterImage, MediaGridCard } from '../components/KinovaComponents';
import { useKinova } from '../context/KinovaContext';
import {
  fetchAnimeDetail,
  fetchMovieDetail,
  fetchSeriesDetail,
  resolveMovieStreams,
  resolveTvStreams,
} from '../services/api';
import { triggerFileDownload } from '../services/offlineStorage';
import {
  formatRuntime,
  type EpisodeRecord,
  type MovieRecord,
  type ResolvedStreamSource,
  type SeriesRecord,
  type TrailerItem,
} from '../types/kinova';

const SourcePickerModal: React.FC<{
  open: boolean;
  title: string;
  loading: boolean;
  sources: ResolvedStreamSource[];
  error: string | null;
  onClose: () => void;
  onSelectStream: (src: ResolvedStreamSource) => void;
  onSelectDownload: (src: ResolvedStreamSource) => void;
}> = ({ open, title, loading, sources, error, onClose, onSelectStream, onSelectDownload }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-4 backdrop-blur-xs sm:items-center">
      <div className="w-full max-w-xl rounded-2xl border border-[#2A2A32] bg-[#141418] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[#2A2A32] pb-3">
          <div>
            <p className="font-mono text-xs tracking-wider text-[#F2C94C] uppercase">Verified Stream Sources</p>
            <h3 className="font-editorial text-lg font-bold text-white">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] rounded-lg px-3 text-xs font-semibold text-[#9E9EA8] hover:bg-[#1F1F24] hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-4 max-h-[60vh] space-y-2.5 overflow-y-auto pr-1">
          {loading && (
            <div className="py-8 text-center text-sm text-[#9E9EA8]">
              Probing VidZee, X8RR, 123Anime & Node.js Proxy...
            </div>
          )}
          {!loading && error && (
            <div className="rounded-xl border border-[#FF5A5F]/40 bg-[#3D1A1E]/40 p-4 text-sm text-[#FFB4B7]">
              {error}
            </div>
          )}
          {!loading && !error && sources.length === 0 && (
            <div className="rounded-xl border border-[#2A2A32] bg-[#1F1F24] p-5 text-center text-sm text-[#9E9EA8]">
              No verified playback sources returned right now. Try opening the player for live multi-provider failover.
            </div>
          )}
          {sources.map((src) => (
            <div
              key={src.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2A2A32] bg-[#1F1F24] p-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 shrink-0 text-[#F2C94C]" />
                  <p className="truncate text-sm font-semibold text-white">{src.serverName}</p>
                </div>
                <p className="mt-0.5 font-mono text-xs text-[#9E9EA8]">
                  {src.quality} • {src.streamType.toUpperCase()} • {src.language}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelectStream(src)}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#E50914] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#c80711]"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Play</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSelectDownload(src)}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#2A2A32] bg-[#141418] px-3 py-1.5 text-xs font-semibold text-[#F2C94C] hover:border-[#F2C94C]"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Vault</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerFileDownload(src.downloadProxyUrl || src.proxyUrl, `${title}.mp4`);
                  }}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#2A2A32] bg-[#141418] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#E50914]"
                >
                  <Download className="h-3.5 w-3.5 text-[#E50914]" />
                  <span>MP4</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const MovieDetailsPage: React.FC = () => {
  const { movieId = '' } = useParams();
  const decodedId = decodeURIComponent(movieId);
  const navigate = useNavigate();
  const {
    settings,
    isInWatchlist,
    toggleWatchlist,
    getProgressFor,
    downloads,
    startDownload,
    showToast,
    knownContentById,
  } = useKinova();

  const cached = knownContentById(decodedId) as MovieRecord | undefined;
  const [movie, setMovie] = useState<MovieRecord | null>(cached || null);
  const [trailers, setTrailers] = useState<TrailerItem[]>([]);
  const [recommended, setRecommended] = useState<MovieRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'details' | 'more'>('details');
  const [sourcesModalOpen, setSourcesModalOpen] = useState(false);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sources, setSources] = useState<ResolvedStreamSource[]>([]);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchMovieDetail(decodedId)
      .then((res) => {
        if (!active) return;
        setMovie(res.movie);
        setTrailers(res.trailers);
        setRecommended(res.recommended);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [decodedId]);

  const progress = getProgressFor(decodedId);
  const completedDownload = downloads.find(
    (d) => d.contentId === decodedId && !d.episodeId && d.status === 'COMPLETED'
  );

  const openSources = async () => {
    setSourcesModalOpen(true);
    setSourcesLoading(true);
    setSourcesError(null);
    try {
      const res = await resolveMovieStreams(decodedId, settings.vylaBaseUrl, settings.playbackProviderPriority);
      setSources(res.sources);
    } catch (err) {
      setSourcesError(err instanceof Error ? err.message : 'Unable to resolve sources');
    } finally {
      setSourcesLoading(false);
    }
  };

  const handleShare = async () => {
    const shareUrl = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: movie?.title || 'KINOVA', url: shareUrl }).catch(() => {});
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Link copied to clipboard');
    }
  };

  if (!movie) {
    return (
      <div className="p-8 text-center text-sm text-[#9E9EA8]">Loading feature details...</div>
    );
  }

  return (
    <div className="pb-14">
      {/* Header Backdrop */}
      <div className="relative h-72 w-full overflow-hidden bg-[#141418] sm:h-96">
        <KinovaPosterImage
          src={movie.backdropUrl || movie.posterUrl}
          title={movie.title}
          aspectClass="h-full w-full"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0C] via-[#0A0A0C]/65 to-transparent" />
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="absolute top-4 left-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[#2A2A32] bg-[#0A0A0C]/80 text-white backdrop-blur-sm hover:bg-[#1F1F24]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>

      <div className="mx-auto -mt-20 relative z-10 max-w-6xl space-y-6 px-4 lg:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
          <div className="w-36 shrink-0 overflow-hidden rounded-2xl border border-[#2A2A32] shadow-2xl sm:w-44">
            <KinovaPosterImage src={movie.posterUrl} title={movie.title} />
          </div>

          <div className="flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-[#E50914] px-2 py-0.5 font-semibold text-white uppercase">
                Feature Film
              </span>
              {movie.releaseYear > 0 && (
                <span className="font-mono text-[#F2C94C]">{movie.releaseYear}</span>
              )}
              {movie.runtimeSeconds > 0 && (
                <span className="font-mono text-[#9E9EA8]">{formatRuntime(movie.runtimeSeconds)}</span>
              )}
              {movie.rating > 0 && (
                <span className="font-mono text-[#F2C94C]">★ {movie.rating.toFixed(1)}</span>
              )}
            </div>

            <h1 className="font-editorial text-3xl font-bold text-white sm:text-4xl">{movie.title}</h1>
            <p className="text-sm text-[#9E9EA8]">{movie.genres.join(' • ')}</p>

            {/* Primary Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => navigate(`/player/${encodeURIComponent(movie.id)}`)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#E50914] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#E50914]/30 hover:bg-[#c80711]"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>
                  {completedDownload
                    ? 'Play Offline Copy'
                    : progress && progress.positionMs > 0
                      ? 'Resume Movie'
                      : 'Play Movie'}
                </span>
              </button>

              {completedDownload && (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#4ADE80]/40 bg-[#4ADE80]/10 px-3 py-2 text-xs font-semibold text-[#4ADE80]">
                  <HardDrive className="h-3.5 w-3.5" />
                  <span>Saved Offline</span>
                </span>
              )}

              <button
                type="button"
                onClick={() => void openSources()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#2A2A32] bg-[#141418] px-4 py-2.5 text-sm font-semibold text-white hover:border-[#F2C94C]"
              >
                <Download className="h-4 w-4 text-[#F2C94C]" />
                <span>Download / Sources</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  void toggleWatchlist({
                    contentId: movie.id,
                    contentType: 'MOVIE',
                    title: movie.title,
                    posterUrl: movie.posterUrl,
                    releaseYear: movie.releaseYear,
                    genre: movie.genres?.[0] || 'Cinema',
                    runtimeSeconds: movie.runtimeSeconds,
                    isPlayable: true,
                  })
                }
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#2A2A32] bg-[#141418] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1F1F24]"
              >
                {isInWatchlist(movie.id) ? (
                  <>
                    <Check className="h-4 w-4 text-[#4ADE80]" />
                    <span>In My List</span>
                  </>
                ) : (
                  <>
                    <Bookmark className="h-4 w-4" />
                    <span>My List</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleShare()}
                aria-label="Share"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#2A2A32] bg-[#141418] text-white hover:bg-[#1F1F24]"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-[#2A2A32] pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === 'details'
                ? 'border-[#E50914] text-white'
                : 'border-transparent text-[#9E9EA8] hover:text-white'
            }`}
          >
            Synopsis & Credits
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('more')}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === 'more'
                ? 'border-[#E50914] text-white'
                : 'border-transparent text-[#9E9EA8] hover:text-white'
            }`}
          >
            More Like This ({recommended.length})
          </button>
        </div>

        {activeTab === 'details' ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <p className="leading-relaxed text-[#E2E2E8]">{movie.synopsis}</p>
              {trailers.length > 0 && (
                <div className="space-y-2.5 pt-2">
                  <h2 className="text-sm font-semibold tracking-wider text-[#F2C94C] uppercase">Trailers</h2>
                  <div className="flex flex-wrap gap-2.5">
                    {trailers.map((t) => (
                      <a
                        key={t.key}
                        href={t.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl border border-[#2A2A32] bg-[#141418] px-3.5 py-2 text-xs font-semibold text-white hover:border-[#E50914]"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-[#E50914]" />
                        <span>{t.name}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-3 rounded-2xl border border-[#2A2A32] bg-[#141418] p-5 text-sm">
              {movie.director && (
                <div>
                  <span className="text-xs text-[#9E9EA8] uppercase">Director</span>
                  <p className="font-semibold text-white">{movie.director}</p>
                </div>
              )}
              {movie.cast && movie.cast.length > 0 && (
                <div>
                  <span className="text-xs text-[#9E9EA8] uppercase">Cast</span>
                  <p className="text-white">{movie.cast.join(', ')}</p>
                </div>
              )}
              <div>
                <span className="text-xs text-[#9E9EA8] uppercase">Language</span>
                <p className="text-white">{movie.language}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {recommended.map((rec) => (
              <MediaGridCard
                key={rec.id}
                id={rec.id}
                type="movie"
                title={rec.title}
                posterUrl={rec.posterUrl || rec.thumbnailUrl}
                year={rec.releaseYear}
                rating={rec.rating}
                genre={rec.genres?.[0]}
              />
            ))}
          </div>
        )}
      </div>

      <SourcePickerModal
        open={sourcesModalOpen}
        title={movie.title}
        loading={sourcesLoading}
        sources={sources}
        error={sourcesError}
        onClose={() => setSourcesModalOpen(false)}
        onSelectStream={(src) => {
          setSourcesModalOpen(false);
          navigate(`/player/${encodeURIComponent(movie.id)}?source=${encodeURIComponent(src.id)}`);
        }}
        onSelectDownload={(src) => {
          setSourcesModalOpen(false);
          startDownload({
            contentId: movie.id,
            contentType: 'MOVIE',
            title: movie.title,
            subtitle: `${movie.releaseYear || 'HD'} • ${src.quality}`,
            posterUrl: movie.posterUrl,
            source: src,
          });
        }}
      />
    </div>
  );
};

export const SeriesDetailsPage: React.FC = () => {
  const { seriesId = '' } = useParams();
  const decodedId = decodeURIComponent(seriesId);
  const navigate = useNavigate();
  const {
    settings,
    isInWatchlist,
    toggleWatchlist,
    startDownload,
    knownContentById,
    showToast,
  } = useKinova();

  const cached = knownContentById(decodedId) as SeriesRecord | undefined;
  const [series, setSeries] = useState<SeriesRecord | null>(cached || null);
  const [recommended, setRecommended] = useState<SeriesRecord[]>([]);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [modalEp, setModalEp] = useState<EpisodeRecord | null>(null);
  const [epSources, setEpSources] = useState<ResolvedStreamSource[]>([]);
  const [epLoading, setEpLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (decodedId.startsWith('anime_')) {
      fetchAnimeDetail(decodedId)
        .then((detail) => {
          if (!active) return;
          setSeries({
            id: decodedId,
            externalId: detail.id,
            providerId: '123anime',
            title: detail.title,
            synopsis: detail.synopsis,
            releaseYear: detail.releaseYear,
            genres: detail.genres,
            language: detail.isDub ? 'English Dub' : 'Japanese (Sub)',
            country: 'JP',
            posterUrl: detail.posterUrl,
            backdropUrl: detail.posterUrl,
            thumbnailUrl: detail.posterUrl,
            seasonCount: 1,
            episodeCount: detail.totalEpisodes,
            seasons: [
              {
                seasonNumber: 1,
                title: 'Episodes',
                episodes: detail.episodes.map((e) => ({
                  id: `${decodedId}_s1_e${e.number}`,
                  seriesId: decodedId,
                  seasonNumber: 1,
                  episodeNumber: e.number,
                  title: e.title,
                  description: `${detail.title} • Episode ${e.number}`,
                  runtimeSeconds: 1440,
                  posterUrl: detail.posterUrl,
                })),
              },
            ],
            rating: 8.4,
            trendingScore: 100,
            isAnime: true,
            isPlayable: true,
          });
        })
        .catch(() => {});
    } else {
      fetchSeriesDetail(decodedId)
        .then((res) => {
          if (!active) return;
          setSeries(res.series);
          setRecommended(res.recommended);
          if (res.series.seasons && res.series.seasons.length > 0) {
            setSelectedSeason(res.series.seasons[0].seasonNumber);
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [decodedId]);

  const activeSeasonObj =
    series?.seasons?.find((s) => s.seasonNumber === selectedSeason) || series?.seasons?.[0];

  const openEpisodeSources = async (ep: EpisodeRecord) => {
    if (!series) return;
    setModalEp(ep);
    setEpLoading(true);
    setEpSources([]);
    try {
      const res = await resolveTvStreams({
        seriesId: series.id,
        season: ep.seasonNumber,
        episode: ep.episodeNumber,
        title: series.title,
        isAnime: Boolean(series.isAnime || series.genres.some((g) => g.toLowerCase() === 'anime')),
        preferDub: settings.animeSubDubPreference === 'dub',
        animeFallback: settings.animeFallbackEnabled,
        vylaUrl: settings.vylaBaseUrl,
        preferredProvider: settings.playbackProviderPriority,
      });
      setEpSources(res.sources);
    } catch {
      showToast('Unable to probe episode sources');
    } finally {
      setEpLoading(false);
    }
  };

  if (!series) {
    return <div className="p-8 text-center text-sm text-[#9E9EA8]">Loading series details...</div>;
  }

  const firstEp = activeSeasonObj?.episodes?.[0];
  const isAnimeSeries = Boolean(
    series.isAnime || series.id.startsWith('anime_') || series.genres.some((g) => g.toLowerCase() === 'anime')
  );

  return (
    <div className="pb-14">
      <div className="relative h-72 w-full overflow-hidden bg-[#141418] sm:h-96">
        <KinovaPosterImage
          src={series.backdropUrl || series.posterUrl}
          title={series.title}
          aspectClass="h-full w-full"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0C] via-[#0A0A0C]/65 to-transparent" />
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="absolute top-4 left-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[#2A2A32] bg-[#0A0A0C]/80 text-white backdrop-blur-sm hover:bg-[#1F1F24]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>

      <div className="relative z-10 mx-auto -mt-20 max-w-6xl space-y-6 px-4 lg:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
          <div className="w-36 shrink-0 overflow-hidden rounded-2xl border border-[#2A2A32] shadow-2xl sm:w-44">
            <KinovaPosterImage src={series.posterUrl} title={series.title} />
          </div>

          <div className="flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-[#E50914] px-2 py-0.5 font-semibold text-white uppercase">
                {isAnimeSeries ? 'Anime Series' : 'TV Series'}
              </span>
              {series.releaseYear > 0 && (
                <span className="font-mono text-[#F2C94C]">{series.releaseYear}</span>
              )}
              <span className="font-mono text-[#9E9EA8]">
                {series.seasons?.length || series.seasonCount} Season(s)
              </span>
              {series.rating > 0 && (
                <span className="font-mono text-[#F2C94C]">★ {series.rating.toFixed(1)}</span>
              )}
            </div>

            <h1 className="font-editorial text-3xl font-bold text-white sm:text-4xl">{series.title}</h1>
            <p className="max-w-3xl text-sm leading-relaxed text-[#9E9EA8]">{series.synopsis}</p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {firstEp && (
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/player/${encodeURIComponent(series.id)}?season=${firstEp.seasonNumber}&episode=${firstEp.episodeNumber}&title=${encodeURIComponent(series.title)}&anime=${isAnimeSeries ? '1' : '0'}`
                    )
                  }
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#E50914] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#E50914]/30 hover:bg-[#c80711]"
                >
                  <Play className="h-4 w-4 fill-current" />
                  <span>Play S{firstEp.seasonNumber}E{firstEp.episodeNumber}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  void toggleWatchlist({
                    contentId: series.id,
                    contentType: 'SERIES',
                    title: series.title,
                    posterUrl: series.posterUrl,
                    releaseYear: series.releaseYear,
                    genre: series.genres?.[0] || 'Series',
                    runtimeSeconds: 0,
                    isPlayable: true,
                  })
                }
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#2A2A32] bg-[#141418] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1F1F24]"
              >
                {isInWatchlist(series.id) ? (
                  <>
                    <Check className="h-4 w-4 text-[#4ADE80]" />
                    <span>In My List</span>
                  </>
                ) : (
                  <>
                    <Bookmark className="h-4 w-4" />
                    <span>My List</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Season Selector & Episodes */}
        {series.seasons && series.seasons.length > 0 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {series.seasons.map((s) => (
                  <button
                    key={s.seasonNumber}
                    type="button"
                    onClick={() => setSelectedSeason(s.seasonNumber)}
                    className={`min-h-[40px] rounded-xl border px-4 text-xs font-semibold transition-colors ${
                      selectedSeason === s.seasonNumber
                        ? 'border-[#E50914] bg-[#E50914] text-white'
                        : 'border-[#2A2A32] bg-[#141418] text-[#9E9EA8] hover:text-white'
                    }`}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
              <Link
                to={`/series/${encodeURIComponent(series.id)}/season/${selectedSeason}`}
                className="text-xs font-semibold text-[#F2C94C] hover:underline"
              >
                Season View →
              </Link>
            </div>

            <div className="space-y-3">
              {(activeSeasonObj?.episodes || []).map((ep) => (
                <div
                  key={ep.id}
                  className="flex flex-col gap-4 rounded-2xl border border-[#2A2A32] bg-[#141418] p-4 sm:flex-row sm:items-center"
                >
                  <div className="w-full shrink-0 overflow-hidden rounded-xl bg-[#1F1F24] sm:w-44">
                    <KinovaPosterImage
                      src={ep.posterUrl || series.posterUrl}
                      title={ep.title}
                      aspectClass="aspect-video"
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 font-mono text-xs text-[#F2C94C]">
                      <Tv className="h-3.5 w-3.5" />
                      <span>
                        S{ep.seasonNumber} • Episode {ep.episodeNumber}
                      </span>
                      {ep.runtimeSeconds > 0 && (
                        <span className="text-[#9E9EA8]">• {formatRuntime(ep.runtimeSeconds)}</span>
                      )}
                    </div>
                    <h3 className="font-semibold text-white">{ep.title}</h3>
                    <p className="line-clamp-2 text-xs leading-relaxed text-[#9E9EA8]">
                      {ep.description}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/player/${encodeURIComponent(series.id)}?season=${ep.seasonNumber}&episode=${ep.episodeNumber}&title=${encodeURIComponent(series.title)}&anime=${isAnimeSeries ? '1' : '0'}`
                        )
                      }
                      className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#E50914] px-4 text-xs font-semibold text-white hover:bg-[#c80711]"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      <span>Play</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void openEpisodeSources(ep)}
                      aria-label={`Sources for episode ${ep.episodeNumber}`}
                      className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3 text-xs font-semibold text-[#F2C94C] hover:border-[#F2C94C]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Save</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {recommended.length > 0 && (
          <section className="space-y-3 pt-4">
            <h2 className="font-editorial text-xl font-bold text-white">More Series Like This</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {recommended.map((rec) => (
                <MediaGridCard
                  key={rec.id}
                  id={rec.id}
                  type="tv"
                  title={rec.title}
                  posterUrl={rec.posterUrl || rec.thumbnailUrl}
                  year={rec.releaseYear}
                  rating={rec.rating}
                  genre={rec.genres?.[0]}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <SourcePickerModal
        open={Boolean(modalEp)}
        title={modalEp ? `${series.title} — S${modalEp.seasonNumber}E${modalEp.episodeNumber}` : ''}
        loading={epLoading}
        sources={epSources}
        error={null}
        onClose={() => setModalEp(null)}
        onSelectStream={(src) => {
          if (!modalEp) return;
          setModalEp(null);
          navigate(
            `/player/${encodeURIComponent(series.id)}?season=${modalEp.seasonNumber}&episode=${modalEp.episodeNumber}&title=${encodeURIComponent(series.title)}&anime=${isAnimeSeries ? '1' : '0'}&source=${encodeURIComponent(src.id)}`
          );
        }}
        onSelectDownload={(src) => {
          if (!modalEp) return;
          setModalEp(null);
          startDownload({
            contentId: series.id,
            episodeId: modalEp.id,
            contentType: 'SERIES',
            title: series.title,
            subtitle: `S${modalEp.seasonNumber}E${modalEp.episodeNumber} • ${modalEp.title}`,
            posterUrl: modalEp.posterUrl || series.posterUrl,
            source: src,
          });
        }}
      />
    </div>
  );
};

export const SeasonEpisodesPage: React.FC = () => {
  return <SeriesDetailsPage />;
};
