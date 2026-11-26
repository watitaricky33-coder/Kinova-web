import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Film, Search, Sparkles, Trash2, Tv } from 'lucide-react';
import { MediaGridCard } from '../components/KinovaComponents';
import { useKinova } from '../context/KinovaContext';
import { fetchMoviesPage, fetchSeriesPage, searchCatalogue } from '../services/api';
import type { MovieRecord, SeriesRecord } from '../types/kinova';

const MOVIE_GENRES = [
  { id: 'all', label: 'All Genres' },
  { id: '28', label: 'Action' },
  { id: '12', label: 'Adventure' },
  { id: '16', label: 'Animation' },
  { id: '35', label: 'Comedy' },
  { id: '80', label: 'Crime' },
  { id: '99', label: 'Documentary' },
  { id: '18', label: 'Drama' },
  { id: '27', label: 'Horror' },
  { id: '10749', label: 'Romance' },
  { id: '878', label: 'Sci-Fi' },
  { id: '53', label: 'Thriller' },
];

const SERIES_GENRES = [
  { id: 'all', label: 'All Series' },
  { id: 'anime', label: 'Anime' },
  { id: '10759', label: 'Action & Adventure' },
  { id: '16', label: 'Animation' },
  { id: '35', label: 'Comedy' },
  { id: '80', label: 'Crime' },
  { id: '18', label: 'Drama' },
  { id: '9648', label: 'Mystery' },
  { id: '10765', label: 'Sci-Fi & Fantasy' },
];

export const MoviesPage: React.FC = () => {
  const [genre, setGenre] = useState('all');
  const [year, setYear] = useState('all');
  const [sort, setSort] = useState('popularity.desc');
  const [items, setItems] = useState<MovieRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchMoviesPage({ page: 1, genre, year, sort })
      .then((res) => {
        if (!active) return;
        setItems(res.items);
        setPage(res.page);
        setTotalPages(res.totalPages);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [genre, year, sort]);

  const loadMore = async () => {
    if (loading || page >= totalPages) return;
    setLoading(true);
    try {
      const res = await fetchMoviesPage({ page: page + 1, genre, year, sort });
      setItems((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...res.items.filter((m) => !seen.has(m.id))];
      });
      setPage(res.page);
      setTotalPages(res.totalPages);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-editorial text-2xl font-bold text-white sm:text-3xl">Movies Catalogue</h1>
          <p className="text-sm text-[#9E9EA8]">Verified features via VidZee & X8RR multi-source relay</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Filter by year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="min-h-[40px] rounded-xl border border-[#2A2A32] bg-[#141418] px-3 text-xs text-white"
          >
            <option value="all">All Years</option>
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
            <option value="2023">2023</option>
            <option value="2020">2020</option>
          </select>

          <select
            aria-label="Sort movies"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="min-h-[40px] rounded-xl border border-[#2A2A32] bg-[#141418] px-3 text-xs text-white"
          >
            <option value="popularity.desc">Most Popular</option>
            <option value="vote_average.desc">Top Rated</option>
            <option value="primary_release_date.desc">Newest Releases</option>
          </select>
        </div>
      </div>

      {/* Genre Chips */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {MOVIE_GENRES.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGenre(g.id)}
            className={`min-h-[38px] shrink-0 rounded-xl border px-3.5 text-xs font-semibold transition-colors ${
              genre === g.id
                ? 'border-[#E50914] bg-[#E50914] text-white'
                : 'border-[#2A2A32] bg-[#141418] text-[#9E9EA8] hover:text-white'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {items.map((m) => (
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

      {loading && (
        <div className="py-6 text-center text-sm text-[#9E9EA8]">Loading movies...</div>
      )}

      {!loading && page < totalPages && (
        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={() => void loadMore()}
            className="min-h-[44px] rounded-xl border border-[#2A2A32] bg-[#141418] px-6 py-2.5 text-sm font-semibold text-white hover:border-[#E50914] hover:bg-[#1F1F24]"
          >
            Load More Movies
          </button>
        </div>
      )}
    </div>
  );
};

export const SeriesPage: React.FC = () => {
  const [genre, setGenre] = useState('all');
  const [year, setYear] = useState('all');
  const [sort, setSort] = useState('popularity.desc');
  const [items, setItems] = useState<SeriesRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchSeriesPage({
      page: 1,
      genre: genre === 'anime' ? undefined : genre,
      anime: genre === 'anime',
      year,
      sort,
    })
      .then((res) => {
        if (!active) return;
        setItems(res.items);
        setPage(res.page);
        setTotalPages(res.totalPages);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [genre, year, sort]);

  const loadMore = async () => {
    if (loading || page >= totalPages) return;
    setLoading(true);
    try {
      const res = await fetchSeriesPage({
        page: page + 1,
        genre: genre === 'anime' ? undefined : genre,
        anime: genre === 'anime',
        year,
        sort,
      });
      setItems((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...res.items.filter((s) => !seen.has(s.id))];
      });
      setPage(res.page);
      setTotalPages(res.totalPages);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-editorial text-2xl font-bold text-white sm:text-3xl">Series & Anime</h1>
          <p className="text-sm text-[#9E9EA8]">Episodic television & anime via VidZee, X8RR & 123Anime API</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Filter series by year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="min-h-[40px] rounded-xl border border-[#2A2A32] bg-[#141418] px-3 text-xs text-white"
          >
            <option value="all">All Years</option>
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
            <option value="2023">2023</option>
          </select>
          <select
            aria-label="Sort series"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="min-h-[40px] rounded-xl border border-[#2A2A32] bg-[#141418] px-3 text-xs text-white"
          >
            <option value="popularity.desc">Most Popular</option>
            <option value="vote_average.desc">Top Rated</option>
            <option value="first_air_date.desc">Newest Series</option>
          </select>
        </div>
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {SERIES_GENRES.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGenre(g.id)}
            className={`min-h-[38px] shrink-0 rounded-xl border px-3.5 text-xs font-semibold transition-colors ${
              genre === g.id
                ? 'border-[#E50914] bg-[#E50914] text-white'
                : 'border-[#2A2A32] bg-[#141418] text-[#9E9EA8] hover:text-white'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {items.map((s) => (
          <MediaGridCard
            key={s.id}
            id={s.id}
            type="tv"
            title={s.title}
            posterUrl={s.posterUrl || s.thumbnailUrl}
            year={s.releaseYear}
            rating={s.rating}
            genre={s.genres?.[0]}
          />
        ))}
      </div>

      {loading && <div className="py-6 text-center text-sm text-[#9E9EA8]">Loading series...</div>}

      {!loading && page < totalPages && (
        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={() => void loadMore()}
            className="min-h-[44px] rounded-xl border border-[#2A2A32] bg-[#141418] px-6 py-2.5 text-sm font-semibold text-white hover:border-[#E50914]"
          >
            Load More Series
          </button>
        </div>
      )}
    </div>
  );
};

export const SearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as 'all' | 'movies' | 'series' | 'anime') || 'all';
  const [tab, setTab] = useState<'all' | 'movies' | 'series' | 'anime'>(initialTab);
  const [queryText, setQueryText] = useState(searchParams.get('q') || '');
  const [loading, setLoading] = useState(false);
  const [movies, setMovies] = useState<MovieRecord[]>([]);
  const [series, setSeries] = useState<SeriesRecord[]>([]);
  const [anime, setAnime] = useState<SeriesRecord[]>([]);

  const { homeData, recentSearches, addRecentSearch, clearRecentSearches } = useKinova();

  useEffect(() => {
    const trimmed = queryText.trim();
    if (!trimmed) {
      setMovies([]);
      setSeries([]);
      setAnime([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchCatalogue(trimmed);
        setMovies(res.movies);
        setSeries(res.series);
        setAnime(res.anime);
        addRecentSearch(trimmed);
      } finally {
        setLoading(false);
      }
    }, 380);
    return () => window.clearTimeout(timer);
  }, [queryText, addRecentSearch]);

  const handleSelectSuggestion = (term: string) => {
    setQueryText(term);
    setSearchParams({ q: term, tab });
  };

  const showMovies = tab === 'all' || tab === 'movies';
  const showSeries = tab === 'all' || tab === 'series';
  const showAnime = tab === 'all' || tab === 'anime';

  return (
    <div className="space-y-6 px-4 py-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-editorial text-2xl font-bold text-white sm:text-3xl">Search Catalogue</h1>
          <p className="text-sm text-[#9E9EA8]">Instant search across TMDB Movies, Series & 123Anime API</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-[#F2C94C]" />
        <input
          type="search"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder="Search movies, series, anime, actors..."
          className="h-12 w-full rounded-xl border border-[#2A2A32] bg-[#141418] pr-4 pl-12 text-sm text-white placeholder-[#9E9EA8] focus:border-[#E50914] focus:outline-none"
        />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'all', label: 'All Results', icon: Sparkles },
          { id: 'movies', label: 'Movies', icon: Film },
          { id: 'series', label: 'TV Series', icon: Tv },
          { id: 'anime', label: 'Anime (123Anime)', icon: Sparkles },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as typeof tab)}
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl border px-4 text-xs font-semibold transition-colors ${
                active
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

      {/* Recent Searches & Popular Anime browse when query empty */}
      {!queryText.trim() && (
        <div className="space-y-6">
          {recentSearches.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Recent Searches</h2>
                <button
                  type="button"
                  onClick={clearRecentSearches}
                  className="inline-flex items-center gap-1 text-xs text-[#9E9EA8] hover:text-[#FF5A5F]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Clear</span>
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => handleSelectSuggestion(term)}
                    className="rounded-xl border border-[#2A2A32] bg-[#141418] px-3.5 py-2 text-xs text-white hover:border-[#F2C94C]"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Suggested Queries</h2>
            <div className="flex flex-wrap gap-2">
              {['Inception', 'Solo Leveling', 'Attack on Titan', 'Interstellar', 'Breaking Bad', 'Naruto'].map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleSelectSuggestion(s)}
                    className="rounded-xl border border-[#2A2A32] bg-[#141418] px-3.5 py-2 text-xs text-[#9E9EA8] hover:border-[#E50914] hover:text-white"
                  >
                    {s}
                  </button>
                )
              )}
            </div>
          </div>

          {tab === 'anime' && homeData && homeData.popularAnime.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-editorial text-xl font-bold text-white">Popular Anime</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {homeData.popularAnime.map((a) => (
                  <MediaGridCard
                    key={a.id}
                    id={a.id}
                    type="tv"
                    title={a.title}
                    posterUrl={a.posterUrl}
                    year={a.releaseYear}
                    rating={a.rating}
                    genre="Anime"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {loading && <p className="text-sm text-[#9E9EA8]">Searching catalogue & 123Anime...</p>}

      {queryText.trim() && !loading && (
        <div className="space-y-8">
          {showAnime && anime.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-editorial text-xl font-bold text-white">
                Anime Results ({anime.length})
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {anime.map((a) => (
                  <MediaGridCard
                    key={a.id}
                    id={a.id}
                    type="tv"
                    title={a.title}
                    posterUrl={a.posterUrl}
                    year={a.releaseYear}
                    rating={a.rating}
                    genre="123Anime"
                  />
                ))}
              </div>
            </section>
          )}

          {showMovies && movies.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-editorial text-xl font-bold text-white">
                Movies ({movies.length})
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {movies.map((m) => (
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

          {showSeries && series.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-editorial text-xl font-bold text-white">
                TV Series ({series.length})
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {series.map((s) => (
                  <MediaGridCard
                    key={s.id}
                    id={s.id}
                    type="tv"
                    title={s.title}
                    posterUrl={s.posterUrl || s.thumbnailUrl}
                    year={s.releaseYear}
                    rating={s.rating}
                    genre={s.genres?.[0]}
                  />
                ))}
              </div>
            </section>
          )}

          {movies.length === 0 && series.length === 0 && anime.length === 0 && (
            <div className="rounded-2xl border border-[#2A2A32] bg-[#141418] p-8 text-center">
              <p className="text-sm text-[#9E9EA8]">No matches found for &ldquo;{queryText}&rdquo;.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
