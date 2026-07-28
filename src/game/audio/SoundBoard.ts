import * as THREE from 'three';
import type { EventBus } from '@core/events/EventBus';
import type { AudioManager } from '@engine/audio/AudioManager';
import type { IAssetManager } from '@engine/assets/types';
import type { SurfaceType } from '@core/events/EventMap';

const STEM_IDS = ['base', 'bass', 'guitar', 'arp', 'strings', 'choir'] as const;

/**
 * Turns gameplay events into sound.
 *
 * Everything here is a subscription — no system calls the audio engine
 * directly, so a designer changing which sound plays on a hand-off never has to
 * touch `DeliverySystem`. Missing assets are tolerated silently: the game runs
 * fine with no audio bundle loaded at all, which is what makes the whole
 * pipeline optional at boot.
 */
export class SoundBoard {
  private lastFootstep = 0;

  constructor(
    private readonly bus: EventBus,
    private readonly audio: AudioManager,
    private readonly assets: IAssetManager,
  ) {
    this.subscribe();
  }

  /**
   * Register the stems and start them together.
   *
   * The base pad is the only stem audible at the start; the other five fade in
   * as their districts light. They must all be *started* here, though — a stem
   * that begins late is permanently out of phase with the rest.
   */
  startMusic(litDistricts: readonly string[] = []): void {
    if (this.audio.music.isPlaying) return;

    let registered = 0;
    for (const stem of STEM_IDS) {
      const buffer = this.assets.tryGet<AudioBuffer>(`mus_stem_${stem}`);
      if (!buffer) continue;
      // The pad is always on; everything else waits for its district.
      this.audio.music.addStem(stem, buffer, stem === 'base');
      registered++;
    }

    if (registered === 0) return;
    this.audio.music.start();
    if (litDistricts.length > 0) this.audio.music.restore(['base', ...litDistricts]);
  }

  private play(id: string, options: Parameters<AudioManager['play']>[1] = {}): void {
    const buffer = this.assets.tryGet<AudioBuffer>(id);
    if (buffer) this.audio.play(buffer, options);
  }

  private playAt(
    id: string,
    position: { x: number; y: number; z: number },
    options: Parameters<AudioManager['playAt']>[2] = {},
  ): void {
    const buffer = this.assets.tryGet<AudioBuffer>(id);
    if (buffer) this.audio.playAt(buffer, position, options);
  }

  private subscribe(): void {
    this.bus.on('player:footstep', ({ surface, position }) => {
      // The controller emits by distance travelled, but a stutter at a slope
      // boundary can still double-fire; a short guard keeps cadence clean.
      const now = performance.now();
      if (now - this.lastFootstep < 120) return;
      this.lastFootstep = now;

      this.playAt(`sfx_footstep_${footstepFor(surface)}`, position, {
        volume: 0.45,
        pitchVariation: 2,
        priority: 0,
      });
    });

    this.bus.on('player:jumped', () => {
      this.play('sfx_jump', { volume: 0.5, pitchVariation: 1.5, priority: 1 });
    });

    this.bus.on('player:landed', ({ impactSpeed }) => {
      const hard = impactSpeed > 9;
      this.play(hard ? 'sfx_land_hard' : 'sfx_land_soft', {
        volume: hard ? 0.6 : 0.4,
        pitchVariation: 1,
        priority: 1,
      });
    });

    this.bus.on('parcel:picked', () => {
      this.play('sfx_parcel_pickup', { volume: 0.55, priority: 2 });
    });

    this.bus.on('delivery:completed', () => {
      this.play('sfx_parcel_handoff', { volume: 0.65, priority: 3 });
    });

    // The payoff. High priority so it can never be stolen by footsteps.
    this.bus.on('district:igniting', () => {
      this.play('sfx_district_ignite', { volume: 0.8, priority: 5 });
    });

    this.bus.on('shard:collected', ({ total }) => {
      // Rising pitch with each shard, so a streak reads as a streak.
      const buffer = this.assets.tryGet<AudioBuffer>('sfx_shard_collect');
      if (!buffer) return;
      this.audio.play(buffer, {
        volume: 0.4,
        priority: 2,
        pitchVariation: 0,
      });
      void total;
    });

    this.bus.on('dialogue:line', () => {
      this.play('sfx_ui_hover', { bus: 'voice', volume: 0.22, pitchVariation: 3, priority: 0 });
    });

    this.bus.on('ui:requestPause', () => this.play('sfx_ui_click', { bus: 'ui', volume: 0.4 }));
    this.bus.on('ui:requestResume', () => this.play('sfx_ui_back', { bus: 'ui', volume: 0.4 }));
  }

  /** Keep the listener on the camera so positional audio tracks the view. */
  updateListener(camera: THREE.Camera): void {
    const position = camera.getWorldPosition(_pos);
    const forward = camera.getWorldDirection(_fwd);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    this.audio.setListener(
      { x: position.x, y: position.y, z: position.z },
      { x: forward.x, y: forward.y, z: forward.z },
      { x: _up.x, y: _up.y, z: _up.z },
    );
  }
}

/** Terrain surfaces map onto the footstep set; water falls back to sand. */
function footstepFor(surface: SurfaceType): string {
  switch (surface) {
    case 'grass':
    case 'stone':
    case 'wood':
    case 'metal':
      return surface;
    case 'sand':
    case 'water':
    default:
      return 'sand';
  }
}

const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
