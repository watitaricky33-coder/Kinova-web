import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Hls from 'hls.js';
import {
  AlertTriangle,
  ArrowLeft,
  Captions,
  Download,
  Maximize,
  Minimize,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Server,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useKinova } from '../context/KinovaContext';
import {
  fetchMovieDetail,
  fetchSeriesDetail,
  resolveMovieStreams,
  resolveTvStreams,
} from '../services/api';
import { getOfflineMediaBlobUrl, triggerFileDownload } from '../services/offlineStorage';
import {
  formatTimecode,
  type ResolvedStreamSource,
  type StreamDiagnosticsItem,
  type SubtitleTrackCandidate,
} from '../types/kinova';

export const PlayerPage: React.FC = () => {
  const { contentId = '' } = useParams();
  const decodedId = decodeURIComponent(contentId);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const rawEpId = searchParams.get('episodeId') || searchParams.get('episode') || '';
  const epMatch = rawEpId.match(/_s(\d+)_e(\d+)/i);
  const season = Number(searchParams.get('season') || epMatch?.[1] || 0);
  const episode = Number(searchParams.get('episode') || epMatch?.[2] || 0);
  const episodeParam =
    searchParams.get('episodeId') || (season && episode ? `${decodedId}_s${season}_e${episode}` : '');
  const titleParam = searchParams.get('title') || '';
  const isAnimeParam = searchParams.get('anime') === '1' || decodedId.startsWith('anime_');
  const preferSourceId = searchParams.get('source') || '';

  const {
    settings,
    saveWatchProgress,
    getProgressFor,
    recordViewingHistory,
    downloads,
    startDownload,
    knownContentById,
    showToast,
  } = useKinova();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const known = knownContentById(decodedId);
  const [title, setTitle] = useState(titleParam || known?.title || 'KINOVA Theater');
  const [posterUrl, setPosterUrl] = useState(known?.posterUrl || '');
  const [loadingStreams, setLoadingStreams] = useState(true);
  const [sources, setSources] = useState<ResolvedStreamSource[]>([]);
  const [subtitles, setSubtitles] = useState<SubtitleTrackCandidate[]>([]);
  const [diagnostics, setDiagnostics] = useState<StreamDiagnosticsItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeSubtitleIdx, setActiveSubtitleIdx] = useState<number>(-1);
  const [offlineUrl, setOfflineUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isCover, setIsCover] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [drawerPanel, setDrawerPanel] = useState<'none' | 'sources' | 'subtitles'>('none');

  const isSeries = season > 0 && episode > 0;
  const activeSource = sources[activeIndex] || null;
  const subtitleText = isSeries ? `Season ${season} • Episode ${episode}` : 'Feature Film';

  // Fetch metadata title/poster if deep-linked directly
  useEffect(() => {
    if (titleParam && posterUrl) return;
    if (decodedId.startsWith('tmdb_movie_') || decodedId.startsWith('ia_movie_')) {
      fetchMovieDetail(decodedId)
        .then((res) => {
          setTitle(res.movie.title);
          setPosterUrl(res.movie.posterUrl);
        })
        .catch(() => {});
    } else if (decodedId.startsWith('tmdb_tv_') || decodedId.startsWith('tvmaze_')) {
      fetchSeriesDetail(decodedId)
        .then((res) => {
          setTitle(res.series.title);
          setPosterUrl(res.series.posterUrl);
        })
        .catch(() => {});
    }
  }, [decodedId, titleParam, posterUrl]);

  // Check IndexedDB offline copy OR resolve live proxy streams
  const loadPlayback = useCallback(async () => {
    setLoadingStreams(true);
    setErrorMsg(null);
    setOfflineUrl(null);

    const dlId = episodeParam ? `${decodedId}__${episodeParam}` : decodedId;
    const completedDl = downloads.find((d) => d.id === dlId && d.status === 'COMPLETED');
    if (completedDl) {
      const localBlob = await getOfflineMediaBlobUrl(dlId).catch(() => null);
      if (localBlob) {
        setOfflineUrl(localBlob.url);
        setLoadingStreams(false);
        showToast('Playing from offline download vault');
        return;
      }
    }

    try {
      const res = isSeries
        ? await resolveTvStreams({
            seriesId: decodedId,
            season,
            episode,
            title: titleParam || known?.title || undefined,
            isAnime: isAnimeParam,
            preferDub: settings.animeSubDubPreference === 'dub',
            animeFallback: settings.animeFallbackEnabled,
            vylaUrl: settings.vylaBaseUrl,
            preferredProvider: settings.playbackProviderPriority,
          })
        : await resolveMovieStreams(decodedId, settings.vylaBaseUrl, settings.playbackProviderPriority);

      setSources(res.sources);
      setSubtitles(res.subtitles);
      setDiagnostics(res.diagnostics || []);

      if (res.sources.length === 0) {
        setErrorMsg('No verified playback streams responded for this title right now. Try switching provider priority in Settings or retrying.');
      } else {
        const preferredIdx = preferSourceId
          ? Math.max(0, res.sources.findIndex((s) => s.id === preferSourceId))
          : 0;
        setActiveIndex(preferredIdx);
        if (res.subtitles.length > 0) setActiveSubtitleIdx(0);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Stream resolution failed');
    } finally {
      setLoadingStreams(false);
    }
  }, [
    decodedId,
    episodeParam,
    downloads,
    isSeries,
    season,
    episode,
    titleParam,
    known?.title,
    isAnimeParam,
    settings.animeSubDubPreference,
    settings.animeFallbackEnabled,
    settings.vylaBaseUrl,
    settings.playbackProviderPriority,
    preferSourceId,
    showToast,
  ]);

  useEffect(() => {
    void loadPlayback();
    return () => {
      if (offlineUrl) URL.revokeObjectURL(offlineUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decodedId, season, episode]);

  const failoverNextSource = useCallback(
    (reason: string) => {
      if (activeIndex + 1 < sources.length) {
        const nextIdx = activeIndex + 1;
        showToast(`${reason} — switching to ${sources[nextIdx].serverName}`);
        setActiveIndex(nextIdx);
      } else {
        setErrorMsg(`${reason}. All ${sources.length} verified sources exhausted.`);
      }
    },
    [activeIndex, sources, showToast]
  );

  // Attach hls.js or native <video> to activeSource / offlineUrl
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const playbackUrl = offlineUrl || activeSource?.proxyUrl || '';
    if (!playbackUrl) return;

    const saved = getProgressFor(decodedId, episodeParam);
    const startSec = saved && !saved.completed && saved.positionMs > 5000 ? saved.positionMs / 1000 : 0;

    const handleCanPlay = () => {
      if (startSec > 0 && video.currentTime < 2) {
        video.currentTime = startSec;
      }
      video.playbackRate = playbackRate;
      void video.play().catch(() => {});
    };

    const isHls = !offlineUrl && activeSource?.streamType === 'hls';
    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        fragLoadingTimeOut: 20_000,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 1000,
        manifestLoadingTimeOut: 15_000,
        manifestLoadingMaxRetry: 3,
      });
      hlsRef.current = hls;
      hls.loadSource(playbackUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, handleCanPlay);
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          hls.destroy();
          failoverNextSource('HLS stream interrupted');
        }
      });
    } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playbackUrl;
      video.addEventListener('loadedmetadata', handleCanPlay, { once: true });
    } else {
      video.src = playbackUrl;
      video.addEventListener('loadedmetadata', handleCanPlay, { once: true });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineUrl, activeSource?.proxyUrl]);

  // Persist watch progress every 10s & on unmount
  const persistProgress = useCallback(
    (forceCompleted = false) => {
      const video = videoRef.current;
      if (!video) return;
      const posMs = Math.floor(video.currentTime * 1000);
      const durMs = Math.floor((video.duration || 0) * 1000);
      if (posMs <= 0 && !forceCompleted) return;
      const completed = forceCompleted || (durMs > 0 && posMs >= durMs * 0.92);
      const progressKey = episodeParam ? `${decodedId}_${episodeParam}` : decodedId;
      saveWatchProgress({
        progressKey,
        contentId: decodedId,
        episodeId: episodeParam,
        contentType: isSeries ? 'EPISODE' : 'MOVIE',
        title,
        subtitle: subtitleText,
        posterUrl,
        positionMs: posMs,
        durationMs: durMs,
        completed,
      });
      recordViewingHistory({
        id: progressKey,
        contentId: decodedId,
        episodeId: episodeParam,
        contentType: isSeries ? 'EPISODE' : 'MOVIE',
        title,
        posterUrl,
        watchedSeconds: Math.floor(posMs / 1000),
        completed,
      });
    },
    [decodedId, episodeParam, isSeries, title, subtitleText, posterUrl, saveWatchProgress, recordViewingHistory]
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        persistProgress();
      }
    }, 10_000);
    return () => {
      window.clearInterval(interval);
      persistProgress();
    };
  }, [persistProgress]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else {
      v.pause();
      persistProgress();
    }
  };

  const seekBy = (deltaSec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + deltaSec));
  };

  const cycleRate = () => {
    const rates = [0.75, 1, 1.25, 1.5, 2];
    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    setPlaybackRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const activeSubTrack = useMemo(
    () => (activeSubtitleIdx >= 0 ? subtitles[activeSubtitleIdx] || null : null),
    [activeSubtitleIdx, subtitles]
  );

  return (
    <div ref={containerRef} className="flex min-h-screen flex-col bg-[#0A0A0C] text-white">
      {/* Top Overlay Header */}
      <header className="flex items-center justify-between border-b border-[#2A2A32] bg-[#141418]/90 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Exit player"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#2A2A32] bg-[#1F1F24] text-white hover:border-[#E50914]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="line-clamp-1 font-editorial text-base font-bold text-white sm:text-lg">
              {title}
            </h1>
            <p className="font-mono text-xs text-[#F2C94C]">
              {subtitleText}
              {offlineUrl
                ? ' • OFFLINE VAULT'
                : activeSource
                  ? ` • ${activeSource.serverName} (${activeSource.quality})`
                  : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerPanel(drawerPanel === 'sources' ? 'none' : 'sources')}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3 text-xs font-semibold text-white hover:border-[#F2C94C]"
          >
            <Server className="h-3.5 w-3.5 text-[#F2C94C]" />
            <span>Sources ({sources.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setDrawerPanel(drawerPanel === 'subtitles' ? 'none' : 'subtitles')}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3 text-xs font-semibold text-white hover:border-[#F2C94C]"
          >
            <Captions className="h-3.5 w-3.5 text-[#F2C94C]" />
            <span>Subs ({subtitles.length})</span>
          </button>

          {activeSource && !offlineUrl && (
            <>
              <button
                type="button"
                onClick={() =>
                  startDownload({
                    contentId: decodedId,
                    episodeId: episodeParam,
                    contentType: isSeries ? 'SERIES' : 'MOVIE',
                    title,
                    subtitle: subtitleText,
                    posterUrl,
                    source: activeSource,
                  })
                }
                aria-label="Save stream to offline vault"
                className="hidden min-h-[38px] items-center gap-1.5 rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3 text-xs font-semibold text-[#F2C94C] hover:border-[#F2C94C] sm:inline-flex"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Save Vault</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const dlHref = activeSource.downloadProxyUrl || activeSource.proxyUrl;
                  triggerFileDownload(dlHref, `${title}${isSeries ? `_S${season}E${episode}` : ''}.mp4`);
                  showToast('Starting MP4 download to device...');
                }}
                aria-label="Download MP4 file"
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3 text-xs font-semibold text-white hover:border-[#E50914]"
              >
                <Download className="h-3.5 w-3.5 text-[#E50914]" />
                <span>MP4</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Video Theater Stage */}
      <div className="relative flex flex-1 items-center justify-center bg-black">
        <video
          ref={videoRef}
          playsInline
          crossOrigin="anonymous"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(e) => setCurrentTimeMs(e.currentTarget.currentTime * 1000)}
          onLoadedMetadata={(e) => setDurationMs(e.currentTarget.duration * 1000)}
          onEnded={() => {
            persistProgress(true);
            if (isSeries && settings.autoPlayNextEpisode) {
              setSearchParams({
                season: String(season),
                episode: String(episode + 1),
                title,
                anime: isAnimeParam ? '1' : '0',
              });
            }
          }}
          onError={() => {
            if (!offlineUrl && sources.length > 0) {
              failoverNextSource('Playback decode error');
            }
          }}
          className={`max-h-[76vh] w-full ${isCover ? 'object-cover' : 'object-contain'}`}
        >
          {activeSubTrack && (
            <track
              kind="subtitles"
              src={activeSubTrack.proxyUrl}
              srcLang={activeSubTrack.language}
              label={activeSubTrack.label}
              default
            />
          )}
        </video>

        {loadingStreams && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-3 border-[#2A2A32] border-t-[#E50914]" />
            <p className="font-semibold text-white">Resolving & verifying stream sources...</p>
            <p className="text-xs text-[#9E9EA8]">
              Querying VidZee, X8RR Multi-Source & 123Anime through Node.js HLS Proxy
            </p>
          </div>
        )}

        {!loadingStreams && errorMsg && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center">
            <AlertTriangle className="h-10 w-10 text-[#F2C94C]" />
            <p className="max-w-md text-sm text-white">{errorMsg}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => void loadPlayback()}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[#E50914] px-5 text-xs font-semibold text-white"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Retry All Providers</span>
              </button>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="min-h-[42px] rounded-xl border border-[#2A2A32] bg-[#141418] px-5 text-xs font-semibold text-white"
              >
                Go Back
              </button>
            </div>
            {diagnostics.length > 0 && (
              <div className="mt-2 max-w-md rounded-xl border border-[#2A2A32] bg-[#141418] p-3 text-left font-mono text-[11px] text-[#9E9EA8]">
                {diagnostics.map((d) => (
                  <div key={d.provider}>
                    {d.provider}: {d.status} ({d.count} sources, {d.elapsedMs}ms)
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls Bar */}
      <div className="border-t border-[#2A2A32] bg-[#141418] px-4 py-3 lg:px-8">
        {/* Seekbar */}
        <div className="mb-3 flex items-center gap-3">
          <span className="font-mono text-xs text-[#9E9EA8]">{formatTimecode(currentTimeMs)}</span>
          <input
            type="range"
            aria-label="Seek timeline"
            min={0}
            max={Math.max(1000, durationMs)}
            value={Math.min(currentTimeMs, Math.max(1000, durationMs))}
            onChange={(e) => {
              const targetSec = Number(e.target.value) / 1000;
              if (videoRef.current) videoRef.current.currentTime = targetSec;
              setCurrentTimeMs(Number(e.target.value));
            }}
            className="h-1.5 flex-1 cursor-pointer accent-[#E50914]"
          />
          <span className="font-mono text-xs text-[#9E9EA8]">{formatTimecode(durationMs)}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E50914] text-white hover:bg-[#c80711]"
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-current" />}
            </button>
            <button
              type="button"
              onClick={() => seekBy(-10)}
              aria-label="Rewind 10 seconds"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#2A2A32] bg-[#1F1F24] text-white hover:border-[#F2C94C]"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => seekBy(10)}
              aria-label="Forward 10 seconds"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#2A2A32] bg-[#1F1F24] text-white hover:border-[#F2C94C]"
            >
              <RotateCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.muted = !videoRef.current.muted;
                  setIsMuted(videoRef.current.muted);
                }
              }}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#2A2A32] bg-[#1F1F24] text-white"
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cycleRate}
              className="min-h-[40px] rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3 font-mono text-xs font-semibold text-white"
            >
              {playbackRate}x
            </button>
            <button
              type="button"
              onClick={() => setIsCover((v) => !v)}
              className="min-h-[40px] rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3 text-xs font-semibold text-white"
            >
              {isCover ? 'Fit' : 'Zoom'}
            </button>
            {isSeries && (
              <button
                type="button"
                onClick={() =>
                  setSearchParams({
                    season: String(season),
                    episode: String(episode + 1),
                    title,
                    anime: isAnimeParam ? '1' : '0',
                  })
                }
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3 text-xs font-semibold text-[#F2C94C]"
              >
                <SkipForward className="h-3.5 w-3.5" />
                <span>Next Ep</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label="Toggle fullscreen"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#2A2A32] bg-[#1F1F24] text-white"
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Sources / Subtitles Drawer Overlay */}
      {drawerPanel !== 'none' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-[#2A2A32] bg-[#141418] p-5">
            <div className="mb-3 flex items-center justify-between border-b border-[#2A2A32] pb-2.5">
              <h2 className="font-editorial text-lg font-bold text-white">
                {drawerPanel === 'sources' ? 'Switch Stream Source' : 'Subtitles / Captions'}
              </h2>
              <button
                type="button"
                onClick={() => setDrawerPanel('none')}
                className="text-xs font-semibold text-[#9E9EA8] hover:text-white"
              >
                Done
              </button>
            </div>

            {drawerPanel === 'sources' ? (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {sources.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setActiveIndex(idx);
                      setErrorMsg(null);
                      setDrawerPanel('none');
                    }}
                    className={`flex w-full items-center justify-between rounded-xl border p-3 text-left text-xs ${
                      idx === activeIndex
                        ? 'border-[#E50914] bg-[#3E0A0E]/60 text-white'
                        : 'border-[#2A2A32] bg-[#1F1F24] text-[#9E9EA8] hover:text-white'
                    }`}
                  >
                    <div>
                      <p className="font-semibold text-white">{s.serverName}</p>
                      <p className="font-mono text-[11px]">
                        {s.quality} • {s.streamType.toUpperCase()} • {s.language}
                      </p>
                    </div>
                    {idx === activeIndex && <span className="font-mono text-[#F2C94C]">ACTIVE</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSubtitleIdx(-1);
                    setDrawerPanel('none');
                  }}
                  className={`w-full rounded-xl border p-3 text-left text-xs ${
                    activeSubtitleIdx === -1
                      ? 'border-[#E50914] bg-[#3E0A0E]/60 text-white'
                      : 'border-[#2A2A32] bg-[#1F1F24] text-[#9E9EA8]'
                  }`}
                >
                  Off (No Subtitles)
                </button>
                {subtitles.map((sub, idx) => (
                  <button
                    key={sub.url}
                    type="button"
                    onClick={() => {
                      setActiveSubtitleIdx(idx);
                      setDrawerPanel('none');
                    }}
                    className={`w-full rounded-xl border p-3 text-left text-xs ${
                      activeSubtitleIdx === idx
                        ? 'border-[#E50914] bg-[#3E0A0E]/60 text-white'
                        : 'border-[#2A2A32] bg-[#1F1F24] text-[#9E9EA8]'
                    }`}
                  >
                    {sub.label} ({sub.format.toUpperCase()})
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
