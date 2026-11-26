import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bookmark,
  CheckCircle2,
  Clock,
  Download,
  HardDrive,
  History,
  Pause,
  Play,
  RotateCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { KinovaPosterImage, MediaGridCard } from '../components/KinovaComponents';
import { useKinova } from '../context/KinovaContext';
import { exportOfflineBlobToDevice } from '../services/offlineStorage';
import { formatBytes, formatTimecode } from '../types/kinova';

export const DownloadsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    downloads,
    pauseDownload,
    retryDownload,
    deleteDownload,
    deleteAllDownloads,
    storageQuota,
    homeData,
  } = useKinova();

  const totalStored = downloads.reduce((acc, d) => acc + (d.status === 'COMPLETED' ? d.totalBytes : 0), 0);
  const completedCount = downloads.filter((d) => d.status === 'COMPLETED').length;

  return (
    <div className="space-y-6 px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-editorial text-2xl font-bold text-white sm:text-3xl">Offline Downloads</h1>
          <p className="text-sm text-[#9E9EA8]">
            Saved locally in your browser&apos;s IndexedDB Offline Vault for instant playback
          </p>
        </div>
        {downloads.length > 0 && (
          <button
            type="button"
            onClick={() => void deleteAllDownloads()}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-[#FF5A5F]/40 bg-[#3D1A1E]/40 px-4 text-xs font-semibold text-[#FF5A5F] hover:bg-[#3D1A1E]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete All</span>
          </button>
        )}
      </div>

      {/* Storage Meter Card */}
      <div className="rounded-2xl border border-[#2A2A32] bg-[#141418] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1F1F24] text-[#F2C94C]">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">KINOVA Offline Storage</p>
              <p className="font-mono text-xs text-[#9E9EA8]">
                {completedCount} completed • {formatBytes(totalStored)} in vault
                {storageQuota.quotaBytes > 0
                  ? ` (${formatBytes(storageQuota.usedBytes)} / ${formatBytes(storageQuota.quotaBytes)} browser quota)`
                  : ''}
              </p>
            </div>
          </div>
          <span className="rounded-lg border border-[#F2C94C]/30 bg-[#3A2D14]/50 px-3 py-1 font-mono text-xs text-[#F2C94C]">
            MP4 &amp; HLS Ready
          </span>
        </div>
      </div>

      {/* Download Queue / Items */}
      {downloads.length === 0 ? (
        <div className="rounded-2xl border border-[#2A2A32] bg-[#141418] p-8 text-center">
          <Download className="mx-auto mb-3 h-9 w-9 text-[#9E9EA8]" />
          <p className="font-semibold text-white">No offline downloads yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[#9E9EA8]">
            Open any movie, series episode, or anime and click &ldquo;Download / Sources&rdquo; or &ldquo;Save Offline&rdquo; in the player.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {downloads.map((d) => {
            const pct =
              d.totalBytes > 0 ? Math.min(100, Math.round((d.downloadedBytes / d.totalBytes) * 100)) : 0;
            const playUrl = d.episodeId
              ? `/player/${encodeURIComponent(d.contentId)}?episodeId=${encodeURIComponent(d.episodeId)}&title=${encodeURIComponent(d.title)}`
              : `/player/${encodeURIComponent(d.contentId)}`;
            return (
              <div
                key={d.id}
                className="flex flex-col gap-4 rounded-2xl border border-[#2A2A32] bg-[#141418] p-4 sm:flex-row sm:items-center"
              >
                <div className="w-24 shrink-0 overflow-hidden rounded-xl bg-[#1F1F24]">
                  <KinovaPosterImage src={d.posterUrl} title={d.title} />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-semibold text-white">{d.title}</h3>
                    <span className="rounded bg-[#1F1F24] px-2 py-0.5 font-mono text-[10px] text-[#F2C94C]">
                      {d.quality}
                    </span>
                  </div>
                  <p className="text-xs text-[#9E9EA8]">{d.subtitle}</p>

                  {d.status === 'DOWNLOADING' || d.status === 'QUEUED' ? (
                    <div className="space-y-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-[#1F1F24]">
                        <div className="h-full bg-[#E50914] transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="font-mono text-[11px] text-[#9E9EA8]">
                        {pct}% • {formatBytes(d.downloadedBytes)} / {formatBytes(d.totalBytes)}
                      </p>
                    </div>
                  ) : d.status === 'COMPLETED' ? (
                    <p className="inline-flex items-center gap-1.5 font-mono text-xs text-[#4ADE80]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Ready Offline • {formatBytes(d.totalBytes)}</span>
                    </p>
                  ) : (
                    <p className="inline-flex items-center gap-1.5 font-mono text-xs text-[#FF5A5F]">
                      <XCircle className="h-3.5 w-3.5" />
                      <span>{d.errorMessage || d.status}</span>
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {d.status === 'COMPLETED' && (
                    <>
                      <button
                        type="button"
                        onClick={() => navigate(playUrl)}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#E50914] px-4 text-xs font-semibold text-white hover:bg-[#c80711]"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                        <span>Play</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportOfflineBlobToDevice(d.id, `${d.title}.mp4`)}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3 text-xs font-semibold text-[#F2C94C] hover:border-[#F2C94C]"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Export MP4</span>
                      </button>
                    </>
                  )}
                  {(d.status === 'DOWNLOADING' || d.status === 'QUEUED') && (
                    <button
                      type="button"
                      onClick={() => pauseDownload(d.id)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3 text-xs font-semibold text-white"
                    >
                      <Pause className="h-3.5 w-3.5" />
                      <span>Pause</span>
                    </button>
                  )}
                  {(d.status === 'PAUSED' || d.status === 'FAILED') && (
                    <button
                      type="button"
                      onClick={() => retryDownload(d.id)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3 text-xs font-semibold text-[#F2C94C]"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      <span>Resume</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void deleteDownload(d.id)}
                    aria-label="Delete download"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#2A2A32] bg-[#1F1F24] text-[#9E9EA8] hover:text-[#FF5A5F]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Popular to Download */}
      {homeData && homeData.popularMovies.length > 0 && (
        <section className="space-y-3 pt-4">
          <h2 className="font-editorial text-xl font-bold text-white">Popular to Save Offline</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {homeData.popularMovies.slice(0, 6).map((m) => (
              <MediaGridCard
                key={m.id}
                id={m.id}
                type="movie"
                title={m.title}
                posterUrl={m.posterUrl || m.thumbnailUrl}
                year={m.releaseYear}
                rating={m.rating}
                genre={m.genres?.[0]}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export const MyListPage: React.FC = () => {
  const [tab, setTab] = useState<'saved' | 'continue' | 'downloads' | 'history'>('saved');
  const {
    profile,
    watchlist,
    toggleWatchlist,
    watchProgress,
    downloads,
    history,
    clearHistory,
    firebaseAvailable,
  } = useKinova();

  return (
    <div className="space-y-6 px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-editorial text-2xl font-bold text-white sm:text-3xl">My Library</h1>
          <p className="text-sm text-[#9E9EA8]">
            Saved titles, playback progress, offline downloads &amp; viewing history
          </p>
        </div>
      </div>

      {/* Guest Sync Banner */}
      {profile.isGuest && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#2A2A32] bg-[#141418] p-4">
          <div>
            <p className="text-sm font-semibold text-white">Local Guest Library Active</p>
            <p className="text-xs text-[#9E9EA8]">
              {firebaseAvailable
                ? 'Sign in with Google to sync your My List and resume positions across devices.'
                : 'Your library and progress are safely stored in your browser.'}
            </p>
          </div>
          {firebaseAvailable && (
            <Link
              to="/signin"
              className="inline-flex min-h-[40px] items-center rounded-xl bg-[#E50914] px-4 text-xs font-semibold text-white"
            >
              Sign In to Sync
            </Link>
          )}
        </div>
      )}

      {/* 4 Tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'saved', label: `Saved (${watchlist.length})`, icon: Bookmark },
          { id: 'continue', label: `Continue (${watchProgress.length})`, icon: Clock },
          { id: 'downloads', label: `Downloads (${downloads.length})`, icon: Download },
          { id: 'history', label: `History (${history.length})`, icon: History },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as typeof tab)}
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl border px-4 text-xs font-semibold transition-colors ${
                tab === t.id
                  ? 'border-[#E50914] bg-[#E50914] text-white'
                  : 'border-[#2A2A32] bg-[#141418] text-[#9E9EA8] hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === 'saved' && (
        <>
          {watchlist.length === 0 ? (
            <div className="rounded-2xl border border-[#2A2A32] bg-[#141418] p-8 text-center text-sm text-[#9E9EA8]">
              Your My List is empty. Tap &ldquo;My List&rdquo; on any movie or series to save it here.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {watchlist.map((item) => (
                <div key={item.contentId} className="space-y-2">
                  <MediaGridCard
                    id={item.contentId}
                    type={item.contentType === 'MOVIE' ? 'movie' : 'tv'}
                    title={item.title}
                    posterUrl={item.posterUrl}
                    year={item.releaseYear}
                    genre={item.genre}
                  />
                  <button
                    type="button"
                    onClick={() => void toggleWatchlist(item)}
                    className="w-full rounded-lg border border-[#2A2A32] bg-[#141418] py-1.5 text-[11px] font-medium text-[#9E9EA8] hover:text-[#FF5A5F]"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'continue' && (
        <div className="space-y-3">
          {watchProgress.length === 0 ? (
            <div className="rounded-2xl border border-[#2A2A32] bg-[#141418] p-8 text-center text-sm text-[#9E9EA8]">
              Start watching any movie or episode to resume right where you left off.
            </div>
          ) : (
            watchProgress.map((wp) => (
              <Link
                key={wp.progressKey}
                to={
                  wp.episodeId
                    ? `/player/${encodeURIComponent(wp.contentId)}?episodeId=${encodeURIComponent(wp.episodeId)}`
                    : `/player/${encodeURIComponent(wp.contentId)}`
                }
                className="flex items-center gap-4 rounded-2xl border border-[#2A2A32] bg-[#141418] p-3.5 hover:border-[#E50914]"
              >
                <div className="w-24 shrink-0 overflow-hidden rounded-xl">
                  <KinovaPosterImage src={wp.posterUrl} title={wp.title} aspectClass="aspect-video" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">{wp.title}</p>
                  <p className="text-xs text-[#9E9EA8]">{wp.subtitle}</p>
                  <p className="mt-1 font-mono text-[11px] text-[#F2C94C]">
                    {formatTimecode(wp.positionMs)} / {formatTimecode(wp.durationMs)}
                  </p>
                </div>
                <Play className="h-5 w-5 shrink-0 text-[#E50914]" />
              </Link>
            ))
          )}
        </div>
      )}

      {tab === 'downloads' && (
        <div className="space-y-3">
          <Link
            to="/downloads"
            className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[#E50914] px-5 text-xs font-semibold text-white"
          >
            <Download className="h-4 w-4" />
            <span>Open Full Downloads Hub ({downloads.length})</span>
          </Link>
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-3">
          {history.length > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={clearHistory}
                className="inline-flex items-center gap-1.5 text-xs text-[#9E9EA8] hover:text-[#FF5A5F]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear History</span>
              </button>
            </div>
          )}
          {history.length === 0 ? (
            <div className="rounded-2xl border border-[#2A2A32] bg-[#141418] p-8 text-center text-sm text-[#9E9EA8]">
              No viewing history recorded yet.
            </div>
          ) : (
            history.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-[#2A2A32] bg-[#141418] p-3.5"
              >
                <div className="flex items-center gap-3">
                  <div className="w-14 shrink-0 overflow-hidden rounded-lg">
                    <KinovaPosterImage src={h.posterUrl} title={h.title} />
                  </div>
                  <div>
                    <p className="font-semibold text-white">{h.title}</p>
                    <p className="font-mono text-xs text-[#9E9EA8]">
                      Watched {Math.max(1, Math.floor(h.watchedSeconds / 60))}m •{' '}
                      {new Date(h.watchedAtMillis).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Link
                  to={`/player/${encodeURIComponent(h.contentId)}`}
                  className="rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3.5 py-2 text-xs font-semibold text-white hover:border-[#E50914]"
                >
                  Watch Again
                </Link>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
