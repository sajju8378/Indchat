import { User, CallType } from '../types';
import { getStoredServerConfig } from './api';
import { getTursoClient, tursoSendCallSignal, tursoGetIncomingCallSignals, tursoClearCallSignals } from './tursoClient';

export interface WebRTCClientEvents {
  onIncomingCall: (callId: string, fromUser: User, callType: CallType, offer: RTCSessionDescriptionInit) => void;
  onCallAnswered: (callId: string, answer: RTCSessionDescriptionInit) => void;
  onCallConnected: (callId: string) => void;
  onCallEnded: (callId: string, reason?: string) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onError: (error: string) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
  ],
};

export class WebRTCManager {
  private ws: WebSocket | null = null;
  private currentUser: User | null = null;
  private listeners: Partial<WebRTCClientEvents> = {};
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private currentCallId: string | null = null;
  private currentPeer: User | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private isCaller = false;
  private isReconnecting = false;
  private tursoPollTimer: number | null = null;
  private lastTursoSignalTime = Date.now();
  private processedSignalIds = new Set<string>();

  constructor() {
    this.setupNetworkListeners();
  }

  private setupNetworkListeners() {
    window.addEventListener('online', () => {
      if (this.currentUser) {
        this.connectSignaling(this.currentUser);
      }
    });
  }

  public setEventListeners(events: Partial<WebRTCClientEvents>) {
    this.listeners = events;
  }

  public connectSignaling(user: User) {
    this.currentUser = user;

    // Connect WebSocket
    this.initWebSocket();

    // Also start Turso signaling fallback if Turso config is active
    this.startTursoSignalingFallback();
  }

  private getWebSocketUrl(): string {
    const config = getStoredServerConfig();
    let url = '';
    if (config.serverUrl && config.serverUrl.trim().length > 0) {
      const clean = config.serverUrl.trim();
      const wsProto = clean.startsWith('https:') ? 'wss:' : 'ws:';
      const host = clean.replace(/^https?:\/\//, '').replace(/\/$/, '');
      url = `${wsProto}//${host}/ws`;
    } else {
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url = `${wsProto}//${window.location.host}/ws`;
    }
    return url;
  }

  private initWebSocket() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const wsUrl = this.getWebSocketUrl();
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        if (this.currentUser && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: 'auth',
              userId: this.currentUser.id,
              username: this.currentUser.username,
              displayName: this.currentUser.displayName,
            })
          );
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleSignalingMessage(msg);
        } catch (e) {
          console.warn('[WebRTC] Invalid WS message:', e);
        }
      };

      this.ws.onclose = () => {
        if (!this.isReconnecting) {
          this.isReconnecting = true;
          window.setTimeout(() => {
            this.isReconnecting = false;
            if (this.currentUser) {
              this.initWebSocket();
            }
          }, 3000);
        }
      };

      this.ws.onerror = () => {
        // Will trigger onclose and retry
      };
    } catch (e) {
      console.warn('[WebRTC] WebSocket connection error:', e);
    }
  }

  private startTursoSignalingFallback() {
    if (this.tursoPollTimer) return;

    const config = getStoredServerConfig();
    if (!config.tursoUrl || !config.tursoAuthToken) return;

    // Background poll every 1.8 seconds for incoming signals via Turso DB
    this.tursoPollTimer = window.setInterval(async () => {
      if (!this.currentUser) return;
      try {
        const client = getTursoClient(config.tursoUrl!, config.tursoAuthToken!);
        const signals = await tursoGetIncomingCallSignals(client, this.currentUser.id, this.lastTursoSignalTime);
        for (const sig of signals) {
          if (this.processedSignalIds.has(sig.id)) continue;
          this.processedSignalIds.add(sig.id);
          this.lastTursoSignalTime = Math.max(this.lastTursoSignalTime, sig.createdAt);

          if (sig.fromUserId === this.currentUser.id) continue;

          switch (sig.signalType) {
            case 'offer':
              this.handleIncomingCall(sig.callId, sig.fromUser, sig.callType, sig.payload);
              break;
            case 'answer':
              this.handleCallAnswered(sig.callId, sig.payload);
              break;
            case 'candidate':
              this.handleIceCandidate(sig.callId, sig.payload);
              break;
            case 'reject':
              this.handleCallRejected(sig.callId, sig.payload?.reason);
              break;
            case 'end':
              this.handleCallEnded(sig.callId);
              break;
          }
        }
      } catch {
        // Turso signaling poll silent
      }
    }, 1800);
  }

  private sendSignal(msg: any) {
    let sentViaWs = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
        sentViaWs = true;
      } catch (e) {
        console.warn('[WebRTC] Send failed via WS:', e);
      }
    }

    // Also send via Turso DB for maximum cross-network reliability
    const config = getStoredServerConfig();
    if (config.tursoUrl && config.tursoAuthToken && this.currentUser) {
      try {
        const client = getTursoClient(config.tursoUrl, config.tursoAuthToken);
        let sigType: 'offer' | 'answer' | 'candidate' | 'reject' | 'end' | null = null;
        let payload: any = null;

        if (msg.type === 'call_offer') {
          sigType = 'offer';
          payload = msg.offer;
        } else if (msg.type === 'call_answer') {
          sigType = 'answer';
          payload = msg.answer;
        } else if (msg.type === 'ice_candidate') {
          sigType = 'candidate';
          payload = msg.candidate;
        } else if (msg.type === 'call_reject') {
          sigType = 'reject';
          payload = { reason: msg.reason };
        } else if (msg.type === 'call_end') {
          sigType = 'end';
          payload = {};
        }

        if (sigType && msg.toUserId) {
          tursoSendCallSignal(
            client,
            msg.callId,
            this.currentUser.id,
            msg.toUserId,
            this.currentUser,
            msg.callType || 'audio',
            sigType,
            payload
          ).catch(() => {});
        }
      } catch {
        // Ignore
      }
    }
  }

  private handleSignalingMessage(msg: any) {
    switch (msg.type) {
      case 'incoming_call':
        this.handleIncomingCall(msg.callId, msg.fromUser, msg.callType, msg.offer);
        break;
      case 'call_answered':
        this.handleCallAnswered(msg.callId, msg.answer);
        break;
      case 'ice_candidate':
        this.handleIceCandidate(msg.callId, msg.candidate);
        break;
      case 'call_rejected':
        this.handleCallRejected(msg.callId, msg.reason);
        break;
      case 'call_ended':
        this.handleCallEnded(msg.callId);
        break;
      case 'user_unavailable':
        this.handleUserUnavailable(msg.callId, msg.reason);
        break;
    }
  }

  private handleIncomingCall(
    callId: string,
    fromUser: User,
    callType: CallType,
    offer: RTCSessionDescriptionInit
  ) {
    // If we're already in an active call, auto-reject with busy
    if (this.currentCallId && this.currentCallId !== callId) {
      this.sendSignal({
        type: 'call_reject',
        callId,
        toUserId: fromUser.id,
        reason: 'User is busy on another call',
      });
      return;
    }

    this.currentCallId = callId;
    this.currentPeer = fromUser;
    this.isCaller = false;
    this.listeners.onIncomingCall?.(callId, fromUser, callType, offer);
  }

  private async handleCallAnswered(callId: string, answer: RTCSessionDescriptionInit) {
    if (this.currentCallId !== callId || !this.pc) return;

    try {
      if (this.pc.signalingState !== 'stable') {
        await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
        // Flush buffered candidates
        while (this.pendingCandidates.length > 0) {
          const cand = this.pendingCandidates.shift();
          if (cand) {
            await this.pc.addIceCandidate(new RTCIceCandidate(cand));
          }
        }
      }
      this.listeners.onCallAnswered?.(callId, answer);
      this.listeners.onCallConnected?.(callId);
    } catch (err: any) {
      console.error('[WebRTC] Failed to set remote description on answer:', err);
      this.listeners.onError?.(`Failed to connect call: ${err.message}`);
    }
  }

  private async handleIceCandidate(callId: string, candidate: RTCIceCandidateInit) {
    if (this.currentCallId !== callId) return;

    if (this.pc && this.pc.remoteDescription && this.pc.remoteDescription.type) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[WebRTC] Error adding ICE candidate:', err);
      }
    } else {
      this.pendingCandidates.push(candidate);
    }
  }

  private handleCallRejected(callId: string, reason?: string) {
    if (this.currentCallId === callId) {
      this.cleanupMedia();
      this.listeners.onCallEnded?.(callId, reason || 'Call declined');
    }
  }

  private handleCallEnded(callId: string) {
    if (this.currentCallId === callId) {
      this.cleanupMedia();
      this.listeners.onCallEnded?.(callId, 'Call ended');
    }
  }

  private handleUserUnavailable(callId: string, reason?: string) {
    if (this.currentCallId === callId) {
      this.cleanupMedia();
      this.listeners.onCallEnded?.(callId, reason || 'User is currently offline.');
    }
  }

  /**
   * Initiate an outgoing Audio or Video Call to a peer
   */
  public async startOutgoingCall(
    peer: User,
    callType: CallType,
    facingMode: 'user' | 'environment' = 'user'
  ): Promise<{ callId: string; localStream: MediaStream }> {
    if (!this.currentUser) {
      throw new Error('You must be logged in to make a call.');
    }

    this.cleanupMedia();

    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.currentCallId = callId;
    this.currentPeer = peer;
    this.isCaller = true;
    this.pendingCandidates = [];

    // 1. Acquire Local Media
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video:
        callType === 'video'
          ? {
              facingMode,
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : false,
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: any) {
      // If video failed, fallback to audio
      if (callType === 'video') {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        throw new Error(`Microphone permission denied: ${err.message}`);
      }
    }

    this.localStream = stream;

    // 2. Create RTCPeerConnection
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;

    // Add local tracks to peer connection
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    // Handle ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'ice_candidate',
          callId,
          toUserId: peer.id,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // Handle incoming remote media tracks
    this.remoteStream = new MediaStream();
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        this.remoteStream?.addTrack(event.track);
      }
      this.listeners.onRemoteStream?.(this.remoteStream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.listeners.onCallConnected?.(callId);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // Will close on disconnect
      }
    };

    // 3. Create Offer
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: callType === 'video',
    });
    await pc.setLocalDescription(offer);

    // 4. Dispatch offer via signaling
    this.sendSignal({
      type: 'call_offer',
      callId,
      toUserId: peer.id,
      fromUser: this.currentUser,
      callType,
      offer,
    });

    return { callId, localStream: stream };
  }

  /**
   * Accept an incoming Audio or Video Call
   */
  public async acceptIncomingCall(
    callId: string,
    fromUser: User,
    callType: CallType,
    offer: RTCSessionDescriptionInit,
    facingMode: 'user' | 'environment' = 'user'
  ): Promise<{ localStream: MediaStream }> {
    if (!this.currentUser) {
      throw new Error('Not logged in');
    }

    this.cleanupMedia();

    this.currentCallId = callId;
    this.currentPeer = fromUser;
    this.isCaller = false;

    // 1. Acquire Local Media
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video:
        callType === 'video'
          ? {
              facingMode,
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : false,
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: any) {
      if (callType === 'video') {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        throw new Error(`Microphone permission denied: ${err.message}`);
      }
    }

    this.localStream = stream;

    // 2. Create RTCPeerConnection
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'ice_candidate',
          callId,
          toUserId: fromUser.id,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    this.remoteStream = new MediaStream();
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        this.remoteStream?.addTrack(event.track);
      }
      this.listeners.onRemoteStream?.(this.remoteStream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.listeners.onCallConnected?.(callId);
      }
    };

    // 3. Set Remote Description
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    // Flush any early candidates
    while (this.pendingCandidates.length > 0) {
      const cand = this.pendingCandidates.shift();
      if (cand) {
        await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      }
    }

    // 4. Create & Set Local Answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // 5. Send Answer
    this.sendSignal({
      type: 'call_answer',
      callId,
      toUserId: fromUser.id,
      answer,
    });

    this.listeners.onCallConnected?.(callId);
    return { localStream: stream };
  }

  /**
   * Reject an incoming Call
   */
  public rejectCall(callId: string, toUserId: string, reason = 'Call declined') {
    this.sendSignal({
      type: 'call_reject',
      callId,
      toUserId,
      reason,
    });
    this.cleanupMedia();
    this.listeners.onCallEnded?.(callId, reason);
  }

  /**
   * Hangup an active or ringing Call
   */
  public endCall(callId: string, toUserId?: string) {
    const targetUserId = toUserId || this.currentPeer?.id;
    if (targetUserId) {
      this.sendSignal({
        type: 'call_end',
        callId,
        toUserId: targetUserId,
      });
    }
    this.cleanupMedia();
    this.listeners.onCallEnded?.(callId, 'Call ended');
  }

  /**
   * Toggle local microphone
   */
  public toggleMute(muted?: boolean): boolean {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (!audioTrack) return false;

    if (typeof muted === 'boolean') {
      audioTrack.enabled = !muted;
    } else {
      audioTrack.enabled = !audioTrack.enabled;
    }
    return !audioTrack.enabled; // true if muted
  }

  /**
   * Toggle local camera
   */
  public toggleVideo(videoOff?: boolean): boolean {
    if (!this.localStream) return true;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return true;

    if (typeof videoOff === 'boolean') {
      videoTrack.enabled = !videoOff;
    } else {
      videoTrack.enabled = !videoTrack.enabled;
    }
    return !videoTrack.enabled; // true if camera is off
  }

  /**
   * Switch mobile camera (front / back)
   */
  public async switchCamera(newFacingMode: 'user' | 'environment'): Promise<MediaStream | null> {
    if (!this.localStream || !this.pc) return null;

    const oldVideoTrack = this.localStream.getVideoTracks()[0];
    if (oldVideoTrack) {
      oldVideoTrack.stop();
      this.localStream.removeTrack(oldVideoTrack);
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (newVideoTrack) {
        this.localStream.addTrack(newVideoTrack);

        // Replace track on RTCPeerConnection sender
        const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(newVideoTrack);
        }
      }
      return this.localStream;
    } catch (err) {
      console.warn('[WebRTC] switchCamera failed:', err);
      return this.localStream;
    }
  }

  public cleanupMedia() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track) => track.stop());
      this.remoteStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.currentCallId = null;
    this.currentPeer = null;
    this.pendingCandidates = [];
  }

  public destroy() {
    this.cleanupMedia();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.tursoPollTimer) {
      clearInterval(this.tursoPollTimer);
      this.tursoPollTimer = null;
    }
    this.currentUser = null;
  }
}

export const webrtcManager = new WebRTCManager();
