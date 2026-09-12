import React, { useState } from 'react';
import { ShieldCheck, Smartphone, MessageSquare, Server, Globe } from 'lucide-react';
import { ActiveSession, User } from './types';
import { AuthModal } from './components/AuthModal';
import { RecentChats } from './components/RecentChats';
import { ChatView } from './components/ChatView';
import { AndroidInfoModal } from './components/AndroidInfoModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ServerSettingsModal } from './components/ServerSettingsModal';
import { getStoredServerConfig, ServerConfig } from './lib/api';

export default function App() {
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [activePeer, setActivePeer] = useState<User | null>(null);
  const [showAndroidInfo, setShowAndroidInfo] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfig>(getStoredServerConfig());

  // If no session, show AuthModal
  if (!session) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-slate-900 text-slate-100">
        <div className="absolute top-4 right-4 flex items-center gap-2">
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

        <AuthModal onAuthenticated={(newSession) => setSession(newSession)} />
        <AndroidInfoModal
          isOpen={showAndroidInfo}
          onClose={() => setShowAndroidInfo(false)}
        />
        <OfflineIndicator />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Top Application Bar */}
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-3 sm:px-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
              Simple E2EE Chat
            </h1>
            <p className="text-[10px] text-slate-500 hidden sm:block">
              Zero-Knowledge RSA-2048-OAEP & AES-256-GCM
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Server Config Badge */}
          <button
            id="header-server-mode-btn"
            onClick={() => setShowServerSettings(true)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            title="Backend Server Configuration"
          >
            {serverConfig.mode === 'local' ? (
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
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Smartphone className="h-4 w-4 text-emerald-500" />
            <span className="hidden sm:inline">APK Guide</span>
          </button>

          <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1 text-xs dark:bg-slate-800">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
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
            onLogout={() => {
              setSession(null);
              setActivePeer(null);
            }}
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
