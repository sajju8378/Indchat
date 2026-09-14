import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import {
  QrCode,
  Share2,
  Copy,
  Check,
  Camera,
  X,
  Database,
  ExternalLink,
  Smartphone,
  AlertCircle,
  MessageCircle,
  ClipboardPaste,
} from 'lucide-react';
import {
  ServerConfig,
  generateTursoShareLink,
  parseConnectionParam,
  saveServerConfig,
  apiTestTurso,
} from '../lib/api';

interface SyncDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverConfig: ServerConfig;
  onConfigUpdated: (config: ServerConfig) => void;
  defaultTab?: 'share' | 'scan';
}

export const SyncDeviceModal: React.FC<SyncDeviceModalProps> = ({
  isOpen,
  onClose,
  serverConfig,
  onConfigUpdated,
  defaultTab = 'share',
}) => {
  const [activeTab, setActiveTab] = useState<'share' | 'scan'>(defaultTab);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [shareLink, setShareLink] = useState('');

  // Scan & Import state
  const [pastedInput, setPastedInput] = useState('');
  const [scanningCamera, setScanningCamera] = useState(false);
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab);
      setImportStatus(null);
      setPastedInput('');
      const link = generateTursoShareLink(serverConfig);
      setShareLink(link);

      if (link) {
        QRCode.toDataURL(link, {
          width: 300,
          margin: 2,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
        })
          .then((url) => setQrCodeDataUrl(url))
          .catch((err) => console.error('Failed to generate QR code:', err));
      } else {
        setQrCodeDataUrl('');
      }
    } else {
      stopCamera();
    }
  }, [isOpen, serverConfig, defaultTab]);

  const stopCamera = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setScanningCamera(false);
  };

  const handleCopyLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = shareLink;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleShareWhatsApp = () => {
    if (!shareLink) return;
    const text = encodeURIComponent(
      `Join me on Indchat! Connect our phones instantly by tapping this link:\n${shareLink}`
    );
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
  };

  const handleNativeShare = async () => {
    if (!shareLink) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Connect to Indchat',
          text: 'Join me on Indchat! Open this link to connect our phones together:',
          url: shareLink,
        });
      } catch {
        // User cancelled or unsupported
      }
    } else {
      handleCopyLink();
    }
  };

  const applyImportedParams = async (params: { tursoUrl?: string; tursoAuthToken?: string }) => {
    if (!params.tursoUrl || !params.tursoAuthToken) {
      setImportStatus({ type: 'error', text: 'Invalid invite link or QR code format.' });
      return;
    }

    setIsProcessing(true);
    setImportStatus(null);
    try {
      const test = await apiTestTurso(params.tursoUrl, params.tursoAuthToken);
      if (test.ok) {
        const newConfig: ServerConfig = {
          mode: 'turso',
          serverUrl: '',
          tursoUrl: params.tursoUrl,
          tursoAuthToken: params.tursoAuthToken,
        };
        saveServerConfig(newConfig);
        onConfigUpdated(newConfig);
        setImportStatus({
          type: 'success',
          text: `Successfully connected to Turso database! (${test.userCount ?? 0} existing users found). You can now register or login.`,
        });
        stopCamera();
        setTimeout(() => {
          onClose();
        }, 1800);
      } else {
        setImportStatus({ type: 'error', text: test.message });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportStatus({ type: 'error', text: `Connection test failed: ${msg}` });
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setPastedInput(text);
        const parsed = parseConnectionParam(text);
        if (parsed?.tursoUrl && parsed?.tursoAuthToken) {
          await applyImportedParams(parsed);
        } else {
          setImportStatus({
            type: 'error',
            text: 'Clipboard does not contain a valid Indchat connection link.',
          });
        }
      }
    } catch {
      setImportStatus({
        type: 'error',
        text: 'Could not access clipboard automatically. Please paste the link into the box below.',
      });
    }
  };

  const handleManualImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pastedInput.trim()) return;
    const parsed = parseConnectionParam(pastedInput.trim());
    if (parsed?.tursoUrl && parsed?.tursoAuthToken) {
      await applyImportedParams(parsed);
    } else {
      setImportStatus({
        type: 'error',
        text: 'Unrecognized format. Please paste the full invite link or QR code text.',
      });
    }
  };

  const startCameraScan = async () => {
    setImportStatus(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanningCamera(true);

      // Check if BarcodeDetector is supported
      if ('BarcodeDetector' in window) {
        const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        scanIntervalRef.current = window.setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const barcodes = await barcodeDetector.detect(videoRef.current);
            if (barcodes && barcodes.length > 0) {
              const rawValue = barcodes[0].rawValue;
              if (rawValue) {
                stopCamera();
                const parsed = parseConnectionParam(rawValue);
                if (parsed?.tursoUrl && parsed?.tursoAuthToken) {
                  await applyImportedParams(parsed);
                } else {
                  setImportStatus({
                    type: 'error',
                    text: 'QR code scanned, but it is not an Indchat connection link.',
                  });
                }
              }
            }
          } catch {
            // ignore scan frame errors
          }
        }, 500);
      } else {
        setImportStatus({
          type: 'error',
          text: 'Camera active. Your browser does not have native QR decoding; please paste the invite link or use your phone camera app to open the QR code.',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportStatus({
        type: 'error',
        text: `Camera access denied or unavailable: ${msg}. Please paste the invite link instead.`,
      });
      stopCamera();
    }
  };

  if (!isOpen) return null;

  const hasConfig = !!(serverConfig.tursoUrl?.trim() && serverConfig.tursoAuthToken?.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <QrCode className="w-5 h-5 text-indigo-400" />
            <span>Connect & Sync Multiple Mobiles</span>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setActiveTab('share');
            }}
            className={`py-2 px-3 rounded-lg font-semibold transition flex items-center justify-center gap-1.5 ${
              activeTab === 'share'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Show QR / Share (Phone 1)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scan')}
            className={`py-2 px-3 rounded-lg font-semibold transition flex items-center justify-center gap-1.5 ${
              activeTab === 'scan'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Scan / Import (Phone 2)</span>
          </button>
        </div>

        {/* TAB 1: SHOW QR CODE & SHARE (FROM PHONE 1) */}
        {activeTab === 'share' && (
          <div className="space-y-4">
            {hasConfig ? (
              <>
                <div className="text-xs text-slate-300 space-y-1">
                  <p className="leading-relaxed">
                    Point your second mobile's camera at this QR code, or send the link via WhatsApp. Both phones will immediately share the same secure cloud database!
                  </p>
                </div>

                {qrCodeDataUrl ? (
                  <div className="flex flex-col items-center justify-center p-4 bg-white rounded-2xl shadow-inner border border-slate-200">
                    <img
                      src={qrCodeDataUrl}
                      alt="Indchat Connection QR Code"
                      className="w-56 h-56 object-contain rounded-lg"
                    />
                    <span className="text-[11px] font-bold text-slate-700 mt-2 flex items-center gap-1">
                      <Smartphone className="w-3.5 h-3.5 text-indigo-600" />
                      Scan with any camera or Indchat app
                    </span>
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400 bg-slate-950 rounded-xl">
                    Generating QR code...
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleShareWhatsApp}
                    className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition"
                  >
                    <MessageCircle className="w-4 h-4" />
                    Share via WhatsApp
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied!' : 'Copy Invite Link'}
                  </button>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 break-all space-y-1">
                  <div className="font-semibold text-slate-300">Invite Link:</div>
                  <div className="font-mono text-[10px] text-indigo-400 truncate select-all">{shareLink}</div>
                </div>
              </>
            ) : (
              <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-200 text-xs space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Turso Cloud Database Not Configured Yet</span>
                </div>
                <p className="text-[11px] leading-relaxed text-amber-300/90">
                  To share a connection with another phone, this phone must first have Turso credentials entered or imported.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('scan')}
                    className="w-full py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition flex items-center justify-center gap-1.5"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Scan QR Code from your other device instead
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: SCAN QR OR PASTE LINK (FROM PHONE 2) */}
        {activeTab === 'scan' && (
          <div className="space-y-4">
            <div className="text-xs text-slate-300">
              <p className="leading-relaxed">
                Connect this phone by scanning the QR code displayed on your first phone, or by pasting the invite link sent via WhatsApp.
              </p>
            </div>

            {/* Live Camera Scanner */}
            {scanningCamera ? (
              <div className="relative rounded-2xl overflow-hidden border-2 border-indigo-500 bg-black aspect-square flex items-center justify-center">
                <video ref={videoRef} playsInline autoPlay muted className="w-full h-full object-cover" />
                <div className="absolute inset-0 border-2 border-indigo-400/50 m-8 rounded-xl pointer-events-none animate-pulse" />
                <button
                  type="button"
                  onClick={stopCamera}
                  className="absolute top-3 right-3 p-1.5 rounded-full bg-slate-900/80 text-white hover:bg-slate-900 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={startCameraScan}
                  className="py-3 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex flex-col items-center justify-center gap-1.5 shadow-sm transition"
                >
                  <Camera className="w-5 h-5" />
                  <span>Scan with Camera</span>
                </button>

                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className="py-3 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex flex-col items-center justify-center gap-1.5 shadow-sm transition"
                >
                  <ClipboardPaste className="w-5 h-5 text-indigo-400" />
                  <span>Paste from Clipboard</span>
                </button>
              </div>
            )}

            {/* Manual Paste Form */}
            <form onSubmit={handleManualImport} className="space-y-2">
              <label className="block text-[11px] font-medium text-slate-300">
                Or paste the invite link / code here:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pastedInput}
                  onChange={(e) => setPastedInput(e.target.value)}
                  placeholder="https://sajju8378.github.io/#connect=... or libsql://..."
                  className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                />
                <button
                  type="submit"
                  disabled={isProcessing || !pastedInput.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition shrink-0"
                >
                  {isProcessing ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </form>

            {/* Status alerts */}
            {importStatus && (
              <div
                className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                  importStatus.type === 'success'
                    ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/50'
                    : 'bg-red-950/40 text-red-300 border border-red-800/50'
                }`}
              >
                {importStatus.type === 'success' ? (
                  <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed">{importStatus.text}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
