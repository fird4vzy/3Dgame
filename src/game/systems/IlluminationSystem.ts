import * as THREE from 'three';
import type { EventBus } from '@core/events/EventBus';
import type { MusicDirector } from '@engine/audio/MusicDirector';
import type { DistrictRegistry, DistrictRuntime } from '../world/DistrictRegistry';
import type { DistrictId } from '../../data/content';

export interface DistrictLamps {
  district: DistrictId;
  lights: THREE.PointLight[];
  bulbs: THREE.Mesh[];
  /** Staggered ignition offsets, so lamps catch in a cascade, not in unison. */
  delays: number[];
}

/** Ignition duration, and the music ramp that runs alongside it. */
const IGNITE_SECONDS = 3.0;
const STEM_FADE_MS = 2500;

const _colour = new THREE.Color();

/**
 * The core hook: delivering to a district wakes it up.
 *
 * One event drives four channels at once — lamps ignite in a cascade, the
 * terrain's district tint saturates from dusk to full colour, a music stem
 * fades in, and dormant life enables. The player *sees* the game filling in,
 * and it costs almost nothing to run: a few uniforms, some visibility flags and
 * a gain node (GDD §2.3A).
 *
 * The whole point of Pillar 1 is that the world **is** the progress bar, so
 * nothing here should ever be replaced by a percentage readout.
 */
export class IlluminationSystem {
  private readonly lampsByDistrict = new Map<DistrictId, DistrictLamps>();
  private readonly dormant = new Map<DistrictId, THREE.Object3D[]>();
  private readonly igniting = new Map<DistrictId, number>();

  /** Ambient light lifts as the planet comes back. */
  private readonly ambient: THREE.HemisphereLight;
  private readonly baseAmbient: number;

  constructor(
    private readonly bus: EventBus,
    private readonly districts: DistrictRegistry,
    private readonly music: MusicDirector | null,
    ambient: THREE.HemisphereLight,
  ) {
    this.ambient = ambient;
    this.baseAmbient = ambient.intensity;
  }

  registerLamps(lamps: DistrictLamps): void {
    this.lampsByDistrict.set(lamps.district, lamps);
  }

  /** Objects that only appear once their district is lit. */
  registerDormant(district: DistrictId, objects: THREE.Object3D[]): void {
    for (const object of objects) object.visible = false;
    this.dormant.set(district, objects);
  }

  /** Begin the ignition sequence. Returns immediately; `update` animates it. */
  ignite(district: DistrictId): void {
    const runtime = this.districts.get(district);
    if (runtime.lit || this.igniting.has(district)) return;

    runtime.lit = true;
    this.igniting.set(district, 0);
    this.bus.emit('district:igniting', { district });

    // The stem ramp starts with the lamps so sound and light land together.
    const stem = runtime.def.stem;
    this.music?.enableStem(stem, STEM_FADE_MS);
    this.bus.emit('music:stemEnabled', { stem });
  }

  /** Restore a loaded save: districts snap to lit with no animation. */
  /**
   * Put every district back to dark, for a fresh run.
   *
   * Symmetrical with {@link restore}: instant, silent, no events. Without it,
   * starting a new run would need a page reload to clear the world — and a
   * reload drops the player back at the menu instead of into the run they just
   * asked for.
   */
  reset(): void {
    this.igniting.clear();
    for (const runtime of this.districts.all) {
      runtime.lit = false;
      runtime.light = 0;
      this.applyLight(runtime, 0);
    }
    for (const objects of this.dormant.values()) {
      for (const object of objects) object.visible = false;
    }
    this.updateAmbient();
  }

  restore(litDistricts: readonly string[]): void {
    for (const id of litDistricts) {
      const runtime = this.districts.all.find((d) => d.def.id === id);
      if (!runtime) continue;
      runtime.lit = true;
      runtime.light = 1;
      this.applyLight(runtime, 1);
      this.revealDormant(runtime.def.id);
    }
    this.updateAmbient();
  }

  update(dt: number): void {
    if (this.igniting.size === 0) return;

    for (const [district, elapsed] of [...this.igniting]) {
      const next = elapsed + dt;
      const runtime = this.districts.get(district);

      const t = Math.min(1, next / IGNITE_SECONDS);
      // Ease-out: the light rushes in and settles, rather than ramping linearly.
      runtime.light = 1 - Math.pow(1 - t, 3);
      this.applyLight(runtime, runtime.light);

      // Life returns a beat before the light finishes, so the district feels
      // inhabited rather than merely illuminated.
      if (elapsed < 1.8 && next >= 1.8) this.revealDormant(district);

      if (t >= 1) {
        this.igniting.delete(district);
        this.bus.emit('district:lit', {
          district,
          litCount: this.districts.litCount,
        });
      } else {
        this.igniting.set(district, next);
      }
    }

    this.updateAmbient();
  }

  private applyLight(runtime: DistrictRuntime, level: number): void {
    const lamps = this.lampsByDistrict.get(runtime.def.id);
    if (!lamps) return;

    _colour.set(runtime.def.litColour);

    for (let i = 0; i < lamps.lights.length; i++) {
      // Each lamp has its own delay, so they catch one after another.
      const delay = lamps.delays[i] ?? 0;
      const local = THREE.MathUtils.clamp((level - delay) / Math.max(0.01, 1 - delay), 0, 1);

      const light = lamps.lights[i];
      if (light) {
        // Candela, not the old arbitrary unit.
        //
        // This was `local * 9`, tuned against three's pre-r155 lighting model.
        // Since r155 a point light is physical: irradiance falls off as 1/d²,
        // so 9 cd at the ~8 m a street lamp is usually seen from lands at
        // about 0.14 — invisible. A district could report `light = 1` with
        // every lamp reporting "on" and the street stayed pitch dark, which is
        // exactly what it did. This is the intensity that actually pools light
        // on the ground.
        light.intensity = local * 55;
        light.color.copy(_colour);
      }

      const bulb = lamps.bulbs[i];
      if (bulb) {
        const material = bulb.material as THREE.MeshStandardMaterial;
        // The bulb has to read as lit *without* bloom, because bloom is off on
        // the low quality tier — and a player on integrated graphics still
        // needs to see that the district came back.
        material.emissiveIntensity = local * 3.2;
        material.emissive.copy(_colour);
      }
    }
  }

  private revealDormant(district: DistrictId): void {
    for (const object of this.dormant.get(district) ?? []) object.visible = true;
  }

  /** Total illumination lifts the ambient so the whole planet warms up. */
  private updateAmbient(): void {
    const total = this.districts.all.reduce((sum, d) => sum + d.light, 0);
    const fraction = total / Math.max(1, this.districts.all.length);
    this.ambient.intensity = this.baseAmbient + fraction * 0.8;
    this.ambient.color.set('#6b7796').lerp(new THREE.Color('#f0d7ad'), fraction * 0.7);
  }
}
