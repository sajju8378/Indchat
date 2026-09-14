import React, { useState, useEffect } from 'react';
import { Smartphone, X, Maximize, ExternalLink, CheckCircle2, Sparkles, Chrome, ArrowRight } from 'lucide-react';

interface NativeAppGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInstallPwa?: () => Promise<boolean>;
  canInstallDirectly?: boolean;
}

export const NativeAppGuideModal: React.FC<NativeAppGuideModalProps> = ({
  isOpen,
  onClose,
  onInstallPwa,
  canInstallDirectly = false,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  if (!isOpen) return null;

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen request failed:', err);
    }
  };

  const handleInstallClick = async () => {
    if (canInstallDirectly && onInstallPwa) {
      const ok = await onInstallPwa();
      if (ok) {
        onClose();
      }
    }
  };

  return (
    <div
      id="native-app-guide-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        id="native-app-guide-dialog"
        className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600/30 text-indigo-400 border border-indigo-500/40">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Remove Header & Run Like an App</h2>
              <p className="text-[11px] text-slate-400">Native standalone full-screen experience</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-xs">
          {/* Explanation */}
          <div className="rounded-xl bg-indigo-950/40 border border-indigo-800/40 p-3">
            <p className="font-semibold text-indigo-300 text-xs mb-1">
              Why does &quot;sajju8378.github.io&quot; appear at the top?
            </p>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              When opened through WhatsApp or a mobile browser tab, Android shows the browser domain bar at the top. Once you install the app to your home screen or enter App Mode, the browser header disappears completely!
            </p>
          </div>

          {/* Direct Install Button if browser supports it */}
          {canInstallDirectly && (
            <button
              onClick={handleInstallClick}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center justify-center gap-2 shadow-lg transition"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>Tap to Install on Phone (1-Click)</span>
            </button>
          )}

          {/* Quick Option 1: Instant Fullscreen Mode */}
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <Maximize className="w-3.5 h-3.5 text-emerald-400" />
                Option 1: Instant Full-Screen App Mode
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800">
                Instant
              </span>
            </div>
            <p className="text-slate-400 text-[11px]">
              Instantly expand to full screen and hide the browser navigation bar:
            </p>
            <button
              onClick={handleToggleFullscreen}
              className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 font-semibold flex items-center justify-center gap-2 border border-slate-700 transition"
            >
              <Maximize className="w-4 h-4" />
              <span>{isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen (App Mode)'}</span>
            </button>
          </div>

          {/* Option 2: Add to Home Screen (Android / Chrome) */}
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <Chrome className="w-3.5 h-3.5 text-indigo-400" />
                Option 2: Add to Phone Home Screen (Permanent)
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800">
                Recommended
              </span>
            </div>
            <ol className="space-y-2 text-[11px] text-slate-300">
              <li className="flex items-start gap-2">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-900/80 text-[10px] font-bold text-indigo-300">
                  1
                </span>
                <span>
                  Tap the <strong>three dots menu (⋮)</strong> in the top-right corner of your browser.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-900/80 text-[10px] font-bold text-indigo-300">
                  2
                </span>
                <span>
                  If opened inside WhatsApp, tap <strong>&quot;Open in Chrome&quot;</strong> first.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-900/80 text-[10px] font-bold text-indigo-300">
                  3
                </span>
                <span>
                  Tap <strong>&quot;Install app&quot;</strong> or <strong>&quot;Add to Home screen&quot;</strong>.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-900/80 text-[10px] font-bold text-emerald-300">
                  ✓
                </span>
                <span className="text-emerald-300 font-medium">
                  Launch the app from your home screen icon — the URL header is completely removed!
                </span>
              </li>
            </ol>
          </div>
        </div>

        <div className="mt-5 pt-3 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
