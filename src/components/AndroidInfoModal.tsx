import React from 'react';
import { Smartphone, Terminal, Cloud, ShieldAlert, X, Copy, Check } from 'lucide-react';

interface AndroidInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AndroidInfoModal: React.FC<AndroidInfoModalProps> = ({ isOpen, onClose }) => {
  const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);

  if (!isOpen) return null;

  const copyCode = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Android App & Deployment Guide
            </h2>
            <p className="text-xs text-slate-500">
              Native Kotlin Android client with Android Keystore encryption
            </p>
          </div>
        </div>

        <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5 dark:border-indigo-900/30 dark:bg-indigo-950/20">
            <div className="flex items-center gap-2 font-semibold text-indigo-700 dark:text-indigo-300">
              <ShieldAlert className="h-4 w-4" />
              <span>Zero-Knowledge Cryptography</span>
            </div>
            <p className="mt-1 text-slate-600 dark:text-slate-400">
              Both the Android client and this web companion use client-side RSA 2048-bit keys
              with RSA-OAEP SHA-256 and AES-256-GCM. The server stores only ciphertext envelopes and
              has zero access to private keys or plaintext.
            </p>
          </div>

          <div>
            <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
              <Terminal className="h-4 w-4 text-indigo-500" />
              Building the Android APK Locally
            </h3>
            <div className="mt-2 rounded-lg bg-slate-950 p-3 font-mono text-[11px] text-slate-200">
              <div className="flex items-center justify-between pb-1 text-slate-400">
                <span>Bash / Terminal</span>
                <button
                  onClick={() => copyCode('cd android && ./gradlew assembleDebug', 1)}
                  className="flex items-center gap-1 hover:text-white"
                >
                  {copiedIndex === 1 ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedIndex === 1 ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <code>cd android && ./gradlew assembleDebug</code>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              APK output: <span className="font-mono">android/app/build/outputs/apk/debug/app-debug.apk</span>
            </p>
          </div>

          <div>
            <h3 className="font-bold uppercase tracking-wider text-slate-900 dark:text-white">
              Zero Configuration - Works Anywhere
            </h3>
            <p className="mt-1">
              Your Android app is now pre-configured to connect automatically to the hosted cloud backend and sync with Turso DB:
            </p>
            <div className="mt-1.5 rounded-lg bg-slate-100 p-2.5 font-mono text-[11px] text-slate-800 dark:bg-slate-800 dark:text-slate-200 break-all">
              https://ais-dev-tqvv3pehwwutotp5fwjgou-312216031270.asia-southeast1.run.app
            </div>
            <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              ✓ No manual IP address entry required. Works across any mobile data (4G/5G) or Wi-Fi network like WhatsApp and Telegram.
            </p>
          </div>

          <div>
            <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
              <Cloud className="h-4 w-4 text-blue-500" />
              Render Production Deployment
            </h3>
            <p className="mt-1">
              The project includes a production blueprint <span className="font-mono">render.yaml</span>. To deploy:
            </p>
            <ol className="mt-1.5 list-inside list-decimal space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
              <li>Push this repository to GitHub.</li>
              <li>In Render Dashboard, click <strong>New &gt; Blueprint</strong> and link the repo.</li>
              <li>Render automatically detects <span className="font-mono">render.yaml</span> and starts Node.js 22.</li>
              <li>Point your Android app and web client to your Render URL (e.g., <span className="font-mono">https://simple-e2ee-chat.onrender.com</span>).</li>
            </ol>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
