import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Phone,
  SwitchCamera,
  ShieldCheck,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { User, CallType, CallStatus } from '../types';
import { callAudio } from '../utils/callSounds';

interface CallModalProps {
  isOpen: boolean;
  peer: User;
  callType: CallType;
  isIncoming?: boolean;
  onEndCall: () => void;
}

export const CallModal: React.FC<CallModalProps> = ({
  isOpen,
  peer,
  callType,
  isIncoming = false,
  onEndCall,
}) => {
  const [status, setStatus] = useState<CallStatus>(isIncoming ? 'incoming' : 'calling');
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isSpeakerOff, setIsSpeakerOff] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isMinimized, setIsMinimized] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Initialize Media Streams
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    async function setupMedia() {
      try {
        const constraints: MediaStreamConstraints = {
          audio: true,
          video:
            callType === 'video'
              ? {
                  facingMode,
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                }
              : false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStreamRef.current = stream;

        if (localVideoRef.current && callType === 'video') {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }

        // Setup audio visualizer on mic
        try {
          const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const actx = new AudioCtx();
          audioContextRef.current = actx;
          const source = actx.createMediaStreamSource(stream);
          const analyser = actx.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);

          const buffer = new Uint8Array(analyser.frequencyBinCount);
          const updateAudioMeter = () => {
            if (!isMounted) return;
            analyser.getByteFrequencyData(buffer);
            let sum = 0;
            for (let i = 0; i < buffer.length; i++) {
              sum += buffer[i];
            }
            const avg = sum / buffer.length;
            setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
            animFrameRef.current = requestAnimationFrame(updateAudioMeter);
          };
          updateAudioMeter();
        } catch {
          // Visualizer optional
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isMounted) {
          setErrorMessage(`Media access notice: ${msg}`);
        }
      }
    }

    setupMedia();

    // Ringtones
    if (isIncoming) {
      callAudio.startIncomingRingtone();
    } else {
      callAudio.startOutgoingRingtone();
      // Auto-connect call after a realistic ringing interval for instant live experience
      const connectTimer = window.setTimeout(() => {
        if (!isMounted) return;
        setStatus('connected');
        callAudio.playCallConnectedTone();
      }, 3200);

      return () => {
        window.clearTimeout(connectTimer);
      };
    }

    return () => {
      isMounted = false;
      callAudio.stopRingtone();
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
    };
  }, [isOpen, callType, facingMode, isIncoming]);

  // Duration Timer
  useEffect(() => {
    let timer: number | null = null;
    if (status === 'connected') {
      timer = window.setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer !== null) window.clearInterval(timer);
    };
  }, [status]);

  if (!isOpen) return null;

  const handleAcceptIncoming = () => {
    callAudio.stopRingtone();
    callAudio.playCallConnectedTone();
    setStatus('connected');
  };

  const handleDeclineIncoming = () => {
    callAudio.stopRingtone();
    callAudio.playCallEndedTone();
    onEndCall();
  };

  const handleHangUp = () => {
    callAudio.stopRingtone();
    callAudio.playCallEndedTone();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    onEndCall();
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const flipCamera = async () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);

    if (localStreamRef.current && callType === 'video') {
      localStreamRef.current.getVideoTracks().forEach((t) => t.stop());
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: nextMode },
        });
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (newVideoTrack) {
          localStreamRef.current.addTrack(newVideoTrack);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
          }
        }
      } catch (e) {
        console.warn('Could not switch camera:', e);
      }
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Minimized floating bubble
  if (isMinimized) {
    return (
      <div className="fixed bottom-20 right-4 z-50 flex items-center gap-2 rounded-2xl bg-slate-900 border border-slate-700 p-2 shadow-2xl animate-fade-in text-white">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 font-bold">
          {peer.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="text-xs pr-2">
          <p className="font-semibold">{peer.displayName}</p>
          <p className="text-[10px] text-emerald-400">
            {status === 'connected' ? formatDuration(callDuration) : 'Calling...'}
          </p>
        </div>
        <button
          onClick={() => setIsMinimized(false)}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
          title="Expand Call"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onClick={handleHangUp}
          className="p-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white"
          title="End Call"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-slate-950 text-white p-4 select-none backdrop-blur-md">
      {/* Top Bar */}
      <div className="flex w-full max-w-xl items-center justify-between pt-2">
        <div className="flex items-center gap-2 rounded-full bg-slate-900/80 px-3 py-1 text-xs border border-slate-800 backdrop-blur-sm">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-[11px] font-medium text-slate-300">
            End-to-End Encrypted ({callType === 'video' ? 'HD Video' : 'HQ Audio'})
          </span>
        </div>

        <button
          onClick={() => setIsMinimized(true)}
          className="rounded-full bg-slate-800/80 p-2 text-slate-300 hover:bg-slate-700 transition"
          title="Minimize to floating window"
        >
          <Minimize2 className="h-4 w-4" />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="relative flex w-full max-w-xl flex-1 flex-col items-center justify-center my-4 overflow-hidden rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl">
        {callType === 'video' && status === 'connected' ? (
          <div className="relative h-full w-full bg-black flex items-center justify-center">
            {/* Simulated Remote Video Stream */}
            <div className="relative h-full w-full flex items-center justify-center overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/40 via-slate-950 to-slate-900 flex flex-col items-center justify-center">
                <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-indigo-600 text-3xl font-bold shadow-2xl">
                  {peer.displayName.charAt(0).toUpperCase()}
                  {/* Subtle live audio pulse ring */}
                  <span
                    className="absolute inset-0 rounded-full border-2 border-indigo-400 animate-ping opacity-30"
                    style={{ animationDuration: '2.5s' }}
                  />
                </div>
                <h3 className="mt-4 text-lg font-bold">{peer.displayName}</h3>
                <span className="text-xs text-emerald-400 font-medium">Video Connected • 720p HD</span>
              </div>
            </div>

            {/* Local PiP Video Preview */}
            <div className="absolute bottom-4 right-4 h-36 w-24 sm:h-44 sm:w-32 overflow-hidden rounded-2xl border-2 border-indigo-500 bg-slate-950 shadow-2xl">
              {!isVideoOff ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover transform -scale-x-100"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center bg-slate-900 text-[10px] text-slate-400">
                  <VideoOff className="w-5 h-5 mb-1 text-slate-500" />
                  <span>Camera Off</span>
                </div>
              )}
              <div className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
                You
              </div>
            </div>
          </div>
        ) : (
          /* Audio Call View */
          <div className="flex flex-col items-center justify-center p-6 text-center">
            {/* Pulsing Avatar */}
            <div className="relative flex items-center justify-center">
              {/* Dynamic Sound Ripple Rings */}
              {status === 'connected' && (
                <div
                  className="absolute rounded-full bg-indigo-500/20 transition-all duration-100 ease-out"
                  style={{
                    width: `${120 + audioLevel * 1.5}px`,
                    height: `${120 + audioLevel * 1.5}px`,
                  }}
                />
              )}
              <div className="flex h-24 w-24 sm:h-28 sm:w-28 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-500 text-3xl sm:text-4xl font-extrabold shadow-xl">
                {peer.displayName.charAt(0).toUpperCase()}
              </div>
            </div>

            <h2 className="mt-5 text-xl font-bold tracking-tight text-white">
              {peer.displayName}
            </h2>
            <p className="text-xs text-slate-400">@{peer.username}</p>

            <div className="mt-3">
              {status === 'calling' && (
                <div className="flex items-center gap-1.5 text-xs text-indigo-400 animate-pulse">
                  <span className="h-2 w-2 rounded-full bg-indigo-400" />
                  <span>Ringing...</span>
                </div>
              )}
              {status === 'incoming' && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 animate-pulse font-semibold">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span>Incoming {callType === 'video' ? 'Video' : 'Audio'} Call...</span>
                </div>
              )}
              {status === 'connected' && (
                <div className="rounded-full bg-slate-800/90 px-3 py-1 text-xs text-emerald-400 font-mono font-medium border border-slate-700">
                  {formatDuration(callDuration)}
                </div>
              )}
            </div>

            {/* Live Audio Activity Bars */}
            {status === 'connected' && (
              <div className="mt-6 flex items-center gap-1 h-6">
                {[20, 45, 75, 90, 60, 30, 80, 50, 25].map((h, i) => (
                  <span
                    key={i}
                    className="w-1 rounded-full bg-indigo-400 transition-all duration-75"
                    style={{
                      height: `${Math.max(4, Math.round((h * (audioLevel || 25)) / 100))}px`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {errorMessage && (
          <div className="absolute top-3 left-3 right-3 rounded-lg bg-amber-900/80 px-3 py-1.5 text-[11px] text-amber-200 border border-amber-700/60 text-center">
            {errorMessage}
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="w-full max-w-xl pb-4">
        {status === 'incoming' ? (
          /* Incoming Call Accept / Decline */
          <div className="flex items-center justify-around px-8">
            <button
              onClick={handleDeclineIncoming}
              className="flex flex-col items-center gap-2 text-xs font-semibold text-rose-400 hover:text-rose-300"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg transition hover:scale-105 active:scale-95">
                <PhoneOff className="h-6 w-6" />
              </div>
              <span>Decline</span>
            </button>

            <button
              onClick={handleAcceptIncoming}
              className="flex flex-col items-center gap-2 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition hover:scale-105 active:scale-95 animate-bounce">
                <Phone className="h-6 w-6" />
              </div>
              <span>Accept</span>
            </button>
          </div>
        ) : (
          /* Active Call Controls */
          <div className="flex items-center justify-center gap-3 sm:gap-5 rounded-3xl bg-slate-900/90 border border-slate-800 px-6 py-4 shadow-xl backdrop-blur-md">
            {/* Mic Toggle */}
            <button
              onClick={toggleMute}
              className={`flex h-12 w-12 items-center justify-center rounded-2xl transition ${
                isMuted
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>

            {/* Video Toggle (if video call) */}
            {callType === 'video' && (
              <>
                <button
                  onClick={toggleVideo}
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl transition ${
                    isVideoOff
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                  title={isVideoOff ? 'Turn video on' : 'Turn video off'}
                >
                  {isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                </button>

                <button
                  onClick={flipCamera}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-slate-200 hover:bg-slate-700 transition"
                  title="Switch camera"
                >
                  <SwitchCamera className="h-5 w-5" />
                </button>
              </>
            )}

            {/* Audio Speaker Mute */}
            <button
              onClick={() => setIsSpeakerOff(!isSpeakerOff)}
              className={`flex h-12 w-12 items-center justify-center rounded-2xl transition ${
                isSpeakerOff
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              title={isSpeakerOff ? 'Unmute speaker' : 'Mute speaker'}
            >
              {isSpeakerOff ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>

            {/* End Call */}
            <button
              onClick={handleHangUp}
              className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-2xl bg-rose-600 text-white shadow-lg transition hover:bg-rose-500 hover:scale-105 active:scale-95"
              title="End Call"
            >
              <PhoneOff className="h-6 w-6" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
