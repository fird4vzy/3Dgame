import { MusicDirector } from './MusicDirector';

export type AudioBus = 'music' | 'sfx' | 'ambience' | 'ui' | 'voice';

export interface PlayOptions {
  bus?: AudioBus;
  volume?: number;
  /** Random pitch variation in semitones, so repeated sounds do not machine-gun. */
  pitchVariation?: number;
  loop?: boolean;
  priority?: number;
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  priority: number;
  startedAt: number;
}

const MAX_VOICES = 24;

/**
 * Web Audio graph:  source → (panner) → busGain → masterGain → destination
 *
 * Written by hand rather than pulled from a library because the stem-layered
 * music in {@link MusicDirector} needs sample-accurate control that a
 * general-purpose wrapper does not expose — and because it is ~250 lines.
 */
export class AudioManager {
  readonly context: AudioContext;
  readonly music: MusicDirector;

  private readonly masterGain: GainNode;
  private readonly busGains: Record<AudioBus, GainNode>;
  private readonly voices: Voice[] = [];
  private unlocked = false;

  constructor() {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new Ctor();

    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);

    this.busGains = {
      music: this.context.createGain(),
      sfx: this.context.createGain(),
      ambience: this.context.createGain(),
      ui: this.context.createGain(),
      voice: this.context.createGain(),
    };
    for (const gain of Object.values(this.busGains)) gain.connect(this.masterGain);

    this.music = new MusicDirector(this.context, this.busGains.music);
    this.installUnlockHandler();
  }

  /**
   * Browsers start the context suspended until a user gesture. We resume on the
   * first interaction of any kind and then remove the listeners.
   */
  private installUnlockHandler(): void {
    const unlock = () => {
      if (this.unlocked) return;
      void this.context.resume().then(() => {
        this.unlocked = true;
      });
      for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
        window.removeEventListener(type, unlock);
      }
    };
    for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(type, unlock, { once: false });
    }
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  setBusVolume(bus: AudioBus, volume: number): void {
    this.busGains[bus].gain.setTargetAtTime(clamp01(volume), this.context.currentTime, 0.02);
  }

  setMasterVolume(volume: number): void {
    this.masterGain.gain.setTargetAtTime(clamp01(volume), this.context.currentTime, 0.02);
  }

  /** Duck everything smoothly — used on pause and on tab blur. */
  duck(target: number, seconds = 0.25): void {
    this.masterGain.gain.setTargetAtTime(clamp01(target), this.context.currentTime, seconds / 3);
  }

  play(buffer: AudioBuffer, options: PlayOptions = {}): void {
    if (this.context.state === 'suspended') return;

    const priority = options.priority ?? 1;
    if (!this.reserveVoice(priority)) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop ?? false;

    if (options.pitchVariation) {
      const semitones = (Math.random() * 2 - 1) * options.pitchVariation;
      source.playbackRate.value = Math.pow(2, semitones / 12);
    }

    const gain = this.context.createGain();
    gain.gain.value = clamp01(options.volume ?? 1);

    source.connect(gain);
    gain.connect(this.busGains[options.bus ?? 'sfx']);

    const voice: Voice = { source, gain, priority, startedAt: this.context.currentTime };
    this.voices.push(voice);
    source.onended = () => {
      const index = this.voices.indexOf(voice);
      if (index >= 0) this.voices.splice(index, 1);
      gain.disconnect();
    };
    source.start();
  }

  /** Positional one-shot. HRTF is off on touch devices — it is measurably costly. */
  playAt(
    buffer: AudioBuffer,
    position: { x: number; y: number; z: number },
    options: PlayOptions = {},
  ): void {
    if (this.context.state === 'suspended') return;
    if (!this.reserveVoice(options.priority ?? 1)) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop ?? false;
    if (options.pitchVariation) {
      const semitones = (Math.random() * 2 - 1) * options.pitchVariation;
      source.playbackRate.value = Math.pow(2, semitones / 12);
    }

    const panner = this.context.createPanner();
    panner.panningModel = matchMedia?.('(pointer: coarse)').matches ? 'equalpower' : 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.maxDistance = 60;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;

    const gain = this.context.createGain();
    gain.gain.value = clamp01(options.volume ?? 1);

    source.connect(panner);
    panner.connect(gain);
    gain.connect(this.busGains[options.bus ?? 'sfx']);

    const voice: Voice = {
      source,
      gain,
      priority: options.priority ?? 1,
      startedAt: this.context.currentTime,
    };
    this.voices.push(voice);
    source.onended = () => {
      const index = this.voices.indexOf(voice);
      if (index >= 0) this.voices.splice(index, 1);
      panner.disconnect();
      gain.disconnect();
    };
    source.start();
  }

  /** Move the listener with the camera so positional audio tracks the view. */
  setListener(
    position: { x: number; y: number; z: number },
    forward: { x: number; y: number; z: number },
    up: { x: number; y: number; z: number },
  ): void {
    const listener = this.context.listener;
    if (listener.positionX) {
      listener.positionX.value = position.x;
      listener.positionY.value = position.y;
      listener.positionZ.value = position.z;
      listener.forwardX.value = forward.x;
      listener.forwardY.value = forward.y;
      listener.forwardZ.value = forward.z;
      listener.upX.value = up.x;
      listener.upY.value = up.y;
      listener.upZ.value = up.z;
    }
  }

  dispose(): void {
    for (const voice of [...this.voices]) {
      try {
        voice.source.stop();
      } catch {
        // Already stopped — nothing to do.
      }
    }
    this.voices.length = 0;
    this.music.dispose();
    void this.context.close();
  }

  /**
   * Voice cap with priority stealing: at the limit, drop the oldest voice of
   * the lowest priority rather than refusing the new sound outright, so an
   * important cue is never lost to a crowd of footsteps.
   */
  private reserveVoice(priority: number): boolean {
    if (this.voices.length < MAX_VOICES) return true;

    let victimIndex = -1;
    let victimPriority = priority;
    let victimAge = Infinity;
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i];
      if (!voice) continue;
      if (voice.priority < victimPriority || (voice.priority === victimPriority && voice.startedAt < victimAge)) {
        victimIndex = i;
        victimPriority = voice.priority;
        victimAge = voice.startedAt;
      }
    }
    if (victimIndex < 0) return false;

    try {
      this.voices[victimIndex]?.source.stop();
    } catch {
      // Already ended.
    }
    return true;
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
