import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  CheckCircle2,
  Cloud,
  LogOut,
  RefreshCw,
  Server,
  Shield,
  Sparkles,
  User,
  XCircle,
} from 'lucide-react';
import { KinovaEmblem, KinovaWordmark } from '../components/KinovaComponents';
import { useKinova } from '../context/KinovaContext';
import { probeBackendHealth } from '../services/api';

export const SignInPage: React.FC = () => {
  const navigate = useNavigate();
  const { firebaseAvailable, signInGoogle, showToast } = useKinova();
  const [busy, setBusy] = useState(false);

  const handleGoogle = async () => {
    setBusy(true);
    try {
      await signInGoogle();
      navigate('/profile', { replace: true });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sign-in unavailable');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6 rounded-3xl border border-[#2A2A32] bg-[#141418] p-8 shadow-2xl">
        <div className="flex flex-col items-center gap-3 text-center">
          <KinovaEmblem size={52} />
          <KinovaWordmark compact />
          <h1 className="font-editorial text-2xl font-bold text-white">Welcome Back</h1>
          <p className="text-sm text-[#9E9EA8]">
            Sync your My List, resume positions, and playback preferences across devices.
          </p>
        </div>

        {firebaseAvailable ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleGoogle()}
            className="flex min-h-[48px] w-full items-center justify-center gap-3 rounded-xl bg-[#E50914] px-5 font-semibold text-white hover:bg-[#c80711] disabled:opacity-60"
          >
            <Cloud className="h-5 w-5" />
            <span>{busy ? 'Connecting Google Account...' : 'Continue with Google'}</span>
          </button>
        ) : (
          <div className="rounded-xl border border-[#F2C94C]/35 bg-[#3A2D14]/40 p-4 text-xs leading-relaxed text-[#FFE5B4]">
            Firebase Web Cloud Sync is not provisioned on this deployment yet. KINOVA saves your My List, viewing progress, and offline downloads directly in your browser.
          </div>
        )}

        <div className="space-y-2 border-t border-[#2A2A32] pt-4 text-center">
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="min-h-[44px] w-full rounded-xl border border-[#2A2A32] bg-[#1F1F24] text-sm font-semibold text-white hover:border-[#F2C94C]"
          >
            Continue in Guest Mode
          </button>
          <p className="text-xs text-[#9E9EA8]">
            New to KINOVA?{' '}
            <Link to="/create-account" className="text-[#F2C94C] hover:underline">
              Create Viewer Profile
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export const CreateAccountPage: React.FC = () => {
  const navigate = useNavigate();
  const { updateProfile } = useKinova();
  const [name, setName] = useState('');
  const [market, setMarket] = useState('Kenya');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfile({
      displayName: name.trim() || 'KINOVA Viewer',
      market,
    });
    navigate('/', { replace: true });
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-12">
      <form
        onSubmit={(e) => void handleCreate(e)}
        className="w-full max-w-md space-y-5 rounded-3xl border border-[#2A2A32] bg-[#141418] p-8 shadow-2xl"
      >
        <div className="text-center">
          <h1 className="font-editorial text-2xl font-bold text-white">Create Viewer Profile</h1>
          <p className="mt-1 text-sm text-[#9E9EA8]">Customize your KINOVA theater experience</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#9E9EA8] uppercase">Display Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alex W."
            className="h-11 w-full rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3.5 text-sm text-white focus:border-[#E50914] focus:outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#9E9EA8] uppercase">Region / Market</label>
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="h-11 w-full rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3.5 text-sm text-white"
          >
            <option value="Kenya">Kenya</option>
            <option value="East Africa">East Africa</option>
            <option value="Nigeria">Nigeria</option>
            <option value="South Africa">South Africa</option>
            <option value="International">International</option>
          </select>
        </div>

        <button
          type="submit"
          className="min-h-[46px] w-full rounded-xl bg-[#E50914] font-semibold text-white hover:bg-[#c80711]"
        >
          Start Watching
        </button>
      </form>
    </div>
  );
};

export const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const {
    profile,
    updateProfile,
    watchlist,
    downloads,
    history,
    firebaseAvailable,
    signInGoogle,
    signOutUser,
  } = useKinova();
  const [nameInput, setNameInput] = useState(profile.displayName);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-[#2A2A32] bg-[#141418] p-6">
        <div className="flex items-center gap-4">
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={profile.displayName}
              className="h-16 w-16 rounded-2xl border border-[#F2C94C]/40 object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#2A2A32] bg-[#1F1F24] text-[#F2C94C]">
              <User className="h-8 w-8" />
            </div>
          )}
          <div>
            <h1 className="font-editorial text-2xl font-bold text-white">{profile.displayName}</h1>
            <p className="text-xs text-[#9E9EA8]">
              {profile.isGuest ? 'Guest Local Profile' : profile.email} • {profile.market}
            </p>
          </div>
        </div>

        {profile.isGuest ? (
          firebaseAvailable ? (
            <button
              type="button"
              onClick={() => void signInGoogle()}
              className="min-h-[42px] rounded-xl bg-[#E50914] px-5 text-xs font-semibold text-white"
            >
              Sign In with Google
            </button>
          ) : (
            <Link
              to="/settings"
              className="inline-flex min-h-[42px] items-center rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-4 text-xs font-semibold text-white"
            >
              Preferences
            </Link>
          )
        ) : (
          <button
            type="button"
            onClick={() => void signOutUser()}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-4 text-xs font-semibold text-white hover:border-[#FF5A5F]"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'My List', value: watchlist.length },
          { label: 'Downloads', value: downloads.length },
          { label: 'Watched', value: history.length },
        ].map((st) => (
          <div key={st.label} className="rounded-2xl border border-[#2A2A32] bg-[#141418] p-4 text-center">
            <p className="font-mono text-2xl font-bold text-[#F2C94C]">{st.value}</p>
            <p className="text-xs text-[#9E9EA8]">{st.label}</p>
          </div>
        ))}
      </div>

      {/* Quick Profile Edit */}
      <div className="space-y-4 rounded-2xl border border-[#2A2A32] bg-[#141418] p-6">
        <h2 className="font-semibold text-white">Edit Display Name</h2>
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            className="h-11 flex-1 rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3.5 text-sm text-white"
          />
          <button
            type="button"
            onClick={() => void updateProfile({ displayName: nameInput.trim() || 'KINOVA Viewer' })}
            className="min-h-[44px] rounded-xl bg-[#E50914] px-5 text-xs font-semibold text-white"
          >
            Save Name
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="min-h-[44px] rounded-xl border border-[#2A2A32] bg-[#141418] px-5 text-sm font-semibold text-white hover:border-[#F2C94C]"
        >
          Playback &amp; Proxy Settings
        </button>
        <Link
          to="/about"
          className="inline-flex min-h-[44px] items-center rounded-xl border border-[#2A2A32] bg-[#141418] px-5 text-sm font-semibold text-[#9E9EA8] hover:text-white"
        >
          About KINOVA
        </Link>
      </div>
    </div>
  );
};

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { settings, updateSettings, showToast } = useKinova();
  const [probing, setProbing] = useState(false);
  const [probeData, setProbeData] = useState<Awaited<ReturnType<typeof probeBackendHealth>> | null>(
    null
  );
  const [vylaInput, setVylaInput] = useState(settings.vylaBaseUrl);

  const runProbe = async () => {
    setProbing(true);
    try {
      const res = await probeBackendHealth();
      setProbeData(res);
      showToast('Live proxy & provider diagnostics updated');
    } catch {
      showToast('Diagnostics check failed');
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 lg:px-8">
      <div>
        <h1 className="font-editorial text-2xl font-bold text-white sm:text-3xl">Settings &amp; Proxy</h1>
        <p className="text-sm text-[#9E9EA8]">
          Playback priorities, Anime sub/dub rules, offline preferences, and live Node.js proxy health
        </p>
      </div>

      {/* Live Proxy & Provider Diagnostics */}
      <section className="space-y-4 rounded-2xl border border-[#2A2A32] bg-[#141418] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Activity className="h-5 w-5 text-[#F2C94C]" />
            <div>
              <h2 className="font-semibold text-white">Node.js Stream &amp; Proxy Diagnostics</h2>
              <p className="text-xs text-[#9E9EA8]">
                Zero Cloudflare • Integrated StreamRelay, HLS-Proxy rules, Free-Movies-API (VidZee), X8RR &amp; 123Anime API
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={probing}
            onClick={() => void runProbe()}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[#E50914] px-4 text-xs font-semibold text-white hover:bg-[#c80711] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${probing ? 'animate-spin' : ''}`} />
            <span>{probing ? 'Testing...' : 'Test Live Providers'}</span>
          </button>
        </div>

        {probeData && (
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                name: 'Node.js HLS/TS/Range Proxy',
                ok: probeData.proxyEngine.ok,
                detail: probeData.proxyEngine.detail,
              },
              {
                name: 'TMDB Discovery API',
                ok: probeData.tmdbConfigured,
                detail: probeData.tmdbConfigured
                  ? 'TMDB_API_KEY configured'
                  : 'TMDB_API_KEY unset (using public Archive/TVMaze/123Anime fallback)',
              },
              {
                name: 'VidZee (free-moveis-api)',
                ok: probeData.vidzee.ok,
                detail: `${probeData.vidzee.detail} (${probeData.vidzee.elapsedMs}ms)`,
              },
              {
                name: '123Anime API',
                ok: probeData.anime123.ok,
                detail: `${probeData.anime123.detail} (${probeData.anime123.elapsedMs}ms)`,
              },
            ].map((row) => (
              <div
                key={row.name}
                className="flex items-start gap-2.5 rounded-xl border border-[#2A2A32] bg-[#1F1F24] p-3 text-xs"
              >
                {row.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#4ADE80]" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#FBBF24]" />
                )}
                <div>
                  <p className="font-semibold text-white">{row.name}</p>
                  <p className="text-[#9E9EA8]">{row.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Playback & Anime Controls */}
      <section className="space-y-4 rounded-2xl border border-[#2A2A32] bg-[#141418] p-5">
        <h2 className="font-semibold text-white">Playback &amp; Anime Preferences</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs text-[#9E9EA8]">Preferred Quality</label>
            <select
              value={settings.preferredQuality}
              onChange={(e) =>
                updateSettings({
                  preferredQuality: e.target.value as typeof settings.preferredQuality,
                })
              }
              className="h-11 w-full rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3 text-sm text-white"
            >
              <option value="Auto">Auto (Highest Verified)</option>
              <option value="1080p">1080p Full HD</option>
              <option value="720p">720p HD</option>
              <option value="Data Saver">Data Saver (480p)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-[#9E9EA8]">Anime Audio Preference</label>
            <select
              value={settings.animeSubDubPreference}
              onChange={(e) =>
                updateSettings({
                  animeSubDubPreference: e.target.value as 'sub' | 'dub',
                })
              }
              className="h-11 w-full rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3 text-sm text-white"
            >
              <option value="sub">Japanese (Subbed)</option>
              <option value="dub">English Dub</option>
            </select>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          {[
            {
              label: 'Auto-Play Next Episode',
              checked: settings.autoPlayNextEpisode,
              onChange: (val: boolean) => updateSettings({ autoPlayNextEpisode: val }),
            },
            {
              label: 'Enable Multi-Provider Anime & Stream Fallback',
              checked: settings.animeFallbackEnabled,
              onChange: (val: boolean) => updateSettings({ animeFallbackEnabled: val }),
            },
            {
              label: 'Wi-Fi Only Offline Downloads',
              checked: settings.wifiOnlyDownloads,
              onChange: (val: boolean) => updateSettings({ wifiOnlyDownloads: val }),
            },
          ].map((toggle) => (
            <label
              key={toggle.label}
              className="flex cursor-pointer items-center justify-between rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-4 py-3"
            >
              <span className="text-sm text-white">{toggle.label}</span>
              <input
                type="checkbox"
                checked={toggle.checked}
                onChange={(e) => toggle.onChange(e.target.checked)}
                className="h-4 w-4 accent-[#E50914]"
              />
            </label>
          ))}
        </div>
      </section>

      {/* Optional External Vyla Gateway Override */}
      <section className="space-y-3 rounded-2xl border border-[#2A2A32] bg-[#141418] p-5">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-[#F2C94C]" />
          <h2 className="font-semibold text-white">Optional External Vyla Gateway URL</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="url"
            value={vylaInput}
            onChange={(e) => setVylaInput(e.target.value)}
            placeholder="https://your-selfhosted-vyla-node-gateway.example"
            className="h-11 flex-1 rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-3.5 font-mono text-xs text-white"
          />
          <button
            type="button"
            onClick={() => {
              updateSettings({ vylaBaseUrl: vylaInput.trim() });
              showToast('Vyla gateway setting saved');
            }}
            className="min-h-[44px] rounded-xl border border-[#2A2A32] bg-[#1F1F24] px-4 text-xs font-semibold text-[#F2C94C] hover:border-[#F2C94C]"
          >
            Save
          </button>
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            updateSettings({ onboardingCompleted: false });
            navigate('/onboarding');
          }}
          className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#2A2A32] bg-[#141418] px-4 text-xs font-semibold text-white"
        >
          <Sparkles className="h-4 w-4 text-[#F2C94C]" />
          <span>Replay Onboarding</span>
        </button>
      </div>
    </div>
  );
};

export const AboutPage: React.FC = () => (
  <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 lg:px-8">
    <div className="flex items-center gap-3">
      <KinovaEmblem size={44} />
      <div>
        <KinovaWordmark compact />
        <p className="text-xs text-[#9E9EA8]">Stories Worth Watching • Version 1.2 Web</p>
      </div>
    </div>
    <div className="space-y-3 rounded-2xl border border-[#2A2A32] bg-[#141418] p-6 text-sm leading-relaxed text-[#9E9EA8]">
      <p>
        KINOVA is a multi-source streaming and offline cinema platform powered by a standalone Node.js &amp; Express proxy engine (zero Cloudflare or proprietary edge dependencies).
      </p>
      <p>
        It integrates VidZee (free-moveis-api), X8RR Multi-Source, 123Anime API, StreamRelay HTTP streaming, HLS host-header rules, and IndexedDB offline media storage.
      </p>
      <p className="font-mono text-xs text-[#F2C94C]">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </div>
  </div>
);

export const PrivacyPage: React.FC = () => (
  <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 lg:px-8">
    <div className="flex items-center gap-2">
      <Shield className="h-5 w-5 text-[#F2C94C]" />
      <h1 className="font-editorial text-2xl font-bold text-white">Privacy Policy</h1>
    </div>
    <div className="space-y-3 rounded-2xl border border-[#2A2A32] bg-[#141418] p-6 text-sm leading-relaxed text-[#9E9EA8]">
      <p>
        KINOVA operates cleanly in Guest Mode using browser localStorage and IndexedDB for your watchlist, resume timestamps, and offline video files.
      </p>
      <p>
        When Google Cloud Sync is enabled, only your authenticated user profile, My List, watch progress, and viewing history are stored under owner-restricted Firestore rules.
      </p>
    </div>
  </div>
);

export const TermsPage: React.FC = () => (
  <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 lg:px-8">
    <h1 className="font-editorial text-2xl font-bold text-white">Terms of Use</h1>
    <div className="space-y-3 rounded-2xl border border-[#2A2A32] bg-[#141418] p-6 text-sm leading-relaxed text-[#9E9EA8]">
      <p>
        KINOVA aggregates publicly discoverable metadata and stream indices via user-triggered server proxy requests. Users are responsible for complying with applicable local media and copyright laws in their region.
      </p>
    </div>
  </div>
);
