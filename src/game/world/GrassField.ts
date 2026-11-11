import * as THREE from 'three';
import { NO_INK } from '@engine/render/InkEffect';
import { toonGradient } from '@engine/render/WorldMaterial';
import { makeRng } from '@core/math/rng';
import { applyAtmosphere, atmosphereUniforms } from '@engine/render/Atmosphere';

/**
 * A field of grass over the whole planet.
 *
 * The single thing that most separates a lawn-coloured sphere from a hillside.
 * Every clump is real geometry — seven tapered, curved blades — instanced by
 * the hundred thousand, because grass is read by its *edges*: the ragged
 * silhouette against the sky on a ridge, the way it parts round your feet,
 * the light coming through it when you look toward the sun. A texture on the
 * ground has none of those.
 *
 * Placement comes from the terrain mesh itself — random points on its
 * triangles, weighted by the `grass` attribute the terrain painted — so the
 * blades sit exactly on the drawn surface (not on the analytic height, which
 * differs from the mesh by centimetres between vertices) and never grow on a
 * beach, a rock face, a track or a floor.
 *
 * Cost control, in order of how much each buys:
 *
 * 1. **Chunks.** The clumps are bucketed into 12 m cells, each its own draw
 *    with a real bounding sphere, so frustum culling works and anything past
 *    {@link DRAW_RADIUS} is not drawn at all.
 * 2. **Distance LOD.** Each chunk's instances are shuffled at build time, so
 *    any prefix is a uniform sample of it; far chunks draw a shorter prefix.
 * 3. **Fade.** Blades shrink into the ground with distance in the vertex
 *    shader, so the LOD steps and the draw radius are never seen.
 * 4. **No shadow casting.** Grass shadows are noise at this scale and would
 *    double the shadow pass; it *receives* shadows, which is the part you see.
 *
 * Shading is the standard material with three changes: colour runs from a dark
 * root to a sunlit tip; normals lean up, so a field shades like the ground it
 * covers rather than like a thousand cards; and blades between the eye and the
 * sun are lit *through*, which is the golden-backlit look of the reference.
 */

/** Clumps per square metre where the ground is fully grassed. */
const DENSITY = 6.5;
const CHUNK_SIZE = 12;
/** Chunks whose centre is further than this from the camera are not drawn. */
const DRAW_RADIUS = 40;
/** Blade fade, metres from the camera. */
const FADE_START = 22;
const FADE_END = 33;
const BLADES_PER_CLUMP = 7;

interface Chunk {
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  centre: THREE.Vector3;
  count: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _p = new THREE.Vector3();

/** One clump: blades fanned round a centre, each curved and tapered. */
function buildClump(seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let blade = 0; blade < BLADES_PER_CLUMP; blade++) {
    const around = (blade / BLADES_PER_CLUMP) * Math.PI * 2 + rng() * 0.8;
    const spread = 0.02 + rng() * 0.08;
    const baseX = Math.cos(around) * spread;
    const baseZ = Math.sin(around) * spread;

    const height = 0.32 + rng() * 0.26;
    const width = 0.022 + rng() * 0.016;
    const facing = rng() * Math.PI * 2;
    // Blades lean outward from the clump's heart, and droop at the tip.
    const lean = 0.06 + rng() * 0.16;
    const leanX = Math.cos(around) * lean;
    const leanZ = Math.sin(around) * lean;

    const sideX = Math.cos(facing);
    const sideZ = Math.sin(facing);
    // Mostly up, tilted a little toward the blade's face: shades like ground,
    // with just enough variation between blades to read as separate leaves.
    const nx = -sideZ * 0.35;
    const nz = sideX * 0.35;
    const nl = Math.hypot(nx, 1, nz);

    const start = positions.length / 3;
    const rows: Array<[number, number]> = [
      [0, 1],
      [0.55, 0.62],
    ];
    for (const [t, w] of rows) {
      const curve = t * t;
      const cx = baseX + leanX * curve;
      const cz = baseZ + leanZ * curve;
      const half = (width * w) / 2;
      positions.push(cx - sideX * half, height * t, cz - sideZ * half);
      positions.push(cx + sideX * half, height * t, cz + sideZ * half);
      uvs.push(0, t, 1, t);
      normals.push(nx / nl, 1 / nl, nz / nl, nx / nl, 1 / nl, nz / nl);
    }
    // Tip, drooping past the lean.
    positions.push(baseX + leanX * 1.25, height * (0.97 - lean * 0.4), baseZ + leanZ * 1.25);
    uvs.push(0.5, 1);
    normals.push(nx / nl, 1 / nl, nz / nl);

    indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2, start + 2, start + 3, start + 4);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

const VERTEX_PARS = /* glsl */ `
attribute vec3 aOffset;
attribute vec4 aParams;   // yaw, height scale, width scale, phase
attribute vec3 aColour;
uniform float uTime;
uniform vec3 uPlayer;
uniform vec3 uWindDir;
uniform vec2 uFade;
varying float vGrassH;
varying vec3 vGrassColour;
varying vec3 vGrassWorld;
`;

// The clump's own frame on the sphere: up is radial, yaw spins it.
const VERTEX_FRAME = /* glsl */ `
  vec3 gUp = normalize(aOffset);
  vec3 gRef = abs(gUp.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 gT = normalize(cross(gRef, gUp));
  vec3 gB = cross(gUp, gT);
  float gC = cos(aParams.x);
  float gS = sin(aParams.x);
  vec3 gX = gT * gC + gB * gS;
  vec3 gZ = cross(gX, gUp);
  vec3 objectNormal = normalize(gX * normal.x + gUp * normal.y + gZ * normal.z);
`;

const VERTEX_PLACE = /* glsl */ `
  float gDist = distance(aOffset, cameraPosition);
  float gFade = 1.0 - smoothstep(uFade.x, uFade.y, gDist);
  float gH = uv.y;
  vec3 gLocal = position * vec3(aParams.z, aParams.y * gFade, aParams.z);
  vec3 transformed = aOffset + gX * gLocal.x + gUp * gLocal.y + gZ * gLocal.z;

  // Wind: a slow wave rolling across the planet, with a faster flutter per
  // clump on top. Bend grows with the square of height, so roots stay put.
  vec3 gWind = uWindDir - gUp * dot(uWindDir, gUp);
  float gWave = sin(uTime * 0.9 - dot(aOffset, normalize(gWind + 1e-4)) * 0.35) * 0.5 + 0.5;
  float gFlutter = sin(uTime * 3.1 + aParams.w * 6.2831 + aOffset.x * 1.7) * 0.5 + 0.5;
  float gBend = (0.05 + 0.2 * gWave + 0.06 * gFlutter) * gH * gH * aParams.y;
  transformed += gWind * gBend;

  // Parting round the player's feet.
  vec3 gAway = aOffset - uPlayer;
  gAway -= gUp * dot(gAway, gUp);
  float gNear = length(gAway);
  float gPush = (1.0 - smoothstep(0.2, 0.85, gNear)) * gH * gH * aParams.y;
  transformed += (gAway / max(gNear, 1e-3)) * gPush * 0.42;
  // Keep the blade's length roughly constant as it bends.
  transformed -= gUp * (gBend * gBend * 0.6 + gPush * 0.22);

  vGrassH = gH;
  vGrassColour = aColour;
  vGrassWorld = transformed;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 uGrassSunDir;
uniform vec3 uGrassSunColour;
varying float vGrassH;
varying vec3 vGrassColour;
varying vec3 vGrassWorld;
`;

export class GrassField {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private readonly material: THREE.MeshToonMaterial;
  private readonly uniforms = {
    uTime: { value: 0 },
    uPlayer: { value: new THREE.Vector3() },
    uWindDir: { value: new THREE.Vector3(0.6, 0.15, 0.78).normalize() },
    uFade: { value: new THREE.Vector2(FADE_START, FADE_END) },
  };
  private totalClumps = 0;

  constructor(terrain: THREE.BufferGeometry, seed: number, density = DENSITY) {
    this.group.name = 'grass';
    this.material = this.buildMaterial();
    const clump = buildClump(seed);
    this.scatter(terrain, clump, seed, density);
  }

  /** How many clumps were planted, for tooling and tests. */
  get clumpCount(): number {
    return this.totalClumps;
  }

  get chunkCount(): number {
    return this.chunks.length;
  }

  update(dt: number, player: THREE.Vector3, camera: THREE.Camera): void {
    this.uniforms.uTime.value += dt;
    this.uniforms.uPlayer.value.copy(player);

    for (const chunk of this.chunks) {
      const distance = chunk.centre.distanceTo(camera.position);
      const visible = distance < DRAW_RADIUS;
      chunk.mesh.visible = visible;
      if (!visible) continue;
      // Full density near, a third at the fade, never less: the fade itself
      // is what hides the last of them.
      const lod = 1 - THREE.MathUtils.smoothstep(distance, 14, FADE_END) * 0.68;
      chunk.geometry.instanceCount = Math.max(1, Math.ceil(chunk.count * lod));
    }
  }

  dispose(): void {
    for (const chunk of this.chunks) chunk.geometry.dispose();
    this.material.dispose();
  }

  private buildMaterial(): THREE.MeshToonMaterial {
    const material = new THREE.MeshToonMaterial({
      side: THREE.DoubleSide,
      gradientMap: toonGradient(),
    });
    material.name = 'grass';

    material.onBeforeCompile = (shader) => {
      applyAtmosphere(shader);
      Object.assign(shader.uniforms, this.uniforms, {
        uGrassSunDir: atmosphereUniforms.atmoSunDir,
        uGrassSunColour: atmosphereUniforms.atmoSunColour,
      });

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace('#include <beginnormal_vertex>', VERTEX_FRAME)
        .replace('#include <begin_vertex>', VERTEX_PLACE);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // Dark, cool roots in the clump's own shade; warm, pale tips in the sun.
          vec3 gRoot = vGrassColour * vec3(0.32, 0.38, 0.3);
          vec3 gTip = vGrassColour * vec3(1.18, 1.14, 0.9) + vec3(0.05, 0.05, 0.0);
          diffuseColor.rgb = mix(gRoot, gTip, smoothstep(0.0, 1.0, vGrassH));`,
        )
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${NO_INK}`)
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
          // Both faces of a blade share one normal; the default flip would
          // shade every back face as if it pointed into the ground.
          normal = normalize(vNormal);`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          {
            // Light through the blade, toward the eye, strongest at the tip.
            vec3 gToEye = normalize(cameraPosition - vGrassWorld);
            float gBack = pow(max(dot(-gToEye, uGrassSunDir), 0.0), 3.0);
            reflectedLight.directDiffuse +=
              uGrassSunColour * diffuseColor.rgb * gBack * vGrassH * vGrassH * 1.6;
          }`,
        );
    };
    return material;
  }

  /**
   * Plant clumps on the terrain's triangles, weighted by its grass attribute,
   * and bucket them into chunks.
   */
  private scatter(
    terrain: THREE.BufferGeometry,
    clump: THREE.BufferGeometry,
    seed: number,
    density: number,
  ): void {
    const position = terrain.getAttribute('position') as THREE.BufferAttribute;
    const colour = terrain.getAttribute('color') as THREE.BufferAttribute | undefined;
    const grass = terrain.getAttribute('grass') as THREE.BufferAttribute | undefined;
    if (!grass || !colour) return;
    const index = terrain.getIndex();
    const triangles = index ? index.count / 3 : position.count / 3;
    const vertex = (t: number, corner: number): number =>
      index ? index.getX(t * 3 + corner) : t * 3 + corner;

    const rng = makeRng(seed);
    const buckets = new Map<string, number[]>();

    for (let t = 0; t < triangles; t++) {
      const ia = vertex(t, 0);
      const ib = vertex(t, 1);
      const ic = vertex(t, 2);
      const wa = grass.getX(ia);
      const wb = grass.getX(ib);
      const wc = grass.getX(ic);
      if (wa + wb + wc < 0.03) continue;

      _a.fromBufferAttribute(position, ia);
      _b.fromBufferAttribute(position, ib);
      _c.fromBufferAttribute(position, ic);
      _ab.subVectors(_b, _a);
      _ac.subVectors(_c, _a);
      const area = _ab.clone().cross(_ac).length() * 0.5;

      const expected = area * density;
      let n = Math.floor(expected);
      if (rng() < expected - n) n++;

      for (let k = 0; k < n; k++) {
        let u = rng();
        let v = rng();
        if (u + v > 1) {
          u = 1 - u;
          v = 1 - v;
        }
        const w = 1 - u - v;
        // Density follows the weight within the triangle, not just its mean.
        const weight = wa * w + wb * u + wc * v;
        if (rng() >= weight) continue;

        _p.copy(_a).addScaledVector(_ab, u).addScaledVector(_ac, v);
        const key = `${Math.floor(_p.x / CHUNK_SIZE)},${Math.floor(_p.y / CHUNK_SIZE)},${Math.floor(_p.z / CHUNK_SIZE)}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        const r = colour.getX(ia) * w + colour.getX(ib) * u + colour.getX(ic) * v;
        const g = colour.getY(ia) * w + colour.getY(ib) * u + colour.getY(ic) * v;
        const b = colour.getZ(ia) * w + colour.getZ(ib) * u + colour.getZ(ic) * v;
        // Sparse grass is shorter grass: thin patches thin out *and* down.
        const heightScale = (0.55 + rng() * 0.75) * (0.55 + weight * 0.45);
        const widthScale = 0.8 + rng() * 0.5;
        bucket.push(_p.x, _p.y, _p.z, rng() * Math.PI * 2, heightScale, widthScale, rng(), r, g, b);
      }
    }

    const STRIDE = 10;
    for (const data of buckets.values()) {
      const count = data.length / STRIDE;
      // Shuffle, so that any prefix is a uniform sample — the LOD draws one.
      for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        for (let f = 0; f < STRIDE; f++) {
          const tmp = data[i * STRIDE + f]!;
          data[i * STRIDE + f] = data[j * STRIDE + f]!;
          data[j * STRIDE + f] = tmp;
        }
      }

      const offsets = new Float32Array(count * 3);
      const params = new Float32Array(count * 4);
      const colours = new Float32Array(count * 3);
      const centre = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        const o = i * STRIDE;
        offsets.set([data[o]!, data[o + 1]!, data[o + 2]!], i * 3);
        params.set([data[o + 3]!, data[o + 4]!, data[o + 5]!, data[o + 6]!], i * 4);
        colours.set([data[o + 7]!, data[o + 8]!, data[o + 9]!], i * 3);
        centre.x += data[o]!;
        centre.y += data[o + 1]!;
        centre.z += data[o + 2]!;
      }
      centre.divideScalar(count);
      let radius = 0;
      for (let i = 0; i < count; i++) {
        _p.fromArray(offsets, i * 3);
        radius = Math.max(radius, _p.distanceTo(centre));
      }

      const geometry = new THREE.InstancedBufferGeometry();
      geometry.index = clump.index;
      geometry.setAttribute('position', clump.getAttribute('position'));
      geometry.setAttribute('normal', clump.getAttribute('normal'));
      geometry.setAttribute('uv', clump.getAttribute('uv'));
      geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
      geometry.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
      geometry.setAttribute('aColour', new THREE.InstancedBufferAttribute(colours, 3));
      geometry.instanceCount = count;
      // Bounds of where the instances actually are, plus a blade's height,
      // so frustum culling sees the chunk rather than one clump at the origin.
      geometry.boundingSphere = new THREE.Sphere(centre.clone(), radius + 1);
      geometry.boundingBox = new THREE.Box3().setFromCenterAndSize(
        centre.clone(),
        new THREE.Vector3(radius * 2 + 2, radius * 2 + 2, radius * 2 + 2),
      );

      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = 'grass_chunk';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.chunks.push({ mesh, geometry, centre, count });
      this.totalClumps += count;
    }
  }
}
