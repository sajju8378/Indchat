import React, { useState, useEffect } from 'react';
import { ShieldCheck, Smartphone, MessageSquare, Server, Globe, Database } from 'lucide-react';
import { ActiveSession, User } from './types';
import { AuthModal } from './components/AuthModal';
import { RecentChats } from './components/RecentChats';
import { ChatView } from './components/ChatView';
import { AndroidInfoModal } from './components/AndroidInfoModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ServerSettingsModal } from './components/ServerSettingsModal';
import { FullscreenHeaderBanner } from './components/FullscreenHeaderBanner';
import { getStoredServerConfig, ServerConfig } from './lib/api';
import { getStoredSession, saveStoredSession, clearStoredSession } from './lib/session';

export default function App() {
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [activePeer, setActivePeer] = useState<User | null>(null);
  const [showAndroidInfo, setShowAndroidInfo] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfig>(getStoredServerConfig());

  // Attempt restoring session on mount with strict timeout fallback
  useEffect(() => {
    let mounted = true;
    const safetyTimer = setTimeout(() => {
      if (mounted) {
        setIsRestoringSession(false);
      }
    }, 1200);

    (async () => {
      try {
        const saved = await getStoredSession();
        if (mounted && saved) {
          setSession(saved);
        }
      } catch (err) {
        console.warn('Session restoration failed:', err);
      } finally {
        if (mounted) {
          clearTimeout(safetyTimer);
          setIsRestoringSession(false);
        }
      }
    })();
    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
    };
  }, []);

  const handleAuthenticated = async (newSession: ActiveSession) => {
    setSession(newSession);
    await saveStoredSession(newSession);
  };

  const handleLogout = () => {
    clearStoredSession();
    setSession(null);
    setActivePeer(null);
  };

  if (isRestoringSession) {
    return (
      <div className="flex h-[100dvh] w-full flex-col items-center justify-center bg-slate-950 text-slate-100">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <p className="text-xs text-slate-400">Loading Indchat...</p>
        </div>
      </div>
    );
  }

  // If no session, show AuthModal
  if (!session) {
    return (
      <div className="relative flex min-h-[100dvh] w-full flex-col bg-slate-950 text-slate-100">
        <FullscreenHeaderBanner />
        <div className="relative flex flex-1 w-full flex-col items-center justify-center p-2 sm:p-4">
          <div className="absolute top-3 right-3 flex items-center gap-2 z-20">
            <PWAInstallButton />
            <button
              id="open-android-info-btn-auth"
              onClick={() => setShowAndroidInfo(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              <Smartphone className="h-4 w-4 text-emerald-400" />
              <span className="hidden sm:inline">Android APK & Build Info</span>
            </button>
          </div>

          <AuthModal onAuthenticated={handleAuthenticated} />
          <AndroidInfoModal
            isOpen={showAndroidInfo}
            onClose={() => setShowAndroidInfo(false)}
          />
          <OfflineIndicator />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-slate-950 text-slate-100 overflow-hidden">
      <FullscreenHeaderBanner />
      {/* Top Application Bar */}
      <header
        className={`${
          activePeer ? 'hidden md:flex' : 'flex'
        } h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-3 sm:px-5 shadow-xs`}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">
              Indchat
            </h1>
            <p className="text-[10px] text-slate-400 hidden sm:block">
              Zero-Knowledge RSA-2048-OAEP & AES-256-GCM
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Server Config Badge */}
          <button
            id="header-server-mode-btn"
            onClick={() => setShowServerSettings(true)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
            title="Backend Server Configuration"
          >
            {serverConfig.mode === 'turso' ? (
              <>
                <Database className="h-3.5 w-3.5 text-indigo-400" />
                <span className="text-[11px] hidden md:inline">Turso DB</span>
              </>
            ) : serverConfig.mode === 'local' ? (
              <>
                <Server className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-[11px] hidden md:inline">Local Engine</span>
              </>
            ) : (
              <>
                <Globe className="h-3.5 w-3.5 text-indigo-400" />
                <span className="text-[11px] hidden md:inline">Cloud Server</span>
              </>
            )}
          </button>

          <PWAInstallButton />

          <button
            id="header-android-guide-btn"
            onClick={() => setShowAndroidInfo(true)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            <Smartphone className="h-4 w-4 text-emerald-400" />
            <span className="hidden sm:inline">APK Guide</span>
          </button>

          <div className="flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-1 text-xs border border-slate-700">
            <span className="font-semibold text-slate-200">
              {session.user.displayName}
            </span>
            <span className="text-slate-400 hidden sm:inline">(@{session.user.username})</span>
          </div>
        </div>
      </header>

      {/* Main Chat Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Side: Recent Chats & User Search */}
        <div
          className={`${
            activePeer ? 'hidden md:flex' : 'flex'
          } w-full md:w-80 lg:w-96 flex-col`}
        >
          <RecentChats
            session={session}
            onSelectPeer={(peer) => setActivePeer(peer)}
            onLogout={handleLogout}
            onOpenAndroidInfo={() => setShowAndroidInfo(true)}
          />
        </div>

        {/* Right Side: Active Chat View or Placeholder */}
        <div
          className={`${
            activePeer ? 'flex' : 'hidden md:flex'
          } flex-1 flex-col overflow-hidden`}
        >
          {activePeer ? (
            <ChatView
              session={session}
              peer={activePeer}
              onBack={() => setActivePeer(null)}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 p-6 text-center dark:bg-slate-950">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
                <MessageSquare className="h-8 w-8" />
              </div>
              <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
                Select a conversation or start a new chat
              </h2>
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                Search for any registered user to initiate a zero-knowledge, end-to-end encrypted
                conversation with delivery and read receipts.
              </p>
            </div>
          )}
        </div>
      </div>

      <ServerSettingsModal
        isOpen={showServerSettings}
        onClose={() => setShowServerSettings(false)}
        onConfigChanged={(cfg) => setServerConfig(cfg)}
      />

      <AndroidInfoModal
        isOpen={showAndroidInfo}
        onClose={() => setShowAndroidInfo(false)}
      />
      <OfflineIndicator />
    </div>
  );
}
