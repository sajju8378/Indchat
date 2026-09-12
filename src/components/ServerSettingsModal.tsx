import React, { useState } from 'react';
import { Server, Smartphone, Globe, Database, CheckCircle2, AlertCircle, X, RefreshCw } from 'lucide-react';
import { getStoredServerConfig, saveServerConfig, ServerConfig, apiTestTurso } from '../lib/api';

interface ServerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigChanged?: (config: ServerConfig) => void;
}

export const ServerSettingsModal: React.FC<ServerSettingsModalProps> = ({
  isOpen,
  onClose,
  onConfigChanged,
}) => {
  const [config, setConfig] = useState<ServerConfig>(getStoredServerConfig());
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  if (!isOpen) return null;

  const handleSave = () => {
    saveServerConfig(config);
    if (onConfigChanged) {
      onConfigChanged(config);
    }
    onClose();
  };

  const handleTestConnection = async () => {
    if (config.mode === 'local') {
      setTestStatus('success');
      setTestMessage('Local Standalone Engine is active (100% in-browser WebCrypto & device storage).');
      return;
    }

    if (config.mode === 'turso') {
      if (!config.tursoUrl?.trim() || !config.tursoAuthToken?.trim()) {
        setTestStatus('error');
        setTestMessage('Please enter both your Turso Database URL and Auth Token.');
        return;
      }
      setTestStatus('testing');
      setTestMessage('Connecting to Turso Database and verifying tables...');
      try {
        const res = await apiTestTurso(config.tursoUrl.trim(), config.tursoAuthToken.trim());
        if (res.ok) {
          setTestStatus('success');
          setTestMessage(res.message);
        } else {
          setTestStatus('error');
          setTestMessage(res.message);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setTestStatus('error');
        setTestMessage(`Turso connection failed: ${msg}`);
      }
      return;
    }

    setTestStatus('testing');
    setTestMessage('Testing connection to backend server...');

    let url = config.serverUrl.trim();
    if (url.endsWith('/')) url = url.slice(0, -1);
    const target = url ? `${url}/v1/health` : '/v1/health';

    try {
      const res = await fetch(target);
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        setTestStatus('error');
        setTestMessage(`Host responded with HTML (${res.status}), not an API server. On GitHub Pages, use Turso DB or Local Standalone Mode.`);
        return;
      }

      if (res.ok && data.status === 'ok') {
        setTestStatus('success');
        setTestMessage(`Successfully connected to ${target}!`);
      } else {
        setTestStatus('error');
        setTestMessage(`Server returned error: ${JSON.stringify(data)}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setTestStatus('error');
      setTestMessage(
        `Failed to reach server at ${target}. (${message}). Please verify the URL and CORS headers.`
      );
    }
  };

  return (
    <div
      id="server-settings-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
    >
      <div
        id="server-settings-dialog"
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Database className="w-5 h-5 text-indigo-400" />
            <span>Database & Server Settings</span>
          </div>
          <button
            id="close-server-settings-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-xs text-slate-300 space-y-1">
          <p>
            Choose where your E2EE messages and user public keys are saved. On static hosts like <strong>GitHub Pages</strong>, use <strong>Turso Cloud DB</strong> for real-time multi-device syncing.
          </p>
        </div>

        <div className="space-y-3">
          {/* Option 1: Turso Cloud DB (Preferred for multi-device GitHub Pages) */}
          <div
            id="mode-turso-option"
            onClick={() => setConfig({ ...config, mode: 'turso' })}
            className={`cursor-pointer p-4 rounded-xl border transition flex items-start gap-3 ${
              config.mode === 'turso'
                ? 'border-indigo-500 bg-indigo-950/30 text-white shadow-md shadow-indigo-950/40'
                : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400 shrink-0 mt-0.5">
              <Database className="w-5 h-5" />
            </div>
            <div className="space-y-1.5 text-sm w-full">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-white">Turso Cloud Database</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-700 font-medium">
                  Multi-Device & GitHub Pages
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Connect directly to your Turso SQLite database (libsql). Syncs encrypted messages between different phones and computers seamlessly on GitHub Pages.
              </p>

              {config.mode === 'turso' && (
                <div className="mt-3 space-y-3 pt-3 border-t border-slate-800/80" onClick={(e) => e.stopPropagation()}>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Turso Database URL
                    </label>
                    <input
                      id="turso-url-input"
                      type="text"
                      value={config.tursoUrl || ''}
                      onChange={(e) => setConfig({ ...config, tursoUrl: e.target.value })}
                      placeholder="e.g. libsql://your-db-name.turso.io"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Turso Auth Token
                    </label>
                    <input
                      id="turso-token-input"
                      type="password"
                      value={config.tursoAuthToken || ''}
                      onChange={(e) => setConfig({ ...config, tursoAuthToken: e.target.value })}
                      placeholder="eyJhbGciOi..."
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={testStatus === 'testing'}
                      className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5 transition"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${testStatus === 'testing' ? 'animate-spin' : ''}`} />
                      Test Turso Connection
                    </button>
                    <span className="text-[10px] text-slate-400">Auto-initializes tables</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Option 2: Local Standalone Engine */}
          <div
            id="mode-local-option"
            onClick={() => setConfig({ ...config, mode: 'local' })}
            className={`cursor-pointer p-4 rounded-xl border transition flex items-start gap-3 ${
              config.mode === 'local'
                ? 'border-indigo-500 bg-indigo-950/30 text-white'
                : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">Local Standalone Mode</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800">
                  Single Device
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Zero server or setup needed. 100% in-browser WebCrypto RSA-2048 & AES-256-GCM.
              </p>
            </div>
          </div>

          {/* Option 3: Remote Backend Server */}
          <div
            id="mode-cloud-option"
            onClick={() => setConfig({ ...config, mode: 'cloud' })}
            className={`cursor-pointer p-4 rounded-xl border transition flex items-start gap-3 ${
              config.mode === 'cloud'
                ? 'border-indigo-500 bg-indigo-950/30 text-white'
                : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 shrink-0 mt-0.5">
              <Globe className="w-5 h-5" />
            </div>
            <div className="space-y-1 text-sm w-full">
              <div className="font-semibold text-white">Custom Backend Server</div>
              <p className="text-xs text-slate-400">
                Connects to a dedicated Express/Node.js backend with SQLite or Turso.
              </p>

              {config.mode === 'cloud' && (
                <div className="mt-3 space-y-2 pt-2 border-t border-slate-800/80" onClick={(e) => e.stopPropagation()}>
                  <label className="block text-xs font-medium text-slate-300">
                    Server Base URL
                  </label>
                  <input
                    id="server-url-input"
                    type="url"
                    value={config.serverUrl}
                    onChange={(e) => setConfig({ ...config, serverUrl: e.target.value })}
                    placeholder="e.g. https://your-backend.run.app"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={testStatus === 'testing'}
                      className="text-[11px] px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${testStatus === 'testing' ? 'animate-spin' : ''}`} />
                      Test Link
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Test connection alert */}
        {testStatus !== 'idle' && (
          <div
            className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
              testStatus === 'success'
                ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                : testStatus === 'error'
                ? 'bg-rose-950/60 border border-rose-800 text-rose-300'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            {testStatus === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
            ) : testStatus === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            ) : (
              <RefreshCw className="w-4 h-4 shrink-0 mt-0.5 animate-spin text-slate-400" />
            )}
            <span className="leading-relaxed">{testMessage}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800/80">
          <button
            id="cancel-server-settings-btn"
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            Cancel
          </button>
          <button
            id="save-server-settings-btn"
            type="button"
            onClick={handleSave}
            className="px-5 py-2 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-lg shadow-indigo-600/30"
          >
            Apply & Save
          </button>
        </div>
      </div>
    </div>
  );
};

