interface Bed {
  id: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

const CROSSFADE_SECONDS = 2.5;

/**
 * Per-district ambience beds.
 *
 * Structurally the same trick as the music stems: every bed starts at once and
 * loops forever, and moving between districts is a **gain crossfade, never a
 * start**. Starting a loop on entry would fire an audible attack transient
 * every time the player crosses a boundary — and on a planet you can circle in
 * ninety seconds, boundaries get crossed constantly.
 *
 * Beds run on the `ambience` bus so a player can turn the music down and keep
 * the world alive.
 */
export class AmbienceDirector {
  private readonly beds = new Map<string, Bed>();
  private active: string | null = null;
  private started = false;

  constructor(
    private readonly context: AudioContext,
    private readonly destination: GainNode,
  ) {}

  addBed(id: string, buffer: AudioBuffer): void {
    if (this.started) {
      console.warn(`[Ambience] bed "${id}" added after start; it will not play.`);
      return;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = this.context.createGain();
    gain.gain.value = 0;

    source.connect(gain);
    gain.connect(this.destination);

    this.beds.set(id, { id, source, gain });
  }

  /** Start every bed silently. Call once, after all beds are registered. */
  start(): void {
    if (this.started || this.beds.size === 0) return;
    this.started = true;

    const when = this.context.currentTime + 0.05;
    for (const bed of this.beds.values()) bed.source.start(when);
  }

  /** Crossfade to a district's bed. Safe to call every frame. */
  setDistrict(id: string, fadeSeconds = CROSSFADE_SECONDS): void {
    if (!this.started || this.active === id) return;
    this.active = id;

    const now = this.context.currentTime;
    for (const bed of this.beds.values()) {
      const target = bed.id === id ? 1 : 0;
      bed.gain.gain.cancelScheduledValues(now);
      bed.gain.gain.setValueAtTime(bed.gain.gain.value, now);
      bed.gain.gain.linearRampToValueAtTime(target, now + fadeSeconds);
    }
  }

  /** Fade everything out — the menu sits in orbit, not in a district. */
  silence(fadeSeconds = 1): void {
    if (!this.started) return;
    this.active = null;

    const now = this.context.currentTime;
    for (const bed of this.beds.values()) {
      bed.gain.gain.cancelScheduledValues(now);
      bed.gain.gain.setValueAtTime(bed.gain.gain.value, now);
      bed.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
    }
  }

  get currentDistrict(): string | null {
    return this.active;
  }

  get bedCount(): number {
    return this.beds.size;
  }

  get isPlaying(): boolean {
    return this.started;
  }

  dispose(): void {
    for (const bed of this.beds.values()) {
      try {
        bed.source.stop();
      } catch {
        // Never started.
      }
      bed.gain.disconnect();
    }
    this.beds.clear();
    this.started = false;
  }
}
