import React, { useState } from 'react';
import { Download, Share, PlusSquare, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { NativeAppGuideModal } from './NativeAppGuideModal';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [showNativeGuide, setShowNativeGuide] = useState(false);

  // If already running as an installed standalone PWA, offer the fullscreen / guide button
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (!ok) {
        setShowNativeGuide(true);
      }
    } else {
      setShowNativeGuide(true);
    }
  };

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
        >
          <Download className="h-3.5 w-3.5 text-indigo-400" />
          <span>Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
            <div className="relative w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl text-slate-100">
              <button
                onClick={() => setShowIOSGuide(false)}
                className="absolute right-4 top-4 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>

              <h3 className="text-base font-bold text-white">
                Install on iPhone / iPad
              </h3>
              <p className="mt-1 text-[11px] text-slate-400">
                Removes the browser URL bar and runs in native app view.
              </p>
              <div className="mt-4 space-y-2.5 text-xs text-slate-300">
                <p className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 font-bold text-indigo-400">1</span>
                  Tap the <Share className="h-4 w-4 text-indigo-400 inline" /> <strong>Share</strong> icon in Safari.
                </p>
                <p className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 font-bold text-indigo-400">2</span>
                  Scroll down and tap <PlusSquare className="h-4 w-4 text-indigo-400 inline" /> <strong>Add to Home Screen</strong>.
                </p>
              </div>

              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-indigo-600 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <button
        id="pwa-install-btn"
        onClick={handleInstallClick}
        className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-indigo-500"
        title="Install as Android Native App (Removes Browser Bar)"
      >
        <Smartphone className="h-3.5 w-3.5 text-emerald-300" />
        <span>Install App</span>
      </button>

      <NativeAppGuideModal
        isOpen={showNativeGuide}
        onClose={() => setShowNativeGuide(false)}
        onInstallPwa={install}
        canInstallDirectly={isInstallable}
      />
    </>
  );
};
