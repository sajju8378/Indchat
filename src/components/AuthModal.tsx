import React, { useState, useEffect } from 'react';
import { ShieldCheck, Eye, EyeOff, KeyRound, UserCheck, AlertCircle, Settings2, Smartphone, Globe, UserPlus, Database, X, RotateCcw, QrCode } from 'lucide-react';
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
  apiResetLocalPassword,
  apiRemoveLocalUser,
  apiOverwriteRegister,
  apiTestTurso,
  getStoredServerConfig,
  saveServerConfig,
  ServerConfig,
  getLocalUserList,
  LocalUserInfo,
  parseConnectionParam,
} from '../lib/api';
import { ServerSettingsModal } from './ServerSettingsModal';
import { SyncDeviceModal } from './SyncDeviceModal';

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

  // Password reset mode state
  const [isResetMode, setIsResetMode] = useState(false);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Server settings & Sync modal state
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  // Inline Turso configuration state for rapid 1-click cloud database setup
  const [inlineTursoUrl, setInlineTursoUrl] = useState(serverConfig.tursoUrl || '');
  const [inlineTursoToken, setInlineTursoToken] = useState(serverConfig.tursoAuthToken || '');
  const [inlineTesting, setInlineTesting] = useState(false);
  const [inlineTursoMsg, setInlineTursoMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    setInlineTursoUrl(serverConfig.tursoUrl || '');
    setInlineTursoToken(serverConfig.tursoAuthToken || '');
  }, [serverConfig]);

  const handleTursoUrlChange = (val: string) => {
    const trimmed = val.trim();
    const parsed = parseConnectionParam(trimmed);
    if (parsed?.tursoUrl && parsed?.tursoAuthToken) {
      setInlineTursoUrl(parsed.tursoUrl);
      setInlineTursoToken(parsed.tursoAuthToken);
      setInlineTursoMsg({
        type: 'success',
        text: 'Extracted Turso Database URL and Auth Token from connection link! Tap "Save & Connect Turso".',
      });
      return;
    }
    setInlineTursoUrl(val);
  };

  const handleSaveInlineTurso = async () => {
    const url = inlineTursoUrl.trim();
    const token = inlineTursoToken.trim();
    if (!url || !token) {
      setInlineTursoMsg({ type: 'error', text: 'Please enter both Turso Database URL and Auth Token.' });
      return;
    }

    setInlineTesting(true);
    setInlineTursoMsg(null);
    try {
      const res = await apiTestTurso(url, token);
      if (res.ok) {
        const updated: ServerConfig = {
          ...serverConfig,
          mode: 'turso',
          tursoUrl: url,
          tursoAuthToken: token,
        };
        saveServerConfig(updated);
        setServerConfig(updated);
        setInlineTursoMsg({ type: 'success', text: `Connected to Turso! (${res.userCount ?? 0} users found)` });
        setError(null);
      } else {
        setInlineTursoMsg({ type: 'error', text: res.message });
      }
    } catch (err: unknown) {
      setInlineTursoMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setInlineTesting(false);
    }
  };

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
    setIsResetMode(false);
    setError(null);
    if (!displayName && username) {
      setDisplayName(username.trim());
    }
  };

  const handleStartResetPassword = (targetUser?: string) => {
    setIsResetMode(true);
    if (targetUser) {
      setUsername(targetUser.trim());
    }
    setResetNewPassword('');
    setResetConfirmPassword('');
    setError(null);
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanUsername = username.trim();
    if (!cleanUsername) {
      setError('Please enter a username to reset.');
      return;
    }
    const cleanPassword = resetNewPassword.trim();
    if (cleanPassword.length < 3) {
      setError('New password must be at least 3 characters long.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setError('Passwords do not match. Please verify and retype.');
      return;
    }

    setLoading(true);
    setStatusText('Updating encryption keys and credentials on device...');
    try {
      const result = await apiResetLocalPassword(cleanUsername, cleanPassword);
      localStorage.setItem(STORAGE_KEY_LAST_USER, cleanUsername);
      onAuthenticated({
        token: result.token,
        user: result.user,
        keyPair: result.keyPair,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to reset password.');
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  const handleRemoveLocalAccount = (e: React.MouseEvent, targetUser: string) => {
    e.stopPropagation();
    const clean = targetUser.trim();
    if (!clean) return;
    const confirmed = window.confirm(`Remove local account '@${clean}' from this device?`);
    if (!confirmed) return;

    apiRemoveLocalUser(clean);
    const updatedUsers = getLocalUserList();
    setLocalUsers(updatedUsers);
    if (username.toLowerCase() === clean.toLowerCase()) {
      setUsername(updatedUsers[0]?.username || '');
      setPassword('');
    }
    setError(null);
  };

  const handleOverwriteRegister = async () => {
    const cleanUsername = username.trim();
    if (!cleanUsername || !password) {
      setError('Please enter both username and password.');
      return;
    }

    setLoading(true);
    setStatusText('Generating fresh RSA 2048-bit keypair on device...');
    try {
      const { publicKeyPem, keyPair } = await generateRsaKeyPair();
      setStatusText('Securing private key with password...');
      const keyBackup = await backupPrivateKeyWithPassword(
        keyPair.privateKey,
        password,
        cleanUsername
      );
      setStatusText('Resetting and registering account on device...');
      const data = await apiOverwriteRegister(
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to overwrite account.');
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  const isUserNotFoundError =
    error &&
    (error.toLowerCase().includes('not found') ||
      error.toLowerCase().includes('not registered') ||
      error.toLowerCase().includes('no local accounts'));

  const isIncorrectPasswordError =
    error && error.toLowerCase().includes('incorrect password');

  const isAlreadyRegisteredError =
    error && error.toLowerCase().includes('already registered');

  const isTursoConfigError =
    error &&
    (error.includes('TURSO_CONFIG_REQUIRED') ||
      error.toLowerCase().includes('database url or auth token is missing') ||
      error.toLowerCase().includes('turso credentials'));

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Indchat
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
                    <span>Mode: <strong>Turso Cloud DB (Permanent)</strong></span>
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

          {/* Turso Cloud Database inline card when in Turso mode */}
          {serverConfig.mode === 'turso' && (!serverConfig.tursoUrl?.trim() || !serverConfig.tursoAuthToken?.trim()) && (
            <div className="mb-4 rounded-2xl border border-indigo-500/30 bg-indigo-950/30 p-4 text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span className="font-bold text-slate-100">Permanent Turso Cloud Storage</span>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-900/80 text-indigo-300 border border-indigo-700/50">
                  Multi-Device Chat
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mb-3 leading-relaxed">
                Connect your database to chat between multiple phones on GitHub Pages.
              </p>

              {/* FAST 1-CLICK ACTION: SCAN QR OR PASTE LINK FROM PHONE 1 */}
              <button
                type="button"
                onClick={() => setIsSyncModalOpen(true)}
                className="w-full mb-3 py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-bold text-xs shadow-md transition flex items-center justify-center gap-2"
              >
                <QrCode className="w-4 h-4" />
                <span>Connect via QR Code or Link from Phone 1</span>
              </button>

              <div className="space-y-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Database URL or Invite Link
                  </label>
                  <input
                    type="text"
                    value={inlineTursoUrl}
                    onChange={(e) => handleTursoUrlChange(e.target.value)}
                    placeholder="libsql://... or paste https://...#connect=..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Auth Token
                  </label>
                  <input
                    type="password"
                    value={inlineTursoToken}
                    onChange={(e) => setInlineTursoToken(e.target.value)}
                    placeholder="ey..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {inlineTursoMsg && (
                  <div
                    className={`p-2.5 rounded-xl text-[11px] ${
                      inlineTursoMsg.type === 'error'
                        ? 'bg-red-950/40 text-red-300 border border-red-800/50'
                        : 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/50'
                    }`}
                  >
                    {inlineTursoMsg.text}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={inlineTesting}
                    onClick={handleSaveInlineTurso}
                    className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs transition"
                  >
                    {inlineTesting ? 'Testing Connection...' : 'Save & Connect Turso'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const updated: ServerConfig = { ...serverConfig, mode: 'local' };
                      saveServerConfig(updated);
                      setServerConfig(updated);
                      setError(null);
                    }}
                    className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition"
                    title="Switch to Local Single-Device Mode"
                  >
                    Use Local Mode
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Connected Turso Database Status Pill */}
          {serverConfig.mode === 'turso' && serverConfig.tursoUrl?.trim() && serverConfig.tursoAuthToken?.trim() && (
            <div className="mb-3 rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 flex items-center justify-between text-xs text-emerald-300">
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="truncate text-[11px]">
                  Turso DB: <strong>{serverConfig.tursoUrl.replace(/^libsql:\/\//, '').replace(/\.turso\.io.*$/, '')}</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsServerModalOpen(true)}
                className="text-[11px] font-semibold text-emerald-400 hover:underline shrink-0 ml-2"
              >
                Settings
              </button>
            </div>
          )}

          {/* Quick Account Chips if accounts exist on this device */}
          {serverConfig.mode === 'local' && !isRegister && !isResetMode && localUsers.length > 0 && (
            <div className="mb-3 rounded-lg bg-slate-50 p-2.5 border border-slate-200 dark:bg-slate-800/60 dark:border-slate-700/60 text-xs">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block mb-1.5">
                Accounts on this device (tap to select or × to remove):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {localUsers.map((u) => (
                  <div
                    key={u.id}
                    className={`inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg text-xs font-semibold transition ${
                      username.toLowerCase() === u.username.toLowerCase()
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setUsername(u.username);
                        setError(null);
                      }}
                      className="hover:underline"
                    >
                      @{u.username}
                    </button>
                    <button
                      type="button"
                      title={`Remove @${u.username} from this device`}
                      onClick={(e) => handleRemoveLocalAccount(e, u.username)}
                      className="p-0.5 rounded hover:bg-black/20 dark:hover:bg-white/20 text-current opacity-70 hover:opacity-100 transition"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
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

              {/* Action when incorrect password error occurs */}
              {isIncorrectPasswordError && (
                <div className="pl-6 pt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleStartResetPassword(username)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-xs transition"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset Password for @{username.trim() || 'User'}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleRemoveLocalAccount(e, username)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-700/80 hover:bg-rose-700 text-white font-medium text-xs shadow-xs transition"
                  >
                    <X className="h-3 w-3" />
                    Remove from Device
                  </button>
                </div>
              )}

              {/* Action when username is already registered */}
              {isAlreadyRegisteredError && (
                <div className="pl-6 pt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsRegister(false);
                      setIsResetMode(false);
                      setError(null);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-xs transition"
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    Log in as @{username.trim()}
                  </button>
                  <button
                    type="button"
                    onClick={handleOverwriteRegister}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs shadow-xs transition"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset & Overwrite on Device
                  </button>
                </div>
              )}

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

              {/* Action when Turso credentials are required */}
              {isTursoConfigError && (
                <div className="pl-6 pt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSyncModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-xs transition"
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    Scan QR / Paste Link from Phone 1
                  </button>
                  <button
                    type="button"
                    onClick={handleSwitchToLocalMode}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-xs shadow-xs transition"
                  >
                    <Smartphone className="h-3.5 w-3.5" />
                    Switch to Local Mode & Register Now
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

          {isResetMode ? (
            <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
              <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 p-3 text-xs text-indigo-900 dark:text-indigo-200 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Password for @{username.trim() || 'Account'}
                </p>
                <p className="text-[11px] opacity-90">
                  Set a new password for this device. Your local message history will be preserved.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Account Username
                </label>
                <input
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 transition focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showResetPassword ? 'text' : 'password'}
                    required
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                    placeholder="At least 3 characters"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 pr-10 text-sm text-white placeholder:text-slate-500 transition focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(!showResetPassword)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-200"
                    aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                  >
                    {showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Confirm New Password
                </label>
                <input
                  type={showResetPassword ? 'text' : 'password'}
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                  placeholder="Re-type new password"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 transition focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {statusText || 'Saving...'}
                  </span>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4" />
                    Save New Password & Log In
                  </>
                )}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsResetMode(false);
                    setError(null);
                  }}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition"
                >
                  ← Cancel and Return to Log In
                </button>
              </div>
            </form>
          ) : (
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
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Password
                  </label>
                  {!isRegister && serverConfig.mode === 'local' && (
                    <button
                      type="button"
                      onClick={() => handleStartResetPassword(username)}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 transition"
                    >
                      Reset password?
                    </button>
                  )}
                </div>
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
          )}

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

      <SyncDeviceModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        serverConfig={serverConfig}
        onConfigUpdated={(cfg) => {
          setServerConfig(cfg);
          setInlineTursoUrl(cfg.tursoUrl || '');
          setInlineTursoToken(cfg.tursoAuthToken || '');
          setLocalUsers(getLocalUserList());
          setError(null);
        }}
        defaultTab="scan"
      />
    </>
  );
};
