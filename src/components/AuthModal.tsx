import React, { useState, useEffect } from 'react';
import { ShieldCheck, Eye, EyeOff, KeyRound, UserCheck, AlertCircle, Server, Settings2, Smartphone, Globe, UserPlus, Database } from 'lucide-react';
import {
  generateRsaKeyPair,
  exportPrivateKey,
  importPrivateKey,
  importPublicKey,
  backupPrivateKeyWithPassword,
  restorePrivateKeyWithPassword,
  saveLocalUserPrivateKey,
  getLocalUserPrivateKey,
} from '../crypto/webCrypto';
import { ActiveSession } from '../types';
import {
  apiRegister,
  apiLogin,
  apiRotateKey,
  getStoredServerConfig,
  saveServerConfig,
  ServerConfig,
  getLocalUserList,
  LocalUserInfo,
} from '../lib/api';
import { ServerSettingsModal } from './ServerSettingsModal';

interface AuthModalProps {
  onAuthenticated: (session: ActiveSession) => void;
}

const STORAGE_KEY_LAST_USER = 'e2ee_last_username';

export const AuthModal: React.FC<AuthModalProps> = ({ onAuthenticated }) => {
  const [serverConfig, setServerConfig] = useState<ServerConfig>(getStoredServerConfig());
  const [localUsers, setLocalUsers] = useState<LocalUserInfo[]>([]);

  // If local mode and no users exist yet on this device, default to registration
  const [isRegister, setIsRegister] = useState(() => {
    const existing = getLocalUserList();
    return existing.length === 0;
  });

  const [username, setUsername] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_LAST_USER) || '';
  });
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Server settings modal state
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);

  useEffect(() => {
    setLocalUsers(getLocalUserList());
  }, [serverConfig]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanUsername = username.trim();
    if (!cleanUsername || !password) {
      setError('Please enter both username and password.');
      return;
    }

    setLoading(true);

    try {
      if (isRegister) {
        if (!/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(cleanUsername)) {
          setError('Username must be 3-20 characters, start with a letter, and contain only letters, numbers, and underscores.');
          setLoading(false);
          return;
        }

        setStatusText('Generating RSA 2048-bit keypair on device...');
        const { publicKeyPem, keyPair } = await generateRsaKeyPair();

        setStatusText('Securing private key with password encryption...');
        const keyBackup = await backupPrivateKeyWithPassword(
          keyPair.privateKey,
          password,
          cleanUsername
        );

        setStatusText('Registering account...');
        const data = await apiRegister(
          cleanUsername,
          displayName.trim() || cleanUsername,
          password,
          publicKeyPem,
          keyBackup
        );

        const pkcs8B64 = await exportPrivateKey(keyPair.privateKey);
        saveLocalUserPrivateKey(data.user.id, pkcs8B64);
        localStorage.setItem(STORAGE_KEY_LAST_USER, cleanUsername);

        onAuthenticated({
          token: data.token,
          user: data.user,
          keyPair,
        });
      } else {
        setStatusText('Authenticating credentials...');
        const data = await apiLogin(cleanUsername, password);

        let restoredPrivateKey: CryptoKey | null = null;
        const storedPkcs8 = getLocalUserPrivateKey(data.user.id);

        if (storedPkcs8) {
          try {
            restoredPrivateKey = await importPrivateKey(storedPkcs8);
          } catch (e) {
            console.warn('Failed to parse local private key:', e);
          }
        }

        // If not locally cached, restore from password-encrypted backup
        if (!restoredPrivateKey && data.user.keyBackup) {
          try {
            setStatusText('Restoring private encryption key from backup...');
            restoredPrivateKey = await restorePrivateKeyWithPassword(
              data.user.keyBackup,
              password,
              cleanUsername
            );
            const pkcs8 = await exportPrivateKey(restoredPrivateKey);
            saveLocalUserPrivateKey(data.user.id, pkcs8);
          } catch (e) {
            console.warn('Failed to restore private key with password:', e);
          }
        }

        // If still no private key (legacy account created without backup)
        let activePublicKeyPem = data.user.publicKey;
        if (!restoredPrivateKey) {
          setStatusText('Creating keypair session...');
          const { publicKeyPem, keyPair } = await generateRsaKeyPair();
          restoredPrivateKey = keyPair.privateKey;
          activePublicKeyPem = publicKeyPem;
          const newBackup = await backupPrivateKeyWithPassword(
            keyPair.privateKey,
            password,
            cleanUsername
          );
          await apiRotateKey(data.token, publicKeyPem, newBackup);
          const pkcs8 = await exportPrivateKey(keyPair.privateKey);
          saveLocalUserPrivateKey(data.user.id, pkcs8);
        }

        const publicKey = await importPublicKey(activePublicKeyPem);
        const keyPair: CryptoKeyPair = {
          publicKey,
          privateKey: restoredPrivateKey,
        };

        localStorage.setItem(STORAGE_KEY_LAST_USER, cleanUsername);

        onAuthenticated({
          token: data.token,
          user: { ...data.user, publicKey: activePublicKeyPem },
          keyPair,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  const handleSwitchToLocalMode = () => {
    const updated: ServerConfig = { mode: 'local', serverUrl: '' };
    saveServerConfig(updated);
    setServerConfig(updated);
    setLocalUsers(getLocalUserList());
    setError(null);
  };

  const handleQuickRegister = () => {
    setIsRegister(true);
    setError(null);
    if (!displayName && username) {
      setDisplayName(username.trim());
    }
  };

  const isUserNotFoundError =
    error &&
    (error.toLowerCase().includes('not found') ||
      error.toLowerCase().includes('not registered') ||
      error.toLowerCase().includes('no local accounts'));

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Simple E2EE Chat
            </h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {isRegister
                ? 'Create account with client-generated RSA 2048 keys'
                : 'Log in with your username or Unique ID'}
            </p>

            {/* Server Mode Pill & Config Button */}
            <div className="mt-2.5 flex items-center justify-center gap-2">
              <button
                type="button"
                id="server-mode-indicator-btn"
                onClick={() => setIsServerModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                {serverConfig.mode === 'turso' ? (
                  <>
                    <Database className="w-3 h-3 text-indigo-400" />
                    <span>Mode: <strong>Turso Cloud DB</strong></span>
                  </>
                ) : serverConfig.mode === 'local' ? (
                  <>
                    <Smartphone className="w-3 h-3 text-emerald-400" />
                    <span>Mode: <strong>Local Standalone</strong></span>
                  </>
                ) : (
                  <>
                    <Globe className="w-3 h-3 text-indigo-400" />
                    <span>Mode: <strong>Remote Backend Server</strong></span>
                  </>
                )}
                <Settings2 className="w-3 h-3 text-slate-400 ml-0.5" />
              </button>
            </div>
          </div>

          {/* Quick Account Chips if accounts exist on this device */}
          {serverConfig.mode === 'local' && !isRegister && localUsers.length > 0 && (
            <div className="mb-3 rounded-lg bg-slate-50 p-2.5 border border-slate-200 dark:bg-slate-800/60 dark:border-slate-700/60 text-xs">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block mb-1.5">
                Accounts on this device:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {localUsers.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setUsername(u.username);
                      setError(null);
                    }}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      username.toLowerCase() === u.username.toLowerCase()
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600'
                    }`}
                  >
                    @{u.username}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300 space-y-2">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>

              {/* Quick action button to register directly if account wasn't found */}
              {isUserNotFoundError && !isRegister && (
                <div className="pl-6 pt-1">
                  <button
                    type="button"
                    onClick={handleQuickRegister}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-xs transition"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Register '{username.trim() || 'New User'}' on This Device
                  </button>
                </div>
              )}

              {serverConfig.mode === 'cloud' && (
                <div className="pl-6 pt-1">
                  <button
                    type="button"
                    onClick={handleSwitchToLocalMode}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-[11px] shadow-xs transition"
                  >
                    Switch to Local Standalone Mode (Works on GitHub Pages)
                  </button>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {isRegister ? 'Username' : 'Username or User ID'}
              </label>
              <input
                id="auth-username-input"
                type="text"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={isRegister ? 'alice' : 'alice or E2E-...'}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 transition focus:border-indigo-500 focus:bg-slate-800 focus:text-white focus:outline-none"
              />
              {isRegister && (
                <p className="mt-1 text-[11px] text-slate-500">
                  3–20 characters, starting with a letter.
                </p>
              )}
            </div>

            {isRegister && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Display Name
                </label>
                <input
                  id="auth-displayname-input"
                  type="text"
                  autoCapitalize="words"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alice Walker"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 transition focus:border-indigo-500 focus:bg-slate-800 focus:text-white focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Password
              </label>
              <div className="relative">
                <input
                  id="auth-password-input"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 pr-10 text-sm text-white placeholder:text-slate-500 transition focus:border-indigo-500 focus:bg-slate-800 focus:text-white focus:outline-none"
                />
                <button
                  type="button"
                  id="toggle-password-visibility-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              id="auth-submit-btn"
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {statusText || 'Processing...'}
                </span>
              ) : isRegister ? (
                <>
                  <KeyRound className="h-4 w-4" />
                  Generate Keys & Register
                </>
              ) : (
                <>
                  <UserCheck className="h-4 w-4" />
                  Log In
                </>
              )}
            </button>
          </form>

          <div className="mt-5 border-t border-slate-200 pt-4 text-center dark:border-slate-800">
            <button
              type="button"
              id="auth-toggle-mode-btn"
              onClick={() => {
                setIsRegister(!isRegister);
                setError(null);
              }}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              {isRegister
                ? 'Already have an account? Log in'
                : "Don't have an account? Create one"}
            </button>
          </div>
        </div>
      </div>

      <ServerSettingsModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
        onConfigChanged={(cfg) => {
          setServerConfig(cfg);
          setLocalUsers(getLocalUserList());
        }}
      />
    </>
  );
};
