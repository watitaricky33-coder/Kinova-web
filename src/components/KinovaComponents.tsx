import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bookmark,
  Clapperboard,
  Download,
  FileText,
  Film,
  Home,
  Info,
  Menu,
  Play,
  Search,
  Settings,
  Shield,
  Sparkles,
  Tv,
  User,
  X,
} from 'lucide-react';
import { useKinova } from '../context/KinovaContext';

export const KinovaEmblem: React.FC<{ size?: number; className?: string }> = ({
  size = 34,
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <rect x="2" y="2" width="60" height="60" rx="14" fill="#141418" stroke="#2A2A32" strokeWidth="2.5" />
    {/* Gold circular crest halo */}
    <circle cx="32" cy="32" r="22" stroke="#F2C94C" strokeWidth="1.5" strokeOpacity="0.4" />
    {/* Geometric K stem */}
    <rect x="18" y="15" width="7" height="34" rx="2" fill="#FFFFFF" />
    {/* Crimson upper diagonal cinema blade */}
    <path d="M27 32L44 15H51L33 33L27 32Z" fill="#E50914" />
    {/* Gold lower sweep */}
    <path d="M27 32L33 31L51 49H43L27 32Z" fill="#F2C94C" />
  </svg>
);

export const KinovaWordmark: React.FC<{
  variant?: 'dark' | 'light' | 'mono';
  compact?: boolean;
}> = ({ variant = 'dark', compact = false }) => {
  const kColor = variant === 'mono' ? 'text-white' : 'text-[#E50914]';
  const restColor = variant === 'light' ? 'text-[#0A0A0C]' : 'text-white';
  return (
    <span
      className={`inline-flex items-baseline font-display font-bold tracking-[0.18em] select-none ${
        compact ? 'text-lg' : 'text-2xl'
      }`}
    >
      <span className={kColor}>K</span>
      <span className={restColor}>INOVA</span>
    </span>
  );
};

export const KinovaPosterImage: React.FC<{
  src?: string;
  title: string;
  subtitle?: string;
  className?: string;
  aspectClass?: string;
}> = ({ src, title, subtitle, className = '', aspectClass = 'aspect-[2/3]' }) => {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div
        className={`relative flex flex-col justify-between overflow-hidden rounded-xl border border-[#2A2A32] bg-gradient-to-br from-[#1F1F24] via-[#141418] to-[#0A0A0C] p-3 ${aspectClass} ${className}`}
      >
        <div className="flex items-center justify-between">
          <KinovaEmblem size={22} />
          <span className="font-mono text-[10px] tracking-widest text-[#F2C94C] uppercase">KINOVA</span>
        </div>
        <div>
          <p className="line-clamp-3 font-editorial text-sm font-semibold leading-snug text-white">
            {title}
          </p>
          {subtitle && (
            <p className="mt-1 line-clamp-1 font-sans text-[11px] text-[#9E9EA8]">{subtitle}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={title}
      loading="lazy"
      onError={() => setErrored(true)}
      className={`w-full object-cover ${aspectClass} ${className}`}
    />
  );
};

export const MediaGridCard: React.FC<{
  id: string;
  type: 'movie' | 'tv';
  title: string;
  posterUrl?: string;
  year?: number;
  rating?: number;
  genre?: string;
  progressFraction?: number;
}> = ({ id, type, title, posterUrl, year, rating, genre, progressFraction }) => {
  const to = type === 'movie' ? `/movie/${encodeURIComponent(id)}` : `/series/${encodeURIComponent(id)}`;

  return (
    <Link
      to={to}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-[#2A2A32]/70 bg-[#141418] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#E50914]/70 focus-visible:outline-2 focus-visible:outline-[#F2C94C]"
    >
      <div className="relative overflow-hidden bg-[#1F1F24]">
        <KinovaPosterImage
          src={posterUrl}
          title={title}
          subtitle={genre || (year ? String(year) : undefined)}
          className="transition-transform duration-300 group-hover:scale-105"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0A0A0C]/90 via-transparent to-transparent opacity-80" />

        {rating !== undefined && rating > 0 && (
          <div className="absolute top-2 right-2 rounded-md border border-[#F2C94C]/40 bg-[#0A0A0C]/85 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#F2C94C] backdrop-blur-sm">
            ★ {rating.toFixed(1)}
          </div>
        )}

        <div className="absolute right-2 bottom-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#E50914]/90 text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100">
          <Play className="h-4 w-4 fill-current" />
        </div>

        {typeof progressFraction === 'number' && progressFraction > 0 && (
          <div className="absolute right-0 bottom-0 left-0 h-1 bg-white/20">
            <div
              className="h-full bg-[#E50914]"
              style={{ width: `${Math.min(100, Math.max(4, progressFraction * 100))}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col justify-between p-2.5">
        <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-white group-hover:text-[#F2C94C]">
          {title}
        </h3>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-[#9E9EA8]">
          <span className="truncate">{genre || (type === 'movie' ? 'Film' : 'Series')}</span>
          {year && year > 0 ? <span className="font-mono text-[11px]">{year}</span> : null}
        </div>
      </div>
    </Link>
  );
};

const PRIMARY_NAV = [
  { label: 'Home', to: '/', icon: Home },
  { label: 'Movies', to: '/movies', icon: Film },
  { label: 'Series', to: '/series', icon: Tv },
  { label: 'Downloads', to: '/downloads', icon: Download },
  { label: 'My List', to: '/my-list', icon: Bookmark },
];

export const AppShell: React.FC<{ children: React.ReactNode; hideChrome?: boolean }> = ({
  children,
  hideChrome = false,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile } = useKinova();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (hideChrome) {
    return <div className="min-h-screen bg-[#0A0A0C] text-white">{children}</div>;
  }

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <div className="flex min-h-screen bg-[#0A0A0C] text-white">
      {/* Desktop Navigation Rail */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between border-r border-[#2A2A32] bg-[#141418]/90 px-4 py-5 lg:flex">
        <div>
          <Link to="/" className="mb-8 flex items-center gap-3 px-2">
            <KinovaEmblem size={36} />
            <div>
              <KinovaWordmark compact />
              <p className="text-[10px] tracking-widest text-[#9E9EA8] uppercase">Stories Worth Watching</p>
            </div>
          </Link>

          <nav className="space-y-1.5" aria-label="Primary navigation">
            {PRIMARY_NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex min-h-[44px] items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[#E50914] text-white shadow-lg shadow-[#E50914]/20'
                      : 'text-[#9E9EA8] hover:bg-[#1F1F24] hover:text-white'
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            <Link
              to="/search"
              className={`flex min-h-[44px] items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                isActive('/search')
                  ? 'bg-[#E50914] text-white'
                  : 'text-[#9E9EA8] hover:bg-[#1F1F24] hover:text-white'
              }`}
            >
              <Search className="h-5 w-5 shrink-0" />
              <span>Search & Anime</span>
            </Link>
          </nav>
        </div>

        <div className="space-y-1.5 border-t border-[#2A2A32] pt-4">
          <Link
            to="/profile"
            className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2 text-sm text-[#9E9EA8] hover:bg-[#1F1F24] hover:text-white"
          >
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt={profile.displayName} className="h-6 w-6 rounded-full object-cover" />
            ) : (
              <User className="h-5 w-5" />
            )}
            <span className="truncate">{profile.displayName}</span>
          </Link>
          <Link
            to="/settings"
            className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2 text-sm text-[#9E9EA8] hover:bg-[#1F1F24] hover:text-white"
          >
            <Settings className="h-5 w-5" />
            <span>Settings</span>
          </Link>
        </div>
      </aside>

      {/* Main Content Column */}
      <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#2A2A32]/80 bg-[#0A0A0C]/90 px-4 backdrop-blur-md lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#2A2A32] bg-[#141418] text-white hover:bg-[#1F1F24] lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link to="/" className="flex items-center gap-2.5 lg:hidden">
              <KinovaEmblem size={30} />
              <KinovaWordmark compact />
            </Link>
            <div className="hidden items-center gap-2 text-xs text-[#9E9EA8] lg:flex">
              <Sparkles className="h-3.5 w-3.5 text-[#F2C94C]" />
              <span>Multi-Source Proxy • VidZee • 123Anime • Offline Vault</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate('/search')}
              aria-label="Search movies, series, and anime"
              className="flex h-11 items-center gap-2 rounded-xl border border-[#2A2A32] bg-[#141418] px-3.5 text-sm text-[#9E9EA8] transition-colors hover:border-[#F2C94C]/50 hover:text-white"
            >
              <Search className="h-4 w-4 text-[#F2C94C]" />
              <span className="hidden sm:inline">Search movies, series & anime...</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/profile')}
              aria-label="Profile"
              className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-[#2A2A32] bg-[#141418] text-white hover:border-[#E50914]"
            >
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt={profile.displayName} className="h-full w-full object-cover" />
              ) : (
                <User className="h-5 w-5 text-[#F2C94C]" />
              )}
            </button>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="fixed right-0 bottom-0 left-0 z-30 flex h-16 items-center justify-around border-t border-[#2A2A32] bg-[#141418]/95 px-1 backdrop-blur-md lg:hidden"
      >
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex min-h-[44px] min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-[11px] font-medium transition-colors ${
                active ? 'text-[#E50914]' : 'text-[#9E9EA8] hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Slide-out Mobile/Tablet Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col justify-between border-r border-[#2A2A32] bg-[#141418] p-5">
            <div className="space-y-4 overflow-y-auto">
              <div className="flex items-center justify-between border-b border-[#2A2A32] pb-4">
                <div className="flex items-center gap-2.5">
                  <KinovaEmblem size={32} />
                  <KinovaWordmark compact />
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close drawer"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-[#9E9EA8] hover:bg-[#1F1F24] hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-1">
                {[
                  { label: 'Home', to: '/', icon: Home },
                  { label: 'Movies', to: '/movies', icon: Film },
                  { label: 'Series & Anime', to: '/series', icon: Tv },
                  { label: 'Search & Browse All', to: '/search', icon: Search },
                  { label: 'My List', to: '/my-list', icon: Bookmark },
                  { label: 'Downloads', to: '/downloads', icon: Download },
                  { label: 'Viewer Profile', to: '/profile', icon: User },
                  { label: 'Settings & Diagnostics', to: '/settings', icon: Settings },
                  { label: 'Privacy Policy', to: '/privacy', icon: Shield },
                  { label: 'Terms of Use', to: '/terms', icon: FileText },
                  { label: 'About KINOVA', to: '/about', icon: Info },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setDrawerOpen(false)}
                      className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2 text-sm text-[#9E9EA8] hover:bg-[#1F1F24] hover:text-white"
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-[#2A2A32] pt-3 text-xs text-[#9E9EA8]">
              <div className="flex items-center gap-2">
                <Clapperboard className="h-4 w-4 text-[#F2C94C]" />
                <span>KINOVA Web • Node.js Stream Relay</span>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};
