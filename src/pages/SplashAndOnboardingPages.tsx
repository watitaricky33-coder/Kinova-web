import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { KinovaEmblem, KinovaWordmark } from '../components/KinovaComponents';
import { useKinova } from '../context/KinovaContext';

export const SplashPage: React.FC = () => {
  const navigate = useNavigate();
  const { settings } = useKinova();

  useEffect(() => {
    const t = window.setTimeout(() => {
      navigate(settings.onboardingCompleted ? '/' : '/onboarding', { replace: true });
    }, 1100);
    return () => window.clearTimeout(t);
  }, [navigate, settings.onboardingCompleted]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0A0A0C] px-6 text-center">
      <div className="animate-fade-in flex flex-col items-center gap-5">
        <div className="rounded-3xl border border-[#2A2A32] bg-[#141418] p-5 shadow-2xl shadow-[#E50914]/15">
          <KinovaEmblem size={68} />
        </div>
        <KinovaWordmark />
        <p className="font-editorial text-base italic text-[#9E9EA8]">Stories Worth Watching</p>
        <div className="mt-4 h-1 w-40 overflow-hidden rounded-full bg-[#1F1F24]">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-[#E50914] to-[#F2C94C]" />
        </div>
      </div>
    </div>
  );
};

const SLIDES = [
  {
    image: '/images/img_onboard_action_1.jpg',
    eyebrow: 'CURATED GLOBAL & AFRICAN CINEMA',
    title: 'Cinema, Series & Anime — All Verified',
    description:
      'Discover trending blockbusters, Nollywood & East African hits, acclaimed TV dramas, and subbed/dubbed anime in one dark-obsidian theater.',
  },
  {
    image: '/images/img_onboard_action_2.jpg',
    eyebrow: 'MULTI-SOURCE STREAMING RELAY',
    title: 'Instant Playback with Automatic Failover',
    description:
      'VidZee, X8RR multi-source, and 123Anime streams route cleanly through KINOVA’s native Node.js HLS & Range proxy with subtitle support.',
  },
  {
    image: '/images/img_onboard_action_3.jpg',
    eyebrow: 'OFFLINE VAULT & CROSS-DEVICE SYNC',
    title: 'Download Anywhere, Resume Everywhere',
    description:
      'Save movies and episodes directly to offline storage, manage your My List, and sync progress across devices.',
  },
];

export const OnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const { updateSettings } = useKinova();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, 5500);
    return () => window.clearInterval(timer);
  }, []);

  const finishOnboarding = (target = '/') => {
    updateSettings({ onboardingCompleted: true });
    navigate(target, { replace: true });
  };

  const slide = SLIDES[index];

  return (
    <div className="relative flex min-h-screen flex-col justify-between overflow-hidden bg-[#0A0A0C]">
      {/* Backdrop artwork */}
      <div className="absolute inset-0">
        <img
          src={slide.image}
          alt={slide.title}
          className="h-full w-full object-cover opacity-35 transition-all duration-700"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0C] via-[#0A0A0C]/80 to-[#0A0A0C]/50" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 lg:px-12">
        <div className="flex items-center gap-3">
          <KinovaEmblem size={36} />
          <KinovaWordmark compact />
        </div>
        <button
          type="button"
          onClick={() => finishOnboarding('/')}
          className="min-h-[44px] rounded-xl px-4 text-sm font-medium text-[#9E9EA8] hover:bg-[#1F1F24] hover:text-white"
        >
          Skip
        </button>
      </header>

      {/* Main Content */}
      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 pb-12 lg:px-12">
        <div className="inline-flex w-fit items-center gap-2 rounded-lg border border-[#F2C94C]/30 bg-[#141418]/85 px-3 py-1.5 text-xs font-semibold tracking-widest text-[#F2C94C] backdrop-blur-sm">
          <Sparkles className="h-3.5 w-3.5" />
          <span>{slide.eyebrow}</span>
        </div>

        <h1 className="max-w-2xl font-editorial text-3xl font-bold leading-tight text-white sm:text-5xl">
          {slide.title}
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-[#9E9EA8] sm:text-lg">
          {slide.description}
        </p>

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIndex((i) => (i - 1 + SLIDES.length) % SLIDES.length)}
              aria-label="Previous slide"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#2A2A32] bg-[#141418] text-white hover:bg-[#1F1F24]"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-1.5 px-2">
              {SLIDES.map((s, idx) => (
                <button
                  key={s.title}
                  type="button"
                  aria-label={`Slide ${idx + 1}`}
                  onClick={() => setIndex(idx)}
                  className={`h-2 rounded-full transition-all ${
                    idx === index ? 'w-7 bg-[#E50914]' : 'w-2 bg-[#2A2A32] hover:bg-[#9E9EA8]'
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setIndex((i) => (i + 1) % SLIDES.length)}
              aria-label="Next slide"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#2A2A32] bg-[#141418] text-white hover:bg-[#1F1F24]"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => finishOnboarding('/signin')}
              className="min-h-[44px] rounded-xl border border-[#2A2A32] bg-[#141418] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1F1F24]"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => finishOnboarding('/')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#E50914] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#E50914]/30 hover:bg-[#c80711]"
            >
              <span>Get Started</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
