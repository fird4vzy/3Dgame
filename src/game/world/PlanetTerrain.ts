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

/**
 * Surface palette.
 *
 * Deliberately desaturated towards sage and stone. The reference art is built
 * almost entirely out of muted colour — sage green, grey-teal, dusty red — and
 * saturation is what was making our planet read as a toy rather than a place.
 * Cel shading exaggerates saturation, because a flat fill has nothing to break
 * it up the way texture and gradient do, so the fills have to start quieter
 * than they would in a lit renderer.
 */
const PALETTE: Record<SurfaceKind, THREE.Color> = {
  grass: new THREE.Color('#6d8a63'),
  sand: new THREE.Color('#dccb9e'),
  stone: new THREE.Color('#8b8b8f'),
};

/** Dry coastal grass, between the beach and the meadow. */
const DUNE_GRASS = new THREE.Color('#b3c16a');

/** Packed earth and gravel — a track people walk. */
const PATH_COLOUR = new THREE.Color('#b8a98c');

/** Grass is a range, not a value — see `paint`. */
// Lush under a day sky. The sage pair was mixed for dusk and under daylight
// read as khaki; the reference hillsides are a saturated spring green.
const GRASS_LOW = new THREE.Color('#4a7a3c');
const GRASS_HIGH = new THREE.Color('#8ec45c');

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Hermite ease between two edges — the GLSL one. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * A level platform cut into the terrain for something to stand on.
 *
 * Buildings are placed at a point, but they have a *footprint*, and on a hill
 * the two disagree: put a five-metre farmhouse down on a slope and the uphill
 * wall is buried to the sill while the downhill one hangs in the air. Every
 * screenshot of a "floating house" was this. The honest fix is the one real
 * villages use — level the ground first — and doing it inside {@link
 * PlanetTerrain.heightAt} rather than as a plinth mesh means the mesh, the
 * collision and every prop scattered nearby all agree, by construction.
 */
export interface TerrainPad {
  /** Unit direction from the planet centre. */
  direction: THREE.Vector3;
  /** Radius the pad is to be, in metres. */
  height: number;
  /** Metres from the centre that are dead flat. */
  flat: number;
  /** Metres from the centre by which the pad has blended back into the hill. */
  blend: number;
  /**
   * Whether this pad joins a shared terrace with pads whose flats touch it.
   * Default true; false for something that is not a building's footing — a
   * lagoon cut below the waterline must not average its depth with the
   * houses on its shore.
   */
  merge?: boolean;
}

/**
 * A worn track, painted into the ground.
 *
 * Purely visual — it does not change the height — but a shrine approach with
 * no path under it is a row of gates in a field, and the path is what turns
 * them into a route.
 */
export interface TerrainPath {
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Half-width in metres at full strength; the edge softens over as much again. */
  width: number;
}

interface PreparedPad extends TerrainPad {
  /** cos of the outer angle, so most pads are rejected with one dot product. */
  cosOuter: number;
}

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
    // A clear lagoon blue under a day sky. The old teal was mixed for dusk
    // and under daylight read as grey-green paint.
    const waterMaterial = createToonMaterial({
      color: '#3b98c4',
      bands: 3,
      transparent: true,
      opacity: 0.82,
    });

    // Move the surface in the vertex shader.
    //
    // A still sphere reads as painted glass, and it was the one thing in the
    // world with no motion at all. Two crossed sine waves in world space are
    // enough — the eye is looking for *change*, not for correct fluid dynamics,
    // and the amplitude is centimetres.
    //
    // It has to happen on the GPU. This is a detail-5 icosphere, and walking
    // ten thousand vertices on the CPU every frame to move them a few
    // centimetres is exactly the kind of cost that never shows up in a profile
    // as one big number and quietly eats a third of the frame.
    //
    // `onBeforeCompile` rather than a custom material, so the toon banding,
    // fog and shadows all keep working.
    waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waterTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vec3 swellDir = normalize(transformed);
           float swell =
             sin(transformed.x * 0.55 + uTime * 0.9) * 0.5 +
             sin(transformed.z * 0.41 - uTime * 0.7) * 0.5 +
             sin((transformed.x + transformed.y) * 0.23 + uTime * 0.35);
           transformed += swellDir * swell * 0.085;`,
        );
    };

    this.water = new THREE.Mesh(waterGeometry, waterMaterial);
    this.water.name = 'water';
  }

  /** Shared with the water shader; advanced by `update`. */
  private readonly waterTime = { value: 0 };

  /** Advance the swell. Called once a frame. */
  update(dt: number): void {
    this.waterTime.value += dt;
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

    let height = PLANET_RADIUS + signed * TERRAIN_AMPLITUDE;

    // Level ground under anything with a footprint. Linear in the number of
    // pads, but a dot product each and a few dozen pads, and the mesh is only
    // built once — gameplay queries are a handful per frame.
    //
    // Where pads overlap, the strongest one has to win outright rather than
    // share: blending two pads at different heights *across* a footprint tilts
    // the flat that was the whole point. Raising the weights to a power before
    // averaging does that — a pad at full strength drowns out a neighbour's
    // skirt — and pads whose flats actually touch are merged to one height in
    // `setPads`, so nothing is left to fight over.
    let sum = 0;
    let sumHeight = 0;
    let strongest = 0;
    for (const pad of PlanetTerrain.pads) {
      const cosA = d.dot(pad.direction);
      if (cosA < pad.cosOuter) continue;
      const distance = Math.acos(Math.min(1, cosA)) * PLANET_RADIUS;
      const weight = 1 - smoothstep(pad.flat, pad.blend, distance);
      if (weight <= 0) continue;
      const sharp = weight * weight * weight * weight;
      sum += sharp;
      sumHeight += sharp * pad.height;
      if (weight > strongest) strongest = weight;
    }
    if (sum > 0) height += (sumHeight / sum - height) * strongest;

    return height;
  }

  private static pads: PreparedPad[] = [];
  private static paths: TerrainPath[] = [];

  /** Replace the set of painted tracks. Takes effect on the next build. */
  static setPaths(paths: TerrainPath[]): void {
    PlanetTerrain.paths = paths.map((p) => ({ ...p, from: p.from.clone(), to: p.to.clone() }));
  }

  /**
   * Replace the set of level pads. Call before the mesh is built (or call
   * {@link rebuild} after), because the height function is what the mesh is
   * displaced from.
   */
  static setPads(pads: TerrainPad[]): void {
    const prepared: PreparedPad[] = pads.map((pad) => ({
      ...pad,
      direction: pad.direction.clone().normalize(),
      cosOuter: Math.cos(pad.blend / PLANET_RADIUS),
    }));

    // Pads whose flats touch become one terrace at their mean height.
    //
    // Two houses four metres apart each want the ground level under
    // themselves, and if the ground under one is a metre higher than under
    // the other there is no honest way to give both what they want. A shared
    // terrace is what a real village does with that hillside.
    const group = prepared.map((_, i) => i);
    const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i]!)));
    for (let i = 0; i < prepared.length; i++) {
      for (let j = i + 1; j < prepared.length; j++) {
        const a = prepared[i]!;
        const b = prepared[j]!;
        const distance = Math.acos(Math.min(1, a.direction.dot(b.direction))) * PLANET_RADIUS;
        if (a.merge === false || b.merge === false) continue;
        if (distance < (a.flat + b.flat) * 0.95) group[find(i)] = find(j);
      }
    }
    const totals = new Map<number, { sum: number; count: number }>();
    prepared.forEach((pad, i) => {
      const root = find(i);
      const t = totals.get(root) ?? { sum: 0, count: 0 };
      t.sum += pad.height;
      t.count++;
      totals.set(root, t);
    });
    prepared.forEach((pad, i) => {
      const t = totals.get(find(i))!;
      pad.height = t.sum / t.count;
    });

    PlanetTerrain.pads = prepared;
  }

  /**
   * A pad for something standing at `position`, level with the ground at its
   * centre *as it is now* — so this must be called on the un-padded terrain,
   * before {@link setPads}, or pads start stacking on each other.
   */
  static padAt(position: THREE.Vector3, flat: number, blend = flat + 3): TerrainPad {
    const direction = position.clone().normalize();
    return { direction, height: PlanetTerrain.heightAt(direction), flat, blend };
  }

  /** 0..1, how much of a painted track lies under a surface direction. */
  private static trackAt(direction: THREE.Vector3, height: number): number {
    if (PlanetTerrain.paths.length === 0) return 0;
    _t0.copy(direction).multiplyScalar(height);
    let strength = 0;
    for (const path of PlanetTerrain.paths) {
      // Point-to-segment in Cartesian: at these lengths the chord and the arc
      // differ by less than the vertex spacing.
      _t1.copy(path.to).sub(path.from);
      const lengthSq = _t1.lengthSq();
      const t = lengthSq > 0 ? clamp01(_t2.copy(_t0).sub(path.from).dot(_t1) / lengthSq) : 0;
      _t2.copy(path.from).addScaledVector(_t1, t);
      const distance = _t2.distanceTo(_t0);
      strength = Math.max(strength, 1 - smoothstep(path.width, path.width * 2, distance));
    }
    return strength;
  }

  /** Re-displace the mesh from the current height function. */
  rebuild(): void {
    this.displace(this.mesh.geometry);
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

  /**
   * Push every vertex out to its terrain height, then colour it.
   *
   * Colour is computed **after** `computeVertexNormals`, which is the whole
   * trick: it makes the true surface normal available, so steepness is exact
   * and free rather than something we would have to re-derive by sampling
   * `heightAt` around every vertex.
   */
  private displace(geometry: THREE.BufferGeometry): void {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const count = position.count;
    const v = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(position, i).normalize();
      const height = PlanetTerrain.heightAt(v);
      position.setXYZ(i, v.x * height, v.y * height, v.z * height);
    }

    position.needsUpdate = true;
    geometry.computeVertexNormals();
    this.paint(geometry);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }

  /**
   * Per-vertex surface colour.
   *
   * The first pass switched on `surfaceAt`, which returns one of three names.
   * Three flat colours with hard edges between them is exactly what it looked
   * like: two enormous bands of unbroken green and tan meeting at a seam. A
   * whole planet cannot be three values.
   *
   * Three things fix it, and none of them needs a texture:
   *
   * - **Blend the biomes** over a band instead of switching at a threshold.
   * - **Rock the slopes.** Steepness, not just altitude, decides stone — which
   *   is why real hillsides have grey faces and green tops, and it is the
   *   cheapest single thing that makes terrain read as terrain.
   * - **Break the flat.** Two octaves of noise modulate value and warmth, so
   *   no two hillsides are the same green.
   */
  private paint(geometry: THREE.BufferGeometry): void {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const count = position.count;
    const colors = new Float32Array(count * 3);

    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const colour = new THREE.Color();

    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(position, i);
      const height = v.length();
      v.normalize();
      n.fromBufferAttribute(normal, i);

      // 0 on flat ground, rising as the face tilts away from straight up.
      const slope = 1 - Math.max(0, n.dot(v));

      // Two scales of variation: broad regional drift, and a finer break-up
      // that stops adjacent facets reading as one painted surface.
      const broad = fbm3(v.x * 2.6, v.y * 2.6, v.z * 2.6, 3, 2.1, 0.5, WORLD_SEED + 401);
      const fine = fbm3(v.x * 9.5, v.y * 9.5, v.z * 9.5, 2, 2.4, 0.5, WORLD_SEED + 977);
      const drift = (broad - 0.5) * 2;
      const grain = (fine - 0.5) * 2;

      // Grass first, varied between a shaded low green and a sunlit one.
      colour.copy(GRASS_LOW).lerp(GRASS_HIGH, clamp01(0.5 + drift * 0.75));

      // Sand hugs the waterline — and only the waterline.
      //
      // This band ran to 2.4 m above sea level on a planet whose entire terrain
      // amplitude is 6 m, so sand claimed most of the habitable surface and the
      // world read as desert. A beach is the strip you can throw a stone across
      // from the water; everything past it is grass.
      // The strip itself is narrow; above it a paler, drier green runs up
      // the first half-metre so the beach meets meadow instead of lawn. The
      // planet's flats sit just above the waterline, and a wider band here
      // turned every one of them into desert.
      const meadow = 1 - smoothstep(SEA_LEVEL_RADIUS + 0.12, SEA_LEVEL_RADIUS + 0.7, height);
      if (meadow > 0) colour.lerp(DUNE_GRASS, meadow * 0.7);
      const sand = 1 - smoothstep(SEA_LEVEL_RADIUS + 0.02, SEA_LEVEL_RADIUS + 0.14, height);
      if (sand > 0) colour.lerp(PALETTE.sand, sand);

      // Stone comes from altitude *or* steepness, whichever is stronger. Kept
      // to genuine peaks for the same reason: rock everywhere is another way of
      // having no grass.
      const byAltitude = smoothstep(
        PLANET_RADIUS + TERRAIN_AMPLITUDE * 0.62,
        PLANET_RADIUS + TERRAIN_AMPLITUDE * 0.88,
        height,
      );
      const bySlope = smoothstep(0.12, 0.30, slope);
      const stone = Math.max(byAltitude, bySlope);
      if (stone > 0) colour.lerp(PALETTE.stone, stone * 0.92);

      // Tracks, over everything but the water's edge.
      const track = PlanetTerrain.trackAt(v, height);
      if (track > 0) colour.lerp(PATH_COLOUR, track * 0.85);

      // Finally a little tonal grain, and a touch of depth in the hollows.
      colour.multiplyScalar(1 + grain * 0.09 - Math.max(0, -drift) * 0.06);

      colors[i * 3] = colour.r;
      colors[i * 3 + 1] = colour.g;
      colors[i * 3 + 2] = colour.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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
const _t0 = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
