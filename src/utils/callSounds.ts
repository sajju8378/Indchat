// Web Audio API sound generator for Call Ringtones & Tones
// Completely offline, no external audio files required

class CallAudioEffects {
  private ctx: AudioContext | null = null;
  private ringOsc1: OscillatorNode | null = null;
  private ringOsc2: OscillatorNode | null = null;
  private ringGain: GainNode | null = null;
  private ringInterval: number | null = null;
  private isRingingActive = false;

  private initContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Play outgoing call ringing tone (US/International standard 440Hz + 480Hz pulses)
   */
  startOutgoingRingtone(): void {
    if (this.isRingingActive) return;
    this.isRingingActive = true;

    try {
      const ctx = this.initContext();

      const playTonePulse = () => {
        if (!this.isRingingActive || ctx.state === 'closed') return;

        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.frequency.setValueAtTime(440, now); // A4
        osc2.frequency.setValueAtTime(480, now); // B4

        // Smooth fade-in & fade-out for 1.8 seconds, then 2.2 seconds silence
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.08);
        gain.gain.setValueAtTime(0.08, now + 1.8);
        gain.gain.linearRampToValueAtTime(0, now + 2.0);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 2.0);
        osc2.stop(now + 2.0);
      };

      playTonePulse();
      this.ringInterval = window.setInterval(playTonePulse, 4000);
    } catch {
      // Audio context might be restricted before user interaction
    }
  }

  /**
   * Play incoming call ringtone (melodic chime)
   */
  startIncomingRingtone(): void {
    if (this.isRingingActive) return;
    this.isRingingActive = true;

    try {
      const ctx = this.initContext();
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

      const playMelody = () => {
        if (!this.isRingingActive || ctx.state === 'closed') return;

        const now = ctx.currentTime;
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteStart = now + idx * 0.18;

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, noteStart);

          gain.gain.setValueAtTime(0, noteStart);
          gain.gain.linearRampToValueAtTime(0.12, noteStart + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.35);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(noteStart);
          osc.stop(noteStart + 0.36);
        });
      };

      playMelody();
      this.ringInterval = window.setInterval(playMelody, 2000);
    } catch {
      // ignore
    }
  }

  stopRingtone(): void {
    this.isRingingActive = false;
    if (this.ringInterval !== null) {
      window.clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
    if (this.ringGain) {
      try {
        this.ringGain.disconnect();
      } catch {}
      this.ringGain = null;
    }
    if (this.ringOsc1) {
      try { this.ringOsc1.stop(); } catch {}
      this.ringOsc1 = null;
    }
    if (this.ringOsc2) {
      try { this.ringOsc2.stop(); } catch {}
      this.ringOsc2 = null;
    }
  }

  /**
   * Short chirp when call connects
   */
  playCallConnectedTone(): void {
    this.stopRingtone();
    try {
      const ctx = this.initContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.25);
    } catch {}
  }

  /**
   * Descending tone when call ends
   */
  playCallEndedTone(): void {
    this.stopRingtone();
    try {
      const ctx = this.initContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.25);

      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.3);
    } catch {}
  }
}

export const callAudio = new CallAudioEffects();
