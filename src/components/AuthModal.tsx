import React, { useState } from 'react';
import { ShieldCheck, Eye, EyeOff, KeyRound, UserCheck, AlertCircle, Server, Settings2, Smartphone, Globe } from 'lucide-react';
import { generateRsaKeyPair } from '../crypto/webCrypto';
import { ActiveSession } from '../types';
import { apiRegister, apiLogin, apiRotateKey, getStoredServerConfig, saveServerConfig, ServerConfig } from '../lib/api';
import { ServerSettingsModal } from './ServerSettingsModal';

interface AuthModalProps {
  onAuthenticated: (session: ActiveSession) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onAuthenticated }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Server settings modal state
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfig>(getStoredServerConfig());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError('Please enter both username and password.');
      return;
    }

    setLoading(true);

    try {
      if (isRegister) {
        if (!/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(username.trim())) {
          setError('Username must be 3-20 characters, start with a letter, and contain only letters, numbers, and underscores.');
          setLoading(false);
          return;
        }

        setStatusText('Generating RSA 2048-bit keypair on device...');
        const { publicKeyPem, keyPair } = await generateRsaKeyPair();

        setStatusText('Registering account...');
        const data = await apiRegister(
          username.trim(),
          displayName.trim() || username.trim(),
          password,
          publicKeyPem
        );

        onAuthenticated({
          token: data.token,
          user: data.user,
          keyPair,
        });
      } else {
        setStatusText('Logging in...');
        const data = await apiLogin(username.trim(), password);

        setStatusText('Generating session cryptographic keypair...');
        const { publicKeyPem, keyPair } = await generateRsaKeyPair();

        // Update server public key for this new web device session
        await apiRotateKey(data.token, publicKeyPem);

        onAuthenticated({
          token: data.token,
          user: { ...data.user, publicKey: publicKeyPem },
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
    setError(null);
  };

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
                {serverConfig.mode === 'local' ? (
                  <>
                    <Smartphone className="w-3 h-3 text-emerald-400" />
                    <span>Mode: <strong>Local Standalone (GitHub Pages)</strong></span>
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

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300 space-y-2">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
              {serverConfig.mode === 'cloud' && (
                <div className="pl-6 pt-1">
                  <button
                    type="button"
                    onClick={handleSwitchToLocalMode}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-[11px] shadow-sm transition"
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
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={isRegister ? 'alice' : 'alice or E2E-...'}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
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
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alice Walker"
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
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
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 pr-10 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
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
        onConfigChanged={(cfg) => setServerConfig(cfg)}
      />
    </>
  );
};
