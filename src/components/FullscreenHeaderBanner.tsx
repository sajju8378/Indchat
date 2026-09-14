import React, { useState, useEffect } from 'react';
import { Maximize, Minimize, Smartphone, X, Sparkles } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { NativeAppGuideModal } from './NativeAppGuideModal';

export const FullscreenHeaderBanner: React.FC = () => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // If already installed as a standalone PWA or already in fullscreen or user dismissed, hide banner
  if (isInstalled || isFullscreen || isDismissed) {
    return null;
  }

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen request failed:', err);
      setShowGuide(true);
    }
  };

  const handleInstallClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (!ok) {
        setShowGuide(true);
      }
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <div
        id="fullscreen-header-banner"
        className="w-full bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-950 border-b border-indigo-800/40 px-3 py-2 text-slate-100 flex items-center justify-between gap-2 text-xs shadow-md shrink-0 z-30"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-600/40 text-indigo-300 border border-indigo-500/50">
            <Smartphone className="h-3.5 w-3.5" />
          </div>
          <p className="truncate text-[11px] text-slate-200">
            <span className="font-semibold text-white">Remove browser header?</span>
            <span className="hidden sm:inline text-slate-400 ml-1">
              Hide &quot;sajju8378.github.io&quot; and run like a native app:
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleToggleFullscreen}
            className="flex items-center gap-1 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-white transition shadow-xs"
            title="Instantly hide browser header"
          >
            <Maximize className="h-3 w-3" />
            <span>Go Fullscreen</span>
          </button>

          <button
            onClick={handleInstallClick}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1 text-[11px] font-semibold text-white transition shadow-xs"
            title="Install app to phone home screen"
          >
            <Sparkles className="h-3 w-3 text-amber-300" />
            <span>Install App</span>
          </button>

          <button
            onClick={() => setIsDismissed(true)}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition ml-0.5"
            aria-label="Dismiss banner"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <NativeAppGuideModal
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
        onInstallPwa={install}
        canInstallDirectly={isInstallable}
      />
    </>
  );
};
