import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/KinovaComponents';
import { KinovaProvider } from './context/KinovaContext';
import {
  AboutPage,
  CreateAccountPage,
  PrivacyPage,
  ProfilePage,
  SettingsPage,
  SignInPage,
  TermsPage,
} from './pages/AuthProfileAndSettingsPages';
import { MoviesPage, SearchPage, SeriesPage } from './pages/CatalogAndSearchPages';
import { MovieDetailsPage, SeasonEpisodesPage, SeriesDetailsPage } from './pages/DetailsPages';
import { HomePage } from './pages/HomePage';
import { DownloadsPage, MyListPage } from './pages/LibraryAndDownloadsPages';
import { PlayerPage } from './pages/PlayerPage';
import { OnboardingPage, SplashPage } from './pages/SplashAndOnboardingPages';

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#0A0A0C] px-6 text-center text-white">
          <h1 className="font-editorial text-2xl font-bold text-[#E50914]">KINOVA Recovery</h1>
          <p className="mt-2 max-w-md text-sm text-[#9E9EA8]">{this.state.message}</p>
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            className="mt-5 rounded-xl bg-[#E50914] px-5 py-2.5 text-sm font-semibold text-white"
          >
            Return Home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const AppRoutes: React.FC = () => {
  const location = useLocation();
  const hideChrome =
    location.pathname.startsWith('/player') ||
    location.pathname.startsWith('/splash') ||
    location.pathname.startsWith('/onboarding');

  return (
    <AppShell hideChrome={hideChrome}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/splash" element={<SplashPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/movies" element={<MoviesPage />} />
        <Route path="/series" element={<SeriesPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/movie/:movieId" element={<MovieDetailsPage />} />
        <Route path="/series/:seriesId" element={<SeriesDetailsPage />} />
        <Route path="/series/:seriesId/season/:seasonNumber" element={<SeasonEpisodesPage />} />
        <Route path="/player/:contentId" element={<PlayerPage />} />
        <Route path="/downloads" element={<DownloadsPage />} />
        <Route path="/my-list" element={<MyListPage />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/create-account" element={<CreateAccountPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
};

export function App() {
  return (
    <AppErrorBoundary>
      <KinovaProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </KinovaProvider>
    </AppErrorBoundary>
  );
}

export default App;
