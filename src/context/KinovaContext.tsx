import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type {
  ContentType,
  DownloadRecord,
  KinovaAppSettings,
  MovieRecord,
  ResolvedStreamSource,
  SeriesRecord,
  TmdbHomeDiscovery,
  UserProfileRecord,
  ViewingHistoryRecord,
  WatchProgressRecord,
  WatchlistRecord,
} from '../types/kinova';
import { fetchHomeDiscovery } from '../services/api';
import {
  fetchCloudUserBundle,
  isFirebaseConfigured,
  removeWatchlistItemFromCloud,
  signInWithGoogle,
  signOutAccount,
  subscribeAuthState,
  syncViewingHistoryToCloud,
  syncWatchProgressToCloud,
  syncWatchlistItemToCloud,
  testFirestoreConnection,
  upsertCloudUserProfile,
} from '../services/firebase';
import {
  clearAllOfflineMediaBlobs,
  deleteOfflineMediaBlob,
  downloadStreamToOfflineStorage,
  estimateStorageQuota,
} from '../services/offlineStorage';

const STORAGE_KEYS = {
  settings: 'kinova_settings_v1',
  watchlist: 'kinova_watchlist_v1',
  progress: 'kinova_progress_v1',
  history: 'kinova_history_v1',
  downloads: 'kinova_downloads_v1',
  recentSearches: 'kinova_recent_searches_v1',
  guestProfile: 'kinova_guest_profile_v1',
};

const DEFAULT_SETTINGS: KinovaAppSettings = {
  onboardingCompleted: false,
  market: 'Kenya',
  preferredLanguage: 'English',
  preferredQuality: 'Auto',
  wifiOnlyStreaming: false,
  wifiOnlyDownloads: true,
  autoPlayNextEpisode: true,
  playbackProviderPriority: 'auto',
  animeSubDubPreference: 'sub',
  animeFallbackEnabled: true,
  vylaBaseUrl: '',
};

const DEFAULT_GUEST_PROFILE: UserProfileRecord = {
  userId: 'guest_local',
  isGuest: true,
  displayName: 'Guest Viewer',
  email: '',
  avatarUrl: '',
  market: 'Kenya',
  preferredLanguage: 'English',
  preferredQuality: 'Auto',
  wifiOnlyStreaming: false,
  wifiOnlyDownloads: true,
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota warnings on metadata keys
  }
}

interface KinovaContextValue {
  settings: KinovaAppSettings;
  updateSettings: (patch: Partial<KinovaAppSettings>) => void;
  profile: UserProfileRecord;
  updateProfile: (patch: Partial<UserProfileRecord>) => Promise<void>;
  firebaseAvailable: boolean;
  cloudConnected: boolean;
  signInGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  homeData: TmdbHomeDiscovery | null;
  homeLoading: boolean;
  homeError: string | null;
  refreshHome: () => Promise<void>;
  watchlist: WatchlistRecord[];
  isInWatchlist: (contentId: string) => boolean;
  toggleWatchlist: (item: {
    contentId: string;
    contentType: ContentType;
    title: string;
    posterUrl: string;
    releaseYear: number;
    genre: string;
    runtimeSeconds: number;
    isPlayable: boolean;
  }) => Promise<void>;
  watchProgress: WatchProgressRecord[];
  saveWatchProgress: (record: Omit<WatchProgressRecord, 'lastWatchedAtMillis'>) => void;
  getProgressFor: (contentId: string, episodeId?: string) => WatchProgressRecord | undefined;
  history: ViewingHistoryRecord[];
  recordViewingHistory: (entry: Omit<ViewingHistoryRecord, 'watchedAtMillis'>) => void;
  clearHistory: () => void;
  downloads: DownloadRecord[];
  startDownload: (params: {
    contentId: string;
    episodeId?: string;
    contentType: ContentType;
    title: string;
    subtitle: string;
    posterUrl: string;
    source: ResolvedStreamSource;
  }) => void;
  pauseDownload: (downloadId: string) => void;
  retryDownload: (downloadId: string) => void;
  deleteDownload: (downloadId: string) => Promise<void>;
  deleteAllDownloads: () => Promise<void>;
  storageQuota: { usedBytes: number; quotaBytes: number };
  refreshStorageQuota: () => Promise<void>;
  recentSearches: string[];
  addRecentSearch: (q: string) => void;
  clearRecentSearches: () => void;
  toastMessage: string | null;
  showToast: (msg: string) => void;
  knownContentById: (id: string) => MovieRecord | SeriesRecord | undefined;
}

const KinovaContext = createContext<KinovaContextValue | null>(null);

export const KinovaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<KinovaAppSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...readStorage<Partial<KinovaAppSettings>>(STORAGE_KEYS.settings, {}),
  }));

  const [profile, setProfile] = useState<UserProfileRecord>(() => ({
    ...DEFAULT_GUEST_PROFILE,
    ...readStorage<Partial<UserProfileRecord>>(STORAGE_KEYS.guestProfile, {}),
  }));

  const [cloudConnected, setCloudConnected] = useState(false);
  const [homeData, setHomeData] = useState<TmdbHomeDiscovery | null>(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState<string | null>(null);

  const [watchlist, setWatchlist] = useState<WatchlistRecord[]>(() =>
    readStorage<WatchlistRecord[]>(STORAGE_KEYS.watchlist, [])
  );
  const [watchProgress, setWatchProgress] = useState<WatchProgressRecord[]>(() =>
    readStorage<WatchProgressRecord[]>(STORAGE_KEYS.progress, [])
  );
  const [history, setHistory] = useState<ViewingHistoryRecord[]>(() =>
    readStorage<ViewingHistoryRecord[]>(STORAGE_KEYS.history, [])
  );
  const [downloads, setDownloads] = useState<DownloadRecord[]>(() => {
    const saved = readStorage<DownloadRecord[]>(STORAGE_KEYS.downloads, []);
    // Reset interrupted active downloads on reload to PAUSED so user can resume cleanly
    return saved.map((d) =>
      d.status === 'DOWNLOADING' || d.status === 'QUEUED' ? { ...d, status: 'PAUSED' as const } : d
    );
  });
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    readStorage<string[]>(STORAGE_KEYS.recentSearches, [])
  );
  const [storageQuota, setStorageQuota] = useState({ usedBytes: 0, quotaBytes: 0 });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const activeControllers = useRef<Map<string, AbortController>>(new Map());
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const refreshStorageQuota = useCallback(async () => {
    const est = await estimateStorageQuota();
    setStorageQuota(est);
  }, []);

  const refreshHome = useCallback(async () => {
    setHomeLoading(true);
    setHomeError(null);
    try {
      const data = await fetchHomeDiscovery();
      setHomeData(data);
    } catch (err) {
      setHomeError(err instanceof Error ? err.message : 'Unable to sync catalog.');
    } finally {
      setHomeLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHome();
    void refreshStorageQuota();
  }, [refreshHome, refreshStorageQuota]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.settings, settings);
  }, [settings]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.watchlist, watchlist);
  }, [watchlist]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.progress, watchProgress);
  }, [watchProgress]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.history, history);
  }, [history]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.downloads, downloads);
  }, [downloads]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.recentSearches, recentSearches);
  }, [recentSearches]);

  // Firebase Auth & Cloud Sync Subscription
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    void testFirestoreConnection().then(setCloudConnected);
    const unsubscribe = subscribeAuthState(async (user) => {
      if (!user) {
        setProfile({
          ...DEFAULT_GUEST_PROFILE,
          ...readStorage<Partial<UserProfileRecord>>(STORAGE_KEYS.guestProfile, {}),
        });
        return;
      }
      const nextProfile: UserProfileRecord = {
        userId: user.uid,
        isGuest: false,
        displayName: user.displayName || 'KINOVA Viewer',
        email: user.email || '',
        avatarUrl: user.photoURL || '',
        market: settings.market,
        preferredLanguage: settings.preferredLanguage,
        preferredQuality: settings.preferredQuality,
        wifiOnlyStreaming: settings.wifiOnlyStreaming,
        wifiOnlyDownloads: settings.wifiOnlyDownloads,
      };
      setProfile(nextProfile);
      try {
        await upsertCloudUserProfile(nextProfile);
        const cloud = await fetchCloudUserBundle();
        if (cloud.profile) {
          setProfile((prev) => ({ ...prev, ...cloud.profile, isGuest: false }));
        }
        // Merge guest watchlist/progress with cloud
        const mergedWl = [...cloud.watchlist];
        for (const localItem of watchlist) {
          if (!mergedWl.some((w) => w.contentId === localItem.contentId)) {
            mergedWl.push(localItem);
            void syncWatchlistItemToCloud(localItem);
          }
        }
        setWatchlist(mergedWl);

        const mergedProg = [...cloud.progress];
        for (const p of watchProgress) {
          if (!mergedProg.some((cp) => cp.progressKey === p.progressKey)) {
            mergedProg.push(p);
            void syncWatchProgressToCloud(p);
          }
        }
        setWatchProgress(mergedProg);
      } catch {
        // Handled cleanly inside firebase.ts error wrapper
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSettings = useCallback((patch: Partial<KinovaAppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setProfile((prev) => {
      const updated = {
        ...prev,
        market: patch.market ?? prev.market,
        preferredLanguage: patch.preferredLanguage ?? prev.preferredLanguage,
        preferredQuality: patch.preferredQuality ?? prev.preferredQuality,
        wifiOnlyStreaming: patch.wifiOnlyStreaming ?? prev.wifiOnlyStreaming,
        wifiOnlyDownloads: patch.wifiOnlyDownloads ?? prev.wifiOnlyDownloads,
      };
      if (prev.isGuest) writeStorage(STORAGE_KEYS.guestProfile, updated);
      else void upsertCloudUserProfile(updated).catch(() => {});
      return updated;
    });
  }, []);

  const updateProfile = useCallback(async (patch: Partial<UserProfileRecord>) => {
    let nextProf: UserProfileRecord | null = null;
    setProfile((prev) => {
      nextProf = { ...prev, ...patch };
      if (nextProf.isGuest) writeStorage(STORAGE_KEYS.guestProfile, nextProf);
      return nextProf;
    });
    if (nextProf && !(nextProf as UserProfileRecord).isGuest) {
      await upsertCloudUserProfile(nextProf);
    }
    showToast('Viewer profile updated');
  }, [showToast]);

  const signInGoogle = useCallback(async () => {
    await signInWithGoogle();
    showToast('Signed in to KINOVA Cloud');
  }, [showToast]);

  const signOutUser = useCallback(async () => {
    await signOutAccount();
    setProfile({
      ...DEFAULT_GUEST_PROFILE,
      ...readStorage<Partial<UserProfileRecord>>(STORAGE_KEYS.guestProfile, {}),
    });
    showToast('Signed out — continuing in Guest Mode');
  }, [showToast]);

  const isInWatchlist = useCallback(
    (contentId: string) => watchlist.some((w) => w.contentId === contentId),
    [watchlist]
  );

  const toggleWatchlist = useCallback(
    async (item: {
      contentId: string;
      contentType: ContentType;
      title: string;
      posterUrl: string;
      releaseYear: number;
      genre: string;
      runtimeSeconds: number;
      isPlayable: boolean;
    }) => {
      const exists = watchlist.some((w) => w.contentId === item.contentId);
      if (exists) {
        setWatchlist((prev) => prev.filter((w) => w.contentId !== item.contentId));
        if (!profile.isGuest) {
          void removeWatchlistItemFromCloud(item.contentId).catch(() => {});
        }
        showToast(`Removed "${item.title}" from My List`);
      } else {
        const record: WatchlistRecord = {
          ...item,
          addedAtMillis: Date.now(),
        };
        setWatchlist((prev) => [record, ...prev]);
        if (!profile.isGuest) {
          void syncWatchlistItemToCloud(record).catch(() => {});
        }
        showToast(`Saved "${item.title}" to My List`);
      }
    },
    [watchlist, profile.isGuest, showToast]
  );

  const saveWatchProgress = useCallback(
    (record: Omit<WatchProgressRecord, 'lastWatchedAtMillis'>) => {
      const full: WatchProgressRecord = {
        ...record,
        lastWatchedAtMillis: Date.now(),
      };
      setWatchProgress((prev) => {
        const filtered = prev.filter((p) => p.progressKey !== full.progressKey);
        return [full, ...filtered].slice(0, 60);
      });
      if (!profile.isGuest) {
        void syncWatchProgressToCloud(full).catch(() => {});
      }
    },
    [profile.isGuest]
  );

  const getProgressFor = useCallback(
    (contentId: string, episodeId = '') =>
      watchProgress.find((p) => p.contentId === contentId && (episodeId ? p.episodeId === episodeId : true)),
    [watchProgress]
  );

  const recordViewingHistory = useCallback(
    (entry: Omit<ViewingHistoryRecord, 'watchedAtMillis'>) => {
      const full: ViewingHistoryRecord = {
        ...entry,
        watchedAtMillis: Date.now(),
      };
      setHistory((prev) => {
        const filtered = prev.filter((h) => h.id !== full.id);
        return [full, ...filtered].slice(0, 100);
      });
      if (!profile.isGuest) {
        void syncViewingHistoryToCloud(full).catch(() => {});
      }
    },
    [profile.isGuest]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    showToast('Viewing history cleared');
  }, [showToast]);

  const executeDownloadTask = useCallback(
    async (record: DownloadRecord, proxyUrl: string) => {
      const existingCtrl = activeControllers.current.get(record.id);
      if (existingCtrl) existingCtrl.abort();
      const ctrl = new AbortController();
      activeControllers.current.set(record.id, ctrl);

      setDownloads((prev) =>
        prev.map((d) =>
          d.id === record.id
            ? { ...d, status: 'DOWNLOADING', errorMessage: '', updatedAtMillis: Date.now() }
            : d
        )
      );

      try {
        const { totalBytes } = await downloadStreamToOfflineStorage({
          record,
          proxyUrl,
          signal: ctrl.signal,
          onProgress: (downloadedBytes, total) => {
            setDownloads((prev) =>
              prev.map((d) =>
                d.id === record.id
                  ? {
                      ...d,
                      downloadedBytes,
                      totalBytes: total || downloadedBytes,
                      status: 'DOWNLOADING',
                      updatedAtMillis: Date.now(),
                    }
                  : d
              )
            );
          },
        });

        setDownloads((prev) =>
          prev.map((d) =>
            d.id === record.id
              ? {
                  ...d,
                  downloadedBytes: totalBytes,
                  totalBytes,
                  status: 'COMPLETED',
                  updatedAtMillis: Date.now(),
                }
              : d
          )
        );
        void refreshStorageQuota();
        showToast(`Downloaded "${record.title}" for offline playback`);
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        setDownloads((prev) =>
          prev.map((d) =>
            d.id === record.id
              ? {
                  ...d,
                  status: isAbort ? 'PAUSED' : 'FAILED',
                  errorMessage: isAbort
                    ? 'Download paused'
                    : err instanceof Error
                      ? err.message
                      : 'Download failed',
                  updatedAtMillis: Date.now(),
                }
              : d
          )
        );
      } finally {
        activeControllers.current.delete(record.id);
      }
    },
    [refreshStorageQuota, showToast]
  );

  const startDownload = useCallback(
    (params: {
      contentId: string;
      episodeId?: string;
      contentType: ContentType;
      title: string;
      subtitle: string;
      posterUrl: string;
      source: ResolvedStreamSource;
    }) => {
      const id = params.episodeId
        ? `${params.contentId}__${params.episodeId}`
        : params.contentId;
      const proxyUrl = params.source.downloadProxyUrl || params.source.proxyUrl;
      const record: DownloadRecord = {
        id,
        contentId: params.contentId,
        episodeId: params.episodeId || '',
        contentType: params.contentType,
        title: params.title,
        subtitle: params.subtitle,
        posterUrl: params.posterUrl,
        remoteUrl: proxyUrl,
        streamType: params.source.streamType,
        quality: params.source.quality || 'HD',
        totalBytes: 0,
        downloadedBytes: 0,
        status: 'QUEUED',
        updatedAtMillis: Date.now(),
      };
      setDownloads((prev) => [record, ...prev.filter((d) => d.id !== id)]);
      showToast(`Queued "${params.title}" for offline download`);
      void executeDownloadTask(record, proxyUrl);
    },
    [executeDownloadTask, showToast]
  );

  const pauseDownload = useCallback((downloadId: string) => {
    const ctrl = activeControllers.current.get(downloadId);
    if (ctrl) ctrl.abort();
    setDownloads((prev) =>
      prev.map((d) => (d.id === downloadId ? { ...d, status: 'PAUSED', updatedAtMillis: Date.now() } : d))
    );
  }, []);

  const retryDownload = useCallback(
    (downloadId: string) => {
      const target = downloads.find((d) => d.id === downloadId);
      if (!target) return;
      void executeDownloadTask(target, target.remoteUrl);
    },
    [downloads, executeDownloadTask]
  );

  const deleteDownload = useCallback(
    async (downloadId: string) => {
      const ctrl = activeControllers.current.get(downloadId);
      if (ctrl) ctrl.abort();
      await deleteOfflineMediaBlob(downloadId).catch(() => {});
      setDownloads((prev) => prev.filter((d) => d.id !== downloadId));
      void refreshStorageQuota();
      showToast('Offline download removed');
    },
    [refreshStorageQuota, showToast]
  );

  const deleteAllDownloads = useCallback(async () => {
    for (const ctrl of activeControllers.current.values()) {
      ctrl.abort();
    }
    activeControllers.current.clear();
    await clearAllOfflineMediaBlobs().catch(() => {});
    setDownloads([]);
    void refreshStorageQuota();
    showToast('All offline downloads cleared');
  }, [refreshStorageQuota, showToast]);

  const addRecentSearch = useCallback((q: string) => {
    const clean = q.trim();
    if (!clean) return;
    setRecentSearches((prev) => [clean, ...prev.filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, 10));
  }, []);

  const clearRecentSearches = useCallback(() => setRecentSearches([]), []);

  const knownContentById = useCallback(
    (id: string) => {
      if (!homeData) return undefined;
      const all = [
        ...homeData.trendingMovies,
        ...homeData.latestMovieReleases,
        ...homeData.popularMovies,
        ...homeData.actionMovies,
        ...homeData.comedyMovies,
        ...homeData.romanceMovies,
        ...homeData.thrillerMovies,
        ...homeData.horrorMovies,
        ...homeData.africanCinema,
        ...homeData.nollywood,
        ...homeData.bollywood,
        ...homeData.recommendedMovies,
        ...homeData.popularSeries,
        ...homeData.trendingSeries,
        ...homeData.latestTvReleases,
        ...homeData.popularAnime,
      ];
      return all.find((x) => x.id === id);
    },
    [homeData]
  );

  return (
    <KinovaContext.Provider
      value={{
        settings,
        updateSettings,
        profile,
        updateProfile,
        firebaseAvailable: isFirebaseConfigured,
        cloudConnected,
        signInGoogle,
        signOutUser,
        homeData,
        homeLoading,
        homeError,
        refreshHome,
        watchlist,
        isInWatchlist,
        toggleWatchlist,
        watchProgress,
        saveWatchProgress,
        getProgressFor,
        history,
        recordViewingHistory,
        clearHistory,
        downloads,
        startDownload,
        pauseDownload,
        retryDownload,
        deleteDownload,
        deleteAllDownloads,
        storageQuota,
        refreshStorageQuota,
        recentSearches,
        addRecentSearch,
        clearRecentSearches,
        toastMessage,
        showToast,
        knownContentById,
      }}
    >
      {children}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-[#2A2A32] bg-[#1F1F24]/95 px-5 py-3 text-sm font-medium text-white shadow-2xl backdrop-blur-md md:bottom-8"
        >
          {toastMessage}
        </div>
      )}
    </KinovaContext.Provider>
  );
};

export function useKinova() {
  const ctx = useContext(KinovaContext);
  if (!ctx) throw new Error('useKinova must be used inside KinovaProvider');
  return ctx;
}
