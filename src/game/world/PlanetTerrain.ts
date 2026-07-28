import * as THREE from 'three';
import { fbm3 } from '@core/math/rng';
import { createToonMaterial } from '@engine/render/ToonMaterial';
import {
  PLANET_RADIUS,
  SEA_LEVEL_RADIUS,
  TERRAIN_AMPLITUDE,
  TERRAIN_DETAIL,
  WORLD_SEED,
} from '@config/constants';

export type SurfaceKind = 'grass' | 'sand' | 'stone';

const PALETTE: Record<SurfaceKind, THREE.Color> = {
  grass: new THREE.Color('#5d9e63'),
  sand: new THREE.Color('#d8c58c'),
  stone: new THREE.Color('#8d8b93'),
};

/**
 * The planet surface.
 *
 * Terrain is a displaced icosphere driven by a deterministic noise function.
 * Crucially, that function is exposed as {@link heightAt}, so gameplay code can
 * place props, spawn points and collectibles analytically — no raycasting
 * required, and level data stays authorable as (lat, lon, alt).
 */
export class PlanetTerrain {
  readonly mesh: THREE.Mesh;
  readonly water: THREE.Mesh;

  constructor() {
    const geometry = new THREE.IcosahedronGeometry(PLANET_RADIUS, TERRAIN_DETAIL);
    this.displace(geometry);

    // Cel-banded, and still low-poly: the icosphere is non-indexed, so
    // computeVertexNormals() yields per-face normals and the facets read flat
    // without needing a flatShading flag (which MeshToonMaterial lacks anyway).
    const material = createToonMaterial({ vertexColors: true, bands: 4 });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'terrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;

    const waterGeometry = new THREE.IcosahedronGeometry(SEA_LEVEL_RADIUS, 5);
    const waterMaterial = createToonMaterial({
      color: '#2f6f86',
      bands: 3,
      transparent: true,
      opacity: 0.86,
    });
    this.water = new THREE.Mesh(waterGeometry, waterMaterial);
    this.water.name = 'water';
  }

  /**
   * Surface radius along a direction from the planet centre.
   *
   * This is the single source of truth for terrain height — the mesh is built
   * from it, and gameplay queries it directly. Two implementations would drift.
   */
  static heightAt(direction: THREE.Vector3): number {
    const d = _dir.copy(direction).normalize();

    // Continents: low frequency, high amplitude.
    const continents = fbm3(d.x * 1.1, d.y * 1.1, d.z * 1.1, 4, 2.1, 0.5, WORLD_SEED);
    // Hills: higher frequency, sharpened so ridges read as ridges.
    const hills = fbm3(d.x * 3.4, d.y * 3.4, d.z * 3.4, 3, 2.3, 0.45, WORLD_SEED + 91);

    // Bias the mixture so a little over half the planet sits above sea level.
    const shaped = continents * 0.72 + hills * 0.28;
    const signed = (shaped - 0.46) * 2;

    return PLANET_RADIUS + signed * TERRAIN_AMPLITUDE;
  }

  /** Convenience: the height function above, for any world-space point. */
  heightAt(direction: THREE.Vector3): number {
    return PlanetTerrain.heightAt(direction);
  }

  /**
   * Analytic surface normal, from finite differences of {@link heightAt} along
   * two tangent directions. Used for spawn alignment before the BVH is queried.
   */
  static normalAt(direction: THREE.Vector3, epsilon = 0.02): THREE.Vector3 {
    const up = _n0.copy(direction).normalize();
    const tangent = _n1.set(0, 1, 0);
    if (Math.abs(up.dot(tangent)) > 0.95) tangent.set(1, 0, 0);

    const t1 = _n2.copy(tangent).cross(up).normalize();
    const t2 = _n3.copy(up).cross(t1).normalize();

    const sample = (offset: THREE.Vector3) => {
      const p = _n4.copy(up).addScaledVector(offset, epsilon).normalize();
      return _n5.copy(p).multiplyScalar(PlanetTerrain.heightAt(p));
    };

    const centre = _n6.copy(up).multiplyScalar(PlanetTerrain.heightAt(up));
    const a = sample(t1).clone().sub(centre);
    const b = sample(t2).clone().sub(centre);

    const normal = a.cross(b).normalize();
    // Finite-difference cross products can come out inverted; force outward.
    if (normal.dot(up) < 0) normal.negate();
    return normal;
  }

  /** A safe standing position above sea level, for spawning. */
  static findSpawn(preferred = new THREE.Vector3(0.2, 0.9, 0.35)): THREE.Vector3 {
    const dir = preferred.clone().normalize();
    for (let attempt = 0; attempt < 64; attempt++) {
      const height = PlanetTerrain.heightAt(dir);
      if (height > SEA_LEVEL_RADIUS + 0.6) {
        return dir.multiplyScalar(height + 0.2);
      }
      // Walk along a deterministic spiral until we find dry land.
      const angle = attempt * 0.7;
      dir
        .set(
          Math.cos(angle) * Math.cos(attempt * 0.31),
          Math.sin(attempt * 0.23),
          Math.sin(angle) * Math.cos(attempt * 0.31),
        )
        .normalize();
    }
    return dir.multiplyScalar(PLANET_RADIUS + TERRAIN_AMPLITUDE + 1);
  }

  /** Surface material under a point, for footstep sounds and VFX. */
  static surfaceAt(direction: THREE.Vector3): SurfaceKind {
    const height = PlanetTerrain.heightAt(direction);
    if (height < SEA_LEVEL_RADIUS + 0.9) return 'sand';
    if (height > PLANET_RADIUS + TERRAIN_AMPLITUDE * 0.55) return 'stone';
    return 'grass';
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.water.geometry.dispose();
    (this.water.material as THREE.Material).dispose();
  }

  /** Push every vertex out to its terrain height and colour it by biome. */
  private displace(geometry: THREE.BufferGeometry): void {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const count = position.count;
    const colors = new Float32Array(count * 3);
    const v = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(position, i).normalize();
      const height = PlanetTerrain.heightAt(v);
      position.setXYZ(i, v.x * height, v.y * height, v.z * height);

      const colour = PALETTE[PlanetTerrain.surfaceAt(v)];
      colors[i * 3] = colour.r;
      colors[i * 3 + 1] = colour.g;
      colors[i * 3 + 2] = colour.b;
    }

    position.needsUpdate = true;
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
}

// Scratch vectors — see the note in BvhWorld about hot-path allocation.
const _dir = new THREE.Vector3();
const _n0 = new THREE.Vector3();
const _n1 = new THREE.Vector3();
const _n2 = new THREE.Vector3();
const _n3 = new THREE.Vector3();
const _n4 = new THREE.Vector3();
const _n5 = new THREE.Vector3();
const _n6 = new THREE.Vector3();
