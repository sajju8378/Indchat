import React, { useState } from 'react';
import { ShieldCheck, Eye, EyeOff, KeyRound, UserCheck, AlertCircle } from 'lucide-react';
import { generateRsaKeyPair } from '../crypto/webCrypto';
import { ActiveSession, User } from '../types';

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

        setStatusText('Registering account with server...');
        const res = await fetch('/v1/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username.trim(),
            displayName: displayName.trim() || username.trim(),
            password,
            publicKey: publicKeyPem,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Registration failed');
        }

        onAuthenticated({
          token: data.token,
          user: data.user,
          keyPair,
        });
      } else {
        setStatusText('Logging in...');
        const res = await fetch('/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username.trim(),
            password,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Login failed');
        }

        setStatusText('Generating session cryptographic keypair...');
        const { publicKeyPem, keyPair } = await generateRsaKeyPair();

        // Update server public key for this new web device session
        await fetch('/v1/account/rotate-key', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${data.token}`,
          },
          body: JSON.stringify({
            publicKey: publicKeyPem,
          }),
        });

        onAuthenticated({
          token: data.token,
          user: { ...data.user, publicKey: publicKeyPem },
          keyPair,
        });
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 text-center">
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
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              {isRegister ? 'Username' : 'Username or User ID'}
            </label>
            <input
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
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 pr-10 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
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
  );
};
