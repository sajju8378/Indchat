import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  AlertCircle,
} from 'lucide-react';
import { User, CallType, CallStatus } from '../types';
import { callAudio } from '../utils/callSounds';
import { webrtcManager } from '../lib/webrtcClient';

interface CallModalProps {
  isOpen: boolean;
  peer: User;
  callType: CallType;
  isIncoming?: boolean;
  callId?: string;
  offer?: RTCSessionDescriptionInit;
  onEndCall: () => void;
}

export const CallModal: React.FC<CallModalProps> = ({
  isOpen,
  peer,
  callType,
  isIncoming = false,
  callId: initialCallId,
  offer: initialOffer,
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
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [activeCallId, setActiveCallId] = useState<string | null>(initialCallId || null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Setup Audio Visualizer for local mic
  const setupAudioVisualizer = useCallback((stream: MediaStream) => {
    try {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const actx = new AudioCtx();
      audioContextRef.current = actx;
      const source = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const updateMeter = () => {
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        const avg = sum / buffer.length;
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateMeter);
      };
      updateMeter();
    } catch {
      // Audio meter optional
    }
  }, []);

  // WebRTC Lifecycle & Event Listeners
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    // Attach WebRTC event listeners
    webrtcManager.setEventListeners({
      onRemoteStream: (stream: MediaStream) => {
        if (!isMounted) return;

        // Attach remote audio element for crystal clear sound
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().catch((e) => {
            console.warn('[WebRTC] remoteAudio play warning:', e);
          });
        }

        // Attach remote video element
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.play().catch((e) => {
            console.warn('[WebRTC] remoteVideo play warning:', e);
          });
        }

        const hasVideoTracks = stream.getVideoTracks().length > 0;
        setHasRemoteVideo(hasVideoTracks);
      },
      onCallConnected: () => {
        if (!isMounted) return;
        callAudio.stopRingtone();
        callAudio.playCallConnectedTone();
        setStatus('connected');
      },
      onCallEnded: (_id, reason) => {
        if (!isMounted) return;
        callAudio.stopRingtone();
        callAudio.playCallEndedTone();
        setStatus('ended');
        if (reason) {
          setErrorMessage(reason);
        }
        setTimeout(() => {
          if (isMounted) {
            onEndCall();
          }
        }, 1500);
      },
      onError: (errStr) => {
        if (!isMounted) return;
        setErrorMessage(errStr);
      },
    });

    if (isIncoming) {
      // Incoming call: start ringing melodic ringtone
      callAudio.startIncomingRingtone();
      if (initialCallId) {
        setActiveCallId(initialCallId);
      }
    } else {
      // Outgoing call: start ringing & start peer connection offer
      callAudio.startOutgoingRingtone();
      (async () => {
        try {
          const { callId, localStream } = await webrtcManager.startOutgoingCall(
            peer,
            callType,
            facingMode
          );
          if (!isMounted) return;

          setActiveCallId(callId);
          localStreamRef.current = localStream;

          if (localVideoRef.current && callType === 'video') {
            localVideoRef.current.srcObject = localStream;
            localVideoRef.current.play().catch(() => {});
          }

          setupAudioVisualizer(localStream);
        } catch (err: any) {
          if (!isMounted) return;
          callAudio.stopRingtone();
          setErrorMessage(err.message || 'Could not access microphone or camera.');
          setStatus('ended');
          setTimeout(() => {
            if (isMounted) onEndCall();
          }, 3000);
        }
      })();
    }

    return () => {
      isMounted = false;
      callAudio.stopRingtone();
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [isOpen, isIncoming, peer, callType, facingMode, initialCallId, onEndCall, setupAudioVisualizer]);

  // Duration Timer for connected call
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

  // Accept incoming call
  const handleAcceptIncoming = async () => {
    callAudio.stopRingtone();
    try {
      if (!activeCallId || !initialOffer) {
        throw new Error('Missing call offer data to connect.');
      }
      const { localStream } = await webrtcManager.acceptIncomingCall(
        activeCallId,
        peer,
        callType,
        initialOffer,
        facingMode
      );
      localStreamRef.current = localStream;

      if (localVideoRef.current && callType === 'video') {
        localVideoRef.current.srcObject = localStream;
        localVideoRef.current.play().catch(() => {});
      }

      setupAudioVisualizer(localStream);
      callAudio.playCallConnectedTone();
      setStatus('connected');
    } catch (err: any) {
      callAudio.playCallEndedTone();
      setErrorMessage(err.message || 'Failed to accept call.');
      setTimeout(() => {
        onEndCall();
      }, 2500);
    }
  };

  // Decline incoming call
  const handleDeclineIncoming = () => {
    callAudio.stopRingtone();
    callAudio.playCallEndedTone();
    if (activeCallId) {
      webrtcManager.rejectCall(activeCallId, peer.id, 'Call declined');
    }
    onEndCall();
  };

  // End active call
  const handleHangUp = () => {
    callAudio.stopRingtone();
    callAudio.playCallEndedTone();
    if (activeCallId) {
      webrtcManager.endCall(activeCallId, peer.id);
    } else {
      webrtcManager.cleanupMedia();
    }
    onEndCall();
  };

  // Toggle microphone
  const handleToggleMute = () => {
    const muted = webrtcManager.toggleMute();
    setIsMuted(muted);
  };

  // Toggle camera
  const handleToggleVideo = () => {
    const videoOff = webrtcManager.toggleVideo();
    setIsVideoOff(videoOff);
  };

  // Switch camera (front / back)
  const handleSwitchCamera = async () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    const updatedStream = await webrtcManager.switchCamera(nextMode);
    if (updatedStream && localVideoRef.current) {
      localVideoRef.current.srcObject = updatedStream;
      localVideoRef.current.play().catch(() => {});
    }
  };

  // Toggle speaker mute
  const handleToggleSpeaker = () => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !isSpeakerOff;
      setIsSpeakerOff(!isSpeakerOff);
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Minimized floating window
  if (isMinimized) {
    return (
      <div
        id="call-minimized-bubble"
        className="fixed bottom-20 right-4 z-50 flex items-center gap-2 rounded-2xl bg-slate-900 border border-slate-700 p-2 shadow-2xl text-white backdrop-blur-md"
      >
        <audio ref={remoteAudioRef} autoPlay playsInline />
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
    <div
      id="call-modal-overlay"
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-slate-950/95 text-white p-4 select-none backdrop-blur-md"
    >
      {/* Remote Audio Track Element (Real WebRTC audio output) */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Top Header Bar */}
      <div className="flex w-full max-w-xl items-center justify-between pt-2">
        <div className="flex items-center gap-2 rounded-full bg-slate-900/90 px-3 py-1 text-xs border border-slate-800 backdrop-blur-sm shadow-xs">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-[11px] font-medium text-slate-300">
            End-to-End Encrypted WebRTC ({callType === 'video' ? 'HD Video Call' : 'HQ Audio Call'})
          </span>
        </div>

        {status === 'connected' && (
          <button
            onClick={() => setIsMinimized(true)}
            className="rounded-full bg-slate-800/80 p-2 text-slate-300 hover:bg-slate-700 transition"
            title="Minimize to floating window"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Error / Notice Banner */}
      {errorMessage && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-950/80 border border-amber-800/80 px-4 py-2 text-xs text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Call View Area */}
      <div className="relative flex w-full max-w-xl flex-1 flex-col items-center justify-center my-4 overflow-hidden rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl">
        {/* Video Call View */}
        {callType === 'video' && status === 'connected' ? (
          <div className="relative h-full w-full bg-black flex items-center justify-center overflow-hidden">
            {/* Real Remote Video Stream */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`h-full w-full object-cover ${!hasRemoteVideo ? 'hidden' : 'block'}`}
            />

            {/* Fallback avatar if remote peer disabled camera */}
            {!hasRemoteVideo && (
              <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/40 via-slate-950 to-slate-900 flex flex-col items-center justify-center">
                <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-indigo-600 text-3xl font-bold shadow-2xl">
                  {peer.displayName.charAt(0).toUpperCase()}
                  <span
                    className="absolute inset-0 rounded-full border-2 border-indigo-400 animate-ping opacity-30"
                    style={{ animationDuration: '2.5s' }}
                  />
                </div>
                <h3 className="mt-4 text-lg font-bold">{peer.displayName}</h3>
                <span className="text-xs text-emerald-400 font-medium">Remote Camera Muted</span>
              </div>
            )}

            {/* Local Picture-in-Picture Video Stream */}
            <div className="absolute bottom-4 right-4 h-36 w-24 sm:h-44 sm:w-32 overflow-hidden rounded-2xl border-2 border-indigo-500 bg-slate-950 shadow-2xl z-20">
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
              <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1 py-0.5 text-[9px] text-white font-medium">
                You
              </div>
            </div>
          </div>
        ) : (
          /* Audio Call View */
          <div className="flex flex-col items-center justify-center p-6 text-center">
            {/* Avatar with Dynamic Sound Equalizer */}
            <div className="relative flex items-center justify-center">
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
                <div className="flex items-center gap-1.5 text-xs text-indigo-400 animate-pulse font-medium">
                  <span className="h-2 w-2 rounded-full bg-indigo-400" />
                  <span>Calling @{peer.username}...</span>
                </div>
              )}
              {status === 'incoming' && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 animate-pulse font-semibold">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span>Incoming {callType === 'video' ? 'Video' : 'Audio'} Call...</span>
                </div>
              )}
              {status === 'connected' && (
                <div className="rounded-full bg-slate-800/90 px-3.5 py-1 text-xs text-emerald-400 font-mono font-semibold border border-slate-700">
                  {formatDuration(callDuration)}
                </div>
              )}
              {status === 'ended' && (
                <div className="rounded-full bg-rose-900/60 px-3 py-1 text-xs text-rose-300 font-medium border border-rose-800">
                  Call Ended
                </div>
              )}
            </div>

            {/* Live Audio Activity Bars */}
            {status === 'connected' && (
              <div className="mt-6 flex items-center gap-1 h-6">
                {[20, 45, 75, 90, 60, 30, 80, 50, 25].map((h, i) => (
                  <span
                    key={i}
                    className="w-1 rounded-full bg-indigo-500 transition-all duration-150"
                    style={{
                      height: `${Math.max(4, Math.min(24, (h * (audioLevel + 10)) / 100))}px`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Call Controls Area */}
      <div className="flex w-full max-w-xl flex-col items-center gap-4 pb-4">
        {status === 'incoming' ? (
          /* Incoming Call Action Buttons (Accept vs Decline) */
          <div className="flex w-full items-center justify-around px-8">
            <button
              id="call-decline-btn"
              onClick={handleDeclineIncoming}
              className="group flex flex-col items-center gap-2"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg transition transform group-hover:scale-110 active:scale-95">
                <PhoneOff className="h-7 w-7" />
              </div>
              <span className="text-xs font-semibold text-rose-400">Decline</span>
            </button>

            <button
              id="call-accept-btn"
              onClick={handleAcceptIncoming}
              className="group flex flex-col items-center gap-2"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg transition transform group-hover:scale-110 active:scale-95 animate-bounce">
                <Phone className="h-7 w-7" />
              </div>
              <span className="text-xs font-semibold text-emerald-400">Accept</span>
            </button>
          </div>
        ) : (
          /* Active / Calling Controls */
          <div className="flex items-center justify-center gap-3 sm:gap-4 rounded-3xl bg-slate-900/90 border border-slate-800 p-3 backdrop-blur-md shadow-2xl">
            {/* Microphone Toggle */}
            <button
              id="call-toggle-mute-btn"
              onClick={handleToggleMute}
              className={`rounded-2xl p-3.5 transition active:scale-95 ${
                isMuted
                  ? 'bg-rose-600/20 text-rose-400 border border-rose-600/40'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
            >
              {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>

            {/* Video Call Controls */}
            {callType === 'video' && (
              <>
                <button
                  id="call-toggle-video-btn"
                  onClick={handleToggleVideo}
                  className={`rounded-2xl p-3.5 transition active:scale-95 ${
                    isVideoOff
                      ? 'bg-rose-600/20 text-rose-400 border border-rose-600/40'
                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                  title={isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
                >
                  {isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                </button>

                <button
                  id="call-flip-camera-btn"
                  onClick={handleSwitchCamera}
                  className="rounded-2xl bg-slate-800 p-3.5 text-slate-200 transition hover:bg-slate-700 active:scale-95"
                  title="Switch Camera (Front / Back)"
                >
                  <SwitchCamera className="h-5 w-5" />
                </button>
              </>
            )}

            {/* Speaker Toggle */}
            <button
              id="call-toggle-speaker-btn"
              onClick={handleToggleSpeaker}
              className={`rounded-2xl p-3.5 transition active:scale-95 ${
                isSpeakerOff
                  ? 'bg-amber-600/20 text-amber-400 border border-amber-600/40'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              title={isSpeakerOff ? 'Unmute Speaker' : 'Mute Speaker'}
            >
              {isSpeakerOff ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>

            {/* End Call Button */}
            <button
              id="call-hangup-btn"
              onClick={handleHangUp}
              className="flex items-center gap-2 rounded-2xl bg-rose-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:bg-rose-500 active:scale-95"
              title="End Call"
            >
              <PhoneOff className="h-5 w-5" />
              <span className="hidden sm:inline">End Call</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
