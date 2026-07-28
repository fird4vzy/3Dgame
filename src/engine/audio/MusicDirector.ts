interface Stem {
  id: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  enabled: boolean;
}

/**
 * Stem-layered music.
 *
 * The whole illumination hook depends on this: as each district lights, one
 * more instrument joins the score, so the music builds with the world (GDD
 * §2.3A). That only works if every stem is **started at the same moment and
 * never restarted** — they stay sample-locked forever and we merely fade gains.
 * Starting a stem late, or stopping and restarting it, would drift it out of
 * phase with the others and the trick collapses.
 *
 * This is why the audio engine is hand-written rather than delegated to a
 * general-purpose library: `enableStem` must be a gain ramp, not a play call.
 */
export class MusicDirector {
  private readonly stems = new Map<string, Stem>();
  private playing = false;

  constructor(
    private readonly context: AudioContext,
    private readonly destination: GainNode,
  ) {}

  /**
   * Register every stem before calling {@link start}. Buffers must all be the
   * same length, or they will drift apart on loop.
   */
  addStem(id: string, buffer: AudioBuffer, startEnabled = false): void {
    if (this.playing) {
      console.warn(`[Music] stem "${id}" added after start; it will be out of phase.`);
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = this.context.createGain();
    gain.gain.value = startEnabled ? 1 : 0;

    source.connect(gain);
    gain.connect(this.destination);

    this.stems.set(id, { id, source, gain, enabled: startEnabled });
  }

  /** Start every registered stem at one scheduled time, sample-accurate. */
  start(): void {
    if (this.playing || this.stems.size === 0) return;
    this.playing = true;

    // A small lead time so every start() call lands in the same audio quantum.
    const when = this.context.currentTime + 0.05;
    for (const stem of this.stems.values()) stem.source.start(when);
  }

  /** Fade a stem in. This is the sound of a district waking up. */
  enableStem(id: string, fadeMs = 2500): void {
    const stem = this.stems.get(id);
    if (!stem || stem.enabled) return;
    stem.enabled = true;
    this.rampTo(stem.gain, 1, fadeMs);
  }

  disableStem(id: string, fadeMs = 800): void {
    const stem = this.stems.get(id);
    if (!stem || !stem.enabled) return;
    stem.enabled = false;
    this.rampTo(stem.gain, 0, fadeMs);
  }

  /** Restore several stems instantly — used when loading a save. */
  restore(enabledIds: readonly string[]): void {
    for (const stem of this.stems.values()) {
      const enabled = enabledIds.includes(stem.id);
      stem.enabled = enabled;
      stem.gain.gain.cancelScheduledValues(this.context.currentTime);
      stem.gain.gain.value = enabled ? 1 : 0;
    }
  }

  get enabledStems(): string[] {
    return [...this.stems.values()].filter((s) => s.enabled).map((s) => s.id);
  }

  get stemCount(): number {
    return this.stems.size;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  stop(): void {
    for (const stem of this.stems.values()) {
      try {
        stem.source.stop();
      } catch {
        // Never started.
      }
      stem.gain.disconnect();
    }
    this.stems.clear();
    this.playing = false;
  }

  dispose(): void {
    this.stop();
  }

  private rampTo(gain: GainNode, target: number, fadeMs: number): void {
    const now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    // Linear ramps on gain sound like a fade; exponential ones cannot reach 0.
    gain.gain.linearRampToValueAtTime(target, now + fadeMs / 1000);
  }
}
