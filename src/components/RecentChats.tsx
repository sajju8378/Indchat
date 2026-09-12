import React, { useState, useEffect } from 'react';
import {
  Search,
  Plus,
  LogOut,
  Shield,
  Smartphone,
  CheckCheck,
  Check,
  User as UserIcon,
} from 'lucide-react';
import { ActiveSession, User } from '../types';
import { apiSearchUsers } from '../lib/api';

interface RecentChatsProps {
  session: ActiveSession;
  onSelectPeer: (peer: User) => void;
  onLogout: () => void;
  onOpenAndroidInfo: () => void;
}

export const RecentChats: React.FC<RecentChatsProps> = ({
  session,
  onSelectPeer,
  onLogout,
  onOpenAndroidInfo,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const list = await apiSearchUsers(searchQuery.trim(), session.token);
        // Filter out myself
        setSearchResults(list.filter((u) => u.id !== session.user.id));
      } catch (e) {
        // search error
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, session.user.id]);

  return (
    <div className="flex h-full flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Header Profile Section */}
      <div className="border-b border-slate-200 p-4 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white shadow-xs">
              {session.user.displayName.charAt(0).toUpperCase() ||
                session.user.username.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-900 dark:text-white">
                  {session.user.displayName || session.user.username}
                </span>
                <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                  Online
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                @{session.user.username}
              </p>
              <p className="font-mono text-[10px] text-slate-400">
                My ID: {session.user.id}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={onOpenAndroidInfo}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              title="Android APK & Deployment Guide"
            >
              <Smartphone className="h-4 w-4" />
            </button>
            <button
              onClick={onLogout}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-red-400"
              title="Log Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Search / New Chat Bar */}
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => setShowSearchModal(true)}
            className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-400 hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-800"
          >
            <Search className="h-4 w-4" />
            <span>Search users or unique ID...</span>
          </button>
          <button
            onClick={() => setShowSearchModal(true)}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700"
            title="Start New Chat"
          >
            <Plus className="h-4 w-4" />
            <span>New</span>
          </button>
        </div>
      </div>

      {/* Quick Search Modal */}
      {showSearchModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-20 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Find User to Message
              </h3>
              <button
                onClick={() => {
                  setShowSearchModal(false);
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="relative mt-2">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search username or display name..."
                className="w-full rounded-xl border border-slate-700 bg-slate-800 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-slate-400 focus:border-indigo-500 focus:bg-slate-800 focus:text-white focus:outline-none"
              />
            </div>

            <div className="mt-4 max-h-60 overflow-y-auto space-y-1">
              {searching ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  Searching directory...
                </div>
              ) : searchResults.length > 0 ? (
                searchResults.map((user) => (
                  <div
                    key={user.id}
                    onClick={() => {
                      onSelectPeer(user);
                      setShowSearchModal(false);
                      setSearchQuery('');
                    }}
                    className="flex cursor-pointer items-center justify-between rounded-xl p-2.5 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 font-bold dark:bg-indigo-950/60 dark:text-indigo-400">
                        {user.displayName.charAt(0).toUpperCase() ||
                          user.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white">
                          {user.displayName || user.username}
                        </p>
                        <p className="text-[11px] text-slate-500">@{user.username}</p>
                      </div>
                    </div>
                    <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                      Chat E2EE
                    </span>
                  </div>
                ))
              ) : searchQuery.trim() ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  No users found matching &quot;{searchQuery}&quot;
                </div>
              ) : (
                <div className="py-6 text-center text-xs text-slate-400">
                  Type a username to find contacts in the directory
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Directory & Quick Chat suggestions */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-2 px-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          User Directory & Conversations
        </div>
        <p className="px-2 text-xs text-slate-500">
          Click <strong>New</strong> or search above to start an end-to-end encrypted conversation with any user.
        </p>
      </div>
    </div>
  );
};
