import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
} from 'lucide-react';
import { KinovaPosterImage, MediaGridCard } from '../components/KinovaComponents';
import { useKinova } from '../context/KinovaContext';
import type { MovieRecord, SeriesRecord } from '../types/kinova';

const CarouselRow: React.FC<{
  title: string;
  accent?: string;
  items: Array<MovieRecord | SeriesRecord>;
  type: 'movie' | 'tv';
  seeAllTo?: string;
}> = ({ title, accent, items, type, seeAllTo }) => {
  if (!items || items.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-4 lg:px-8">
        <div className="flex items-center gap-2.5">
          <span className="h-5 w-1 rounded-full bg-[#E50914]" />
          <h2 className="font-editorial text-lg font-bold text-white sm:text-xl">{title}</h2>
          {accent && (
            <span className="hidden rounded border border-[#F2C94C]/35 bg-[#3A2D14]/60 px-2 py-0.5 font-mono text-[10px] tracking-wider text-[#F2C94C] uppercase sm:inline-block">
              {accent}
            </span>
          )}
        </div>
        {seeAllTo && (
          <Link
            to={seeAllTo}
            className="text-xs font-semibold tracking-wider text-[#F2C94C] uppercase hover:underline"
          >
            Browse All
          </Link>
        )}
      </div>

      <div className="kinova-scroll flex gap-3.5 overflow-x-auto px-4 pb-2 lg:px-8">
        {items.map((item) => (
          <div key={item.id} className="w-36 shrink-0 sm:w-44">
            <MediaGridCard
              id={item.id}
              type={type}
              title={item.title}
              posterUrl={item.posterUrl || item.thumbnailUrl}
              year={item.releaseYear}
              rating={item.rating}
              genre={item.genres?.[0]}
            />
          </div>
        ))}
      </div>
    </section>
  );
};

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const {
    homeData,
    homeLoading,
    homeError,
    refreshHome,
    watchProgress,
    isInWatchlist,
    toggleWatchlist,
  } = useKinova();

  const [heroIndex, setHeroIndex] = useState(0);

  const heroItems = useMemo(() => {
    if (!homeData) return [];
    const mixed: Array<{ item: MovieRecord | SeriesRecord; type: 'movie' | 'tv' }> = [];
    for (const m of homeData.trendingMovies.slice(0, 4)) mixed.push({ item: m, type: 'movie' });
    for (const s of homeData.trendingSeries.slice(0, 2)) mixed.push({ item: s, type: 'tv' });
    for (const a of homeData.popularAnime.slice(0, 2)) mixed.push({ item: a, type: 'tv' });
    return mixed.slice(0, 6);
  }, [homeData]);

  useEffect(() => {
    if (heroItems.length <= 1) return;
    const t = window.setInterval(() => {
      setHeroIndex((i) => (i + 1) % heroItems.length);
    }, 7000);
    return () => window.clearInterval(t);
  }, [heroItems.length]);

  const activeHero = heroItems[heroIndex % Math.max(1, heroItems.length)];
  const activeContinue = watchProgress.filter((w) => !w.completed && w.positionMs > 0);

  return (
    <div className="space-y-8 pb-12">
      {/* Quick Category Strip */}
      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto border-b border-[#2A2A32]/60 bg-[#0A0A0C] px-4 py-3 lg:px-8">
        {[
          { label: 'All Discovery', to: '/' },
          { label: 'Movies', to: '/movies' },
          { label: 'TV Series', to: '/series' },
          { label: 'Anime (123Anime)', to: '/search?tab=anime' },
          { label: 'Offline Vault', to: '/downloads' },
          { label: 'My List', to: '/my-list' },
        ].map((chip, idx) => (
          <Link
            key={chip.label}
            to={chip.to}
            className={`min-h-[38px] shrink-0 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors ${
              idx === 0
                ? 'border-[#E50914] bg-[#E50914] text-white'
                : 'border-[#2A2A32] bg-[#141418] text-[#9E9EA8] hover:border-[#F2C94C]/50 hover:text-white'
            }`}
          >
            {chip.label}
          </Link>
        ))}
      </div>

      {/* Notice if TMDB_API_KEY is not set in server env */}
      {homeData && !homeData.tmdbConfigured && (
        <div className="mx-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#F2C94C]/40 bg-[#3A2D14]/40 px-4 py-3 text-sm lg:mx-8">
          <div className="flex items-center gap-2.5 text-[#FFE5B4]">
            <Sparkles className="h-4 w-4 shrink-0 text-[#F2C94C]" />
            <span>
              Showing public cinema, TVMaze & live 123Anime catalog. Set <code className="font-mono text-[#F2C94C]">TMDB_API_KEY</code> on the server to unlock all 15 TMDB discovery rows and VidZee movie lookup.
            </span>
          </div>
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#F2C94C]/40 bg-[#141418] px-3 py-1.5 text-xs font-semibold text-[#F2C94C] hover:bg-[#1F1F24]"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>Diagnostics</span>
          </Link>
        </div>
      )}

      {/* Loading / Error State */}
      {homeLoading && !homeData && (
        <div className="space-y-6 px-4 lg:px-8">
          <div className="h-80 w-full animate-pulse rounded-2xl bg-[#141418]" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="aspect-[2/3] animate-pulse rounded-xl bg-[#141418]" />
            ))}
          </div>
        </div>
      )}

      {homeError && !homeData && (
        <div className="mx-4 rounded-2xl border border-[#FF5A5F]/40 bg-[#3D1A1E]/40 p-6 text-center lg:mx-8">
          <p className="font-semibold text-white">{homeError}</p>
          <button
            type="button"
            onClick={() => void refreshHome()}
            className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#E50914] px-5 py-2.5 text-sm font-semibold text-white"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Retry Sync</span>
          </button>
        </div>
      )}

      {/* Hero Trending Banner */}
      {activeHero && (
        <section className="relative mx-4 overflow-hidden rounded-2xl border border-[#2A2A32] bg-[#141418] lg:mx-8">
          <div className="relative h-[380px] w-full sm:h-[460px]">
            <KinovaPosterImage
              src={activeHero.item.backdropUrl || activeHero.item.posterUrl}
              title={activeHero.item.title}
              aspectClass="h-full w-full"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0C] via-[#0A0A0C]/60 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0C] via-[#0A0A0C]/55 to-transparent" />

            <div className="absolute inset-x-0 bottom-0 flex flex-col justify-end p-6 sm:p-10">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span className="rounded bg-[#E50914] px-2 py-0.5 tracking-wider text-white uppercase">
                  Trending
                </span>
                <span className="font-mono text-[#F2C94C]">
                  {activeHero.type === 'movie' ? 'FEATURE FILM' : 'SERIES'}
                  {activeHero.item.releaseYear ? ` • ${activeHero.item.releaseYear}` : ''}
                </span>
                {activeHero.item.rating > 0 && (
                  <span className="font-mono text-white">★ {activeHero.item.rating.toFixed(1)}</span>
                )}
              </div>

              <h1 className="max-w-2xl font-editorial text-2xl font-bold leading-tight text-white sm:text-4xl">
                {activeHero.item.title}
              </h1>
              <p className="mt-2 line-clamp-2 max-w-xl text-sm text-[#9E9EA8] sm:text-base">
                {activeHero.item.synopsis}
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      activeHero.type === 'movie'
                        ? `/player/${encodeURIComponent(activeHero.item.id)}`
                        : `/series/${encodeURIComponent(activeHero.item.id)}`
                    )
                  }
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#E50914] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#E50914]/30 hover:bg-[#c80711]"
                >
                  <Play className="h-4 w-4 fill-current" />
                  <span>{activeHero.type === 'movie' ? 'Watch Now' : 'View Episodes'}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      activeHero.type === 'movie'
                        ? `/movie/${encodeURIComponent(activeHero.item.id)}`
                        : `/series/${encodeURIComponent(activeHero.item.id)}`
                    )
                  }
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#2A2A32] bg-[#141418]/90 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-sm hover:bg-[#1F1F24]"
                >
                  <Info className="h-4 w-4" />
                  <span>Details</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void toggleWatchlist({
                      contentId: activeHero.item.id,
                      contentType: activeHero.type === 'movie' ? 'MOVIE' : 'SERIES',
                      title: activeHero.item.title,
                      posterUrl: activeHero.item.posterUrl,
                      releaseYear: activeHero.item.releaseYear,
                      genre: activeHero.item.genres?.[0] || 'Cinema',
                      runtimeSeconds:
                        'runtimeSeconds' in activeHero.item ? activeHero.item.runtimeSeconds : 0,
                      isPlayable: true,
                    })
                  }
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#2A2A32] bg-[#141418]/90 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-sm hover:bg-[#1F1F24]"
                >
                  {isInWatchlist(activeHero.item.id) ? (
                    <>
                      <Check className="h-4 w-4 text-[#4ADE80]" />
                      <span>Saved</span>
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

            {heroItems.length > 1 && (
              <div className="absolute right-4 bottom-4 flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Previous featured"
                  onClick={() => setHeroIndex((i) => (i - 1 + heroItems.length) % heroItems.length)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#2A2A32] bg-[#0A0A0C]/80 text-white hover:bg-[#1F1F24]"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next featured"
                  onClick={() => setHeroIndex((i) => (i + 1) % heroItems.length)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#2A2A32] bg-[#0A0A0C]/80 text-white hover:bg-[#1F1F24]"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Continue Watching */}
      {activeContinue.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2.5 px-4 lg:px-8">
            <span className="h-5 w-1 rounded-full bg-[#F2C94C]" />
            <h2 className="font-editorial text-lg font-bold text-white sm:text-xl">Continue Watching</h2>
          </div>
          <div className="kinova-scroll flex gap-3.5 overflow-x-auto px-4 pb-2 lg:px-8">
            {activeContinue.map((wp) => {
              const frac = wp.durationMs > 0 ? wp.positionMs / wp.durationMs : 0.25;
              const to = wp.episodeId
                ? `/player/${encodeURIComponent(wp.contentId)}?episodeId=${encodeURIComponent(wp.episodeId)}`
                : `/player/${encodeURIComponent(wp.contentId)}`;
              return (
                <Link
                  key={wp.progressKey}
                  to={to}
                  className="group w-48 shrink-0 overflow-hidden rounded-xl border border-[#2A2A32] bg-[#141418] hover:border-[#E50914]"
                >
                  <div className="relative aspect-video overflow-hidden bg-[#1F1F24]">
                    <KinovaPosterImage
                      src={wp.posterUrl}
                      title={wp.title}
                      aspectClass="aspect-video"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E50914] text-white shadow-lg">
                        <Play className="h-4 w-4 fill-current" />
                      </div>
                    </div>
                    <div className="absolute right-0 bottom-0 left-0 h-1 bg-white/20">
                      <div
                        className="h-full bg-[#E50914]"
                        style={{ width: `${Math.min(100, Math.max(5, frac * 100))}%` }}
                      />
                    </div>
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-sm font-semibold text-white">{wp.title}</p>
                    <p className="truncate text-xs text-[#9E9EA8]">{wp.subtitle || 'Resume'}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Discovery Carousels */}
      {homeData && (
        <>
          <CarouselRow
            title="Trending Movies"
            accent="VidZee • X8RR"
            items={homeData.trendingMovies}
            type="movie"
            seeAllTo="/movies"
          />
          <CarouselRow
            title="Popular Anime"
            accent="123Anime API"
            items={homeData.popularAnime}
            type="tv"
            seeAllTo="/search?tab=anime"
          />
          <CarouselRow
            title="Popular TV Series"
            accent="Multi-Source"
            items={homeData.popularSeries}
            type="tv"
            seeAllTo="/series"
          />
          <CarouselRow
            title="Latest Cinema Releases"
            items={homeData.latestMovieReleases}
            type="movie"
            seeAllTo="/movies"
          />
          <CarouselRow
            title="Trending Series"
            items={homeData.trendingSeries}
            type="tv"
            seeAllTo="/series"
          />
          <CarouselRow
            title="African Cinema"
            accent="KE • NG • ZA"
            items={homeData.africanCinema}
            type="movie"
            seeAllTo="/movies"
          />
          <CarouselRow title="Nollywood Hits" items={homeData.nollywood} type="movie" />
          <CarouselRow title="Bollywood Spotlight" items={homeData.bollywood} type="movie" />
          <CarouselRow title="Action & Adventure" items={homeData.actionMovies} type="movie" />
          <CarouselRow title="Comedy" items={homeData.comedyMovies} type="movie" />
          <CarouselRow title="Thriller & Suspense" items={homeData.thrillerMovies} type="movie" />
          <CarouselRow title="Romance" items={homeData.romanceMovies} type="movie" />
          <CarouselRow title="Horror" items={homeData.horrorMovies} type="movie" />
          <CarouselRow title="Top Rated Cinema" items={homeData.recommendedMovies} type="movie" />
        </>
      )}

      {/* TMDB Attribution Footer */}
      <footer className="mx-4 border-t border-[#2A2A32] pt-6 text-center text-xs text-[#9E9EA8] lg:mx-8">
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </footer>
    </div>
  );
};
