import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Paperclip,
  Camera,
  ArrowLeft,
  Check,
  CheckCheck,
  ShieldCheck,
  Code2,
  Image as ImageIcon,
  Lock,
} from 'lucide-react';
import { ActiveSession, DecryptedUIMessage, User } from '../types';
import { decryptEnvelope, encryptEnvelope } from '../crypto/webCrypto';
import {
  apiGetConversation,
  apiSendMessage,
  apiMarkDelivered,
  apiMarkRead,
} from '../lib/api';

interface ChatViewProps {
  session: ActiveSession;
  peer: User;
  onBack: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({ session, peer, onBack }) => {
  const [messages, setMessages] = useState<DecryptedUIMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [inspectMessage, setInspectMessage] = useState<DecryptedUIMessage | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const peerKeyRef = useRef<string>(peer.publicKey);

  // Auto-scroll on message updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Polling loop (3s interval)
  useEffect(() => {
    let isSubscribed = true;

    const fetchMessages = async () => {
      try {
        const rawList = await apiGetConversation(peer.id, session.token);
        if (!isSubscribed) return;

        const decryptedList: DecryptedUIMessage[] = [];
        const unreadIds: string[] = [];
        const undeliveredIds: string[] = [];

        for (const msg of rawList) {
          const isMe = msg.senderId === session.user.id;
          let text = '';
          let isImage = false;
          let imageData: string | undefined;
          let error: string | undefined;

          if (isMe) {
            // My sent message (we store decrypted text locally in cache, or display payload)
            text = msg.cachedText || '[Sent Encrypted Message]';
            if (msg.cachedImage) {
              isImage = true;
              imageData = msg.cachedImage;
            }
          } else {
            // Incoming message to decrypt
            try {
              const decryptedPlaintext = await decryptEnvelope(
                {
                  encryptedKey: msg.encryptedKey,
                  ciphertext: msg.ciphertext,
                  iv: msg.iv,
                  authTag: msg.authTag,
                },
                session.keyPair.privateKey
              );

              try {
                const parsed = JSON.parse(decryptedPlaintext);
                if (parsed.type === 'image') {
                  isImage = true;
                  imageData = parsed.data;
                  text = '[Photo]';
                } else {
                  text = decryptedPlaintext;
                }
              } catch {
                text = decryptedPlaintext;
              }
            } catch (err: any) {
              error = 'Unable to decrypt message (Key mismatch)';
              text = '[Encrypted message]';
            }

            if (msg.status !== 'read') {
              unreadIds.push(msg.id);
            }
            if (msg.status === 'sent') {
              undeliveredIds.push(msg.id);
            }
          }

          decryptedList.push({
            id: msg.id,
            senderId: msg.senderId,
            recipientId: msg.recipientId,
            createdAt: msg.createdAt,
            status: msg.status,
            text,
            isImage,
            imageData,
            error,
            rawCiphertext: msg.ciphertext,
            rawEncryptedKey: msg.encryptedKey,
            rawIv: msg.iv,
            rawAuthTag: msg.authTag,
          });
        }

        if (isSubscribed) {
          // Merge with any optimistic local text
          setMessages((prev) => {
            const map = new Map<string, DecryptedUIMessage>();
            prev.forEach((m) => map.set(m.id, m));
            decryptedList.forEach((m) => {
              const existing = map.get(m.id);
              if (existing && existing.text && !m.error) {
                map.set(m.id, { ...m, text: existing.text, imageData: existing.imageData });
              } else {
                map.set(m.id, m);
              }
            });
            return Array.from(map.values());
          });
        }

        // Send receipts
        if (unreadIds.length > 0) {
          await apiMarkRead(session.token, unreadIds);
        } else if (undeliveredIds.length > 0) {
          await apiMarkDelivered(session.token, undeliveredIds);
        }
      } catch (e) {
        // network polling retry
      }
    };

    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [peer.id, session.token, session.user.id, session.keyPair.privateKey]);

  const handleSend = async (payload: string, isImage = false, base64Image?: string) => {
    if (!payload.trim() && !isImage) return;

    setSending(true);
    const tempId = `tmp_${Date.now()}`;
    const now = Date.now();

    // Optimistic message
    const optMsg: DecryptedUIMessage = {
      id: tempId,
      senderId: session.user.id,
      recipientId: peer.id,
      createdAt: now,
      status: 'sent',
      text: isImage ? '[Photo]' : payload,
      isImage,
      imageData: base64Image,
    };
    setMessages((prev) => [...prev, optMsg]);
    setInputText('');

    try {
      // 1. Encrypt payload with recipient's public key
      const envelope = await encryptEnvelope(payload, peerKeyRef.current, peer.id);

      // 2. Transmit envelope to backend
      const data = await apiSendMessage(session.token, envelope);

      // Update message ID with real server ID
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? {
                ...m,
                id: data.message.id,
                status: 'sent',
                rawCiphertext: envelope.ciphertext,
                rawEncryptedKey: envelope.encryptedKey,
                rawIv: envelope.iv,
                rawAuthTag: envelope.authTag,
              }
            : m
        )
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, error: err.message || 'Send failed' } : m))
      );
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      const payload = JSON.stringify({
        type: 'image',
        data: base64,
      });
      handleSend(payload, true, base64);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex h-full flex-col bg-slate-100 dark:bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 font-bold text-white shadow-xs">
            {peer.displayName.charAt(0).toUpperCase() || peer.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-900 dark:text-white">
                {peer.displayName || peer.username}
              </span>
              <span className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400">
                <ShieldCheck className="h-3 w-3" />
                RSA-2048 E2EE
              </span>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">@{peer.username}</span>
          </div>
        </div>

        <button
          onClick={() => {
            alert(
              `Peer Public Key Fingerprint (SPKI):\n${peer.publicKey.slice(0, 120)}...\n\nAll messages to this user are encrypted client-side using RSA-OAEP SHA-256 and AES-256-GCM.`
            );
          }}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Key Fingerprint
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50 dark:bg-slate-950">
        <div className="my-2 flex justify-center">
          <div className="flex items-center gap-1.5 rounded-full bg-slate-200/80 px-3 py-1 text-[11px] text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
            <Lock className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            <span>Messages are end-to-end encrypted. No one else can read them.</span>
          </div>
        </div>

        {messages.map((msg) => {
          const isSent = msg.senderId === session.user.id;
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isSent ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`group relative max-w-[80%] sm:max-w-md rounded-2xl px-4 py-2.5 shadow-xs ${
                  isSent
                    ? 'rounded-br-xs bg-indigo-600 text-white'
                    : 'rounded-bl-xs border border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white'
                }`}
              >
                {/* Photo attachment rendering */}
                {msg.isImage && msg.imageData ? (
                  <div className="mb-2 overflow-hidden rounded-xl">
                    <img
                      src={`data:image/jpeg;base64,${msg.imageData}`}
                      alt="Encrypted attachment"
                      className="max-h-60 w-full object-cover"
                    />
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {msg.text}
                  </p>
                )}

                {msg.error && (
                  <p className="mt-1 text-[11px] text-amber-200">{msg.error}</p>
                )}

                <div
                  className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] ${
                    isSent ? 'text-indigo-200' : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  <span>{formatTime(msg.createdAt)}</span>

                  {isSent && (
                    <span className="flex items-center">
                      {msg.status === 'read' ? (
                        <CheckCheck className="h-3.5 w-3.5 text-cyan-300" title="Read (✓✓)" />
                      ) : msg.status === 'delivered' ? (
                        <CheckCheck className="h-3.5 w-3.5 text-slate-300" title="Delivered (✓✓)" />
                      ) : (
                        <Check className="h-3.5 w-3.5 text-indigo-300" title="Sent (✓)" />
                      )}
                    </span>
                  )}

                  {/* Cryptographic Inspector Button */}
                  <button
                    onClick={() => setInspectMessage(msg)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 p-0.5 rounded hover:bg-black/20"
                    title="Inspect Zero-Knowledge Encrypted Envelope"
                  >
                    <Code2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend(inputText);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="image/*"
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            title="Attach Photo"
          >
            <Paperclip className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            title="Take Photo"
          >
            <Camera className="h-5 w-5" />
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type encrypted message..."
            className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />

          <button
            type="submit"
            disabled={!inputText.trim() || sending}
            className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-xs transition hover:bg-indigo-700 disabled:opacity-50"
          >
            <Send className="h-5 w-5" />
          </button>
        </form>
      </div>

      {/* Cryptographic Envelope Inspector Modal */}
      {inspectMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Code2 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-bold text-slate-900 dark:text-white">
                  Zero-Knowledge Envelope Inspector
                </h3>
              </div>
              <button
                onClick={() => setInspectMessage(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <p className="mt-2 text-xs text-slate-500">
              This exact payload was transmitted across the network and stored on the server. Notice that
              the server NEVER receives plaintext or private keys.
            </p>

            <div className="mt-4 space-y-3 font-mono text-[11px]">
              <div>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Ciphertext (AES-256-GCM):
                </span>
                <div className="mt-1 max-h-20 overflow-y-auto break-all rounded-lg bg-slate-100 p-2 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  {inspectMessage.rawCiphertext || 'N/A'}
                </div>
              </div>

              <div>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Encrypted AES Key (RSA-OAEP SHA-256):
                </span>
                <div className="mt-1 max-h-20 overflow-y-auto break-all rounded-lg bg-slate-100 p-2 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  {inspectMessage.rawEncryptedKey || 'N/A'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">IV:</span>
                  <div className="mt-1 break-all rounded-lg bg-slate-100 p-2 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                    {inspectMessage.rawIv || 'N/A'}
                  </div>
                </div>
                <div>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Auth Tag:</span>
                  <div className="mt-1 break-all rounded-lg bg-slate-100 p-2 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                    {inspectMessage.rawAuthTag || 'N/A'}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setInspectMessage(null)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
