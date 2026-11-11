import * as THREE from 'three';
import { NO_INK } from '@engine/render/InkEffect';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '@core/math/rng';
import { applyAtmosphere, atmosphereUniforms } from '@engine/render/Atmosphere';
import { createWorldMaterial, toonGradient } from '@engine/render/WorldMaterial';
import type { QualityTier } from '@engine/platform/Viewport';

/**
 * Trees with crowns you could lie under.
 *
 * The generated tree models were solid hulls — a few thousand triangles of
 * crown with the foliage painted on — and under real light a hull reads as
 * exactly that: a faceted red rock on a stick. What makes a painted tree read
 * as foliage is the opposite construction, and it is the standard one for
 * stylised-realistic trees:
 *
 * - **Cards, not hulls.** The crown is clusters of small textured quads, each
 *   a clump of blossoms or leaves with transparent gaps, so the silhouette is
 *   ragged and the sky shows through it.
 * - **Spherical normals.** Every card is lit as if it were a point on the
 *   crown's surface — normal pointing out from the crown's heart — so the
 *   whole tree shades as one soft volume, lit on the sun side and cool on the
 *   other, instead of a thousand cards each catching the light differently.
 * - **Depth darkening.** Cards deep inside and low in the crown are darker;
 *   that is the self-shadowing that gives a crown its weight.
 * - **Light through the leaves** toward the sun, as with the grass.
 * - **Wind**, growing with height, so the trunk stands and the crown moves.
 *
 * The leaf textures are painted here, into pixel buffers, at load — no image
 * assets and no canvas, so this also runs where there is no DOM.
 */

export type TreeSpecies = 'sakura' | 'momiji' | 'pine';

/** Every template is built at this height; instances scale from it. */
const NOMINAL_HEIGHT = 5;

interface SpeciesStyle {
  leaf: 'blossom' | 'maple' | 'needle';
  bark: string;
  trunkTop: number;
  trunkRadius: number;
  lean: number;
  crownCentre: number;
  crownRadius: [number, number];
  clusters: number;
  cardsPerCluster: number;
  clusterRadius: [number, number];
  cardSize: [number, number];
  branches: number;
  /** Narrow toward the top: a conifer, not a cloud. */
  conical: boolean;
  /** Per-tree tint range, multiplied over the leaf texture. */
  tints: [string, string];
}

const STYLES: Record<TreeSpecies, SpeciesStyle> = {
  // Wide, low, umbrella crown on a dark leaning trunk: the tree people picture.
  sakura: {
    leaf: 'blossom',
    bark: '#3d2b26',
    trunkTop: 1.9,
    trunkRadius: 0.17,
    lean: 0.45,
    crownCentre: 3.35,
    crownRadius: [2.5, 1.35],
    clusters: 20,
    cardsPerCluster: 18,
    clusterRadius: [0.6, 1.0],
    cardSize: [1.25, 1.8],
    branches: 5,
    conical: false,
    tints: ['#ffffff', '#ffe4ec'],
  },
  // Rounder and layered, on a slender grey trunk.
  momiji: {
    leaf: 'maple',
    bark: '#4a3b33',
    trunkTop: 1.7,
    trunkRadius: 0.13,
    lean: 0.3,
    crownCentre: 3.2,
    crownRadius: [1.95, 1.55],
    clusters: 18,
    cardsPerCluster: 16,
    clusterRadius: [0.5, 0.9],
    cardSize: [1.1, 1.6],
    branches: 4,
    conical: false,
    tints: ['#ffffff', '#ffd9b0'],
  },
  // A dark cedar spire: the silhouette that gives a Japanese hillside depth.
  pine: {
    leaf: 'needle',
    bark: '#3b2e27',
    trunkTop: 4.6,
    trunkRadius: 0.15,
    lean: 0.08,
    crownCentre: 3.0,
    crownRadius: [1.55, 2.1],
    clusters: 26,
    cardsPerCluster: 14,
    clusterRadius: [0.5, 0.85],
    cardSize: [1.15, 1.55],
    branches: 0,
    conical: true,
    tints: ['#ffffff', '#d8e8d0'],
  },
};

// ── leaf textures ─────────────────────────────────────────────────────────

const TEX = 256;

/** Paint soft ellipses into an RGBA buffer with "over" compositing. */
class Painter {
  readonly data = new Uint8Array(TEX * TEX * 4);

  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    angle: number,
    colour: [number, number, number],
    alpha = 1,
  ): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const reach = Math.max(rx, ry) + 1.5;
    const x0 = Math.max(0, Math.floor(cx - reach));
    const x1 = Math.min(TEX - 1, Math.ceil(cx + reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const y1 = Math.min(TEX - 1, Math.ceil(cy + reach));
    const edge = Math.min(rx, ry);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const u = (dx * cos + dy * sin) / rx;
        const v = (-dx * sin + dy * cos) / ry;
        const d = Math.sqrt(u * u + v * v);
        // Approximate pixels-to-edge, for a one-pixel anti-aliased rim.
        const coverage = Math.min(1, Math.max(0, (1 - d) * edge + 0.5)) * alpha;
        if (coverage <= 0) continue;

        const i = (y * TEX + x) * 4;
        const dstA = this.data[i + 3]! / 255;
        const outA = coverage + dstA * (1 - coverage);
        for (let c = 0; c < 3; c++) {
          const dst = this.data[i + c]!;
          this.data[i + c] = Math.round(
            (colour[c]! * coverage + dst * dstA * (1 - coverage)) / Math.max(outA, 1e-4),
          );
        }
        this.data[i + 3] = Math.round(outA * 255);
      }
    }
  }

  texture(): THREE.DataTexture {
    const texture = new THREE.DataTexture(this.data, TEX, TEX, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }
}

/** A point in a disc, denser toward the middle, in texture pixels. */
function inClump(rng: () => number, radius: number): [number, number] {
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * radius * (0.75 + rng() * 0.25);
  return [TEX / 2 + Math.cos(a) * r, TEX / 2 + Math.sin(a) * r];
}

function jitter(rng: () => number, base: [number, number, number], amount: number): [number, number, number] {
  const k = 1 + (rng() - 0.5) * amount;
  return [
    Math.min(255, base[0] * k),
    Math.min(255, base[1] * k),
    Math.min(255, base[2] * k),
  ];
}

function paintLeaves(kind: SpeciesStyle['leaf'], seed: number): THREE.DataTexture {
  const rng = makeRng(seed);
  const p = new Painter();
  const R = TEX * 0.46;

  if (kind === 'blossom') {
    // A few dark twigs and young leaves behind, so the clump has depth.
    for (let i = 0; i < 60; i++) {
      const [x, y] = inClump(rng, R * 0.85);
      p.ellipse(x, y, 2.6, 8, rng() * Math.PI, jitter(rng, [96, 84, 62], 0.3));
    }
    const pinks: Array<[number, number, number]> = [
      [252, 214, 226],
      [247, 190, 208],
      [255, 232, 240],
      [240, 168, 192],
      [250, 202, 220],
    ];
    for (let i = 0; i < 190; i++) {
      const [x, y] = inClump(rng, R);
      const turn = rng() * Math.PI * 2;
      const colour = jitter(rng, pinks[Math.floor(rng() * pinks.length)]!, 0.08);
      const size = 0.85 + rng() * 0.4;
      for (let k = 0; k < 5; k++) {
        const a = turn + (k / 5) * Math.PI * 2;
        p.ellipse(x + Math.cos(a) * 3.4 * size, y + Math.sin(a) * 3.4 * size, 3.3 * size, 2.5 * size, a, colour);
      }
      p.ellipse(x, y, 1.3 * size, 1.3 * size, 0, [206, 96, 126]);
    }
  } else if (kind === 'maple') {
    const reds: Array<[number, number, number]> = [
      [190, 38, 30],
      [214, 72, 38],
      [176, 30, 36],
      [228, 112, 44],
      [236, 160, 62],
    ];
    for (let i = 0; i < 150; i++) {
      const [x, y] = inClump(rng, R);
      const turn = rng() * Math.PI * 2;
      const colour = jitter(rng, reds[Math.floor(rng() * reds.length)]!, 0.14);
      const size = 1.0 + rng() * 0.6;
      // Five lobes fanned from the stem: at this size, a maple leaf.
      for (let k = -2; k <= 2; k++) {
        const a = turn + k * 0.55;
        const lobe = k === 0 ? 1 : Math.abs(k) === 1 ? 0.85 : 0.6;
        p.ellipse(
          x + Math.cos(a) * 4.2 * size * lobe,
          y + Math.sin(a) * 4.2 * size * lobe,
          4.8 * size * lobe,
          1.9 * size,
          a,
          colour,
        );
      }
      p.ellipse(x, y, 2.2 * size, 2.2 * size, 0, colour);
    }
  } else {
    const greens: Array<[number, number, number]> = [
      [44, 72, 46],
      [58, 88, 52],
      [36, 60, 44],
      [72, 100, 58],
    ];
    // A dark mass first, so the spray has a body and not just a fringe.
    for (let i = 0; i < 40; i++) {
      const [x, y] = inClump(rng, R * 0.7);
      p.ellipse(x, y, 9 + rng() * 6, 6 + rng() * 4, rng() * Math.PI, jitter(rng, [30, 50, 36], 0.2));
    }
    for (let i = 0; i < 130; i++) {
      const [x, y] = inClump(rng, R);
      const colour = jitter(rng, greens[Math.floor(rng() * greens.length)]!, 0.2);
      const turn = rng() * Math.PI * 2;
      for (let k = 0; k < 16; k++) {
        const a = turn + (k / 16) * Math.PI * 2 + rng() * 0.2;
        const len = 8 + rng() * 7;
        p.ellipse(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5, len * 0.5, 1.1, a, colour);
      }
    }
  }
  return p.texture();
}

const textureCache = new Map<SpeciesStyle['leaf'], THREE.DataTexture>();
function leafTexture(kind: SpeciesStyle['leaf']): THREE.DataTexture {
  let texture = textureCache.get(kind);
  if (!texture) {
    texture = paintLeaves(kind, kind.length * 7919);
    textureCache.set(kind, texture);
  }
  return texture;
}

// ── geometry ──────────────────────────────────────────────────────────────

/** A tapered tube along a curve, with a root flare at the base. */
function taperedTube(
  points: THREE.Vector3[],
  r0: number,
  r1: number,
  flare: number,
  radial = 7,
  rings = 9,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const across = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent);
    const ref = Math.abs(tangent.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    side.crossVectors(tangent, ref).normalize();
    across.crossVectors(side, tangent).normalize();
    const radius = THREE.MathUtils.lerp(r0, r1, t) * (1 + flare * Math.pow(1 - t, 6));
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      n.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(across, Math.sin(a));
      positions.push(point.x + n.x * radius, point.y + n.y * radius, point.z + n.z * radius);
      normals.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

interface Template {
  trunk: THREE.BufferGeometry;
  foliage: THREE.BufferGeometry;
}

function buildTemplate(style: SpeciesStyle, seed: number): Template {
  const rng = makeRng(seed);
  const rand = (a: number, b: number) => a + rng() * (b - a);

  // Crown clusters: on the outer part of an ellipsoid (a crown is a shell —
  // the middle is branches and shade), or stacked tiers for a conifer.
  const crownCentre = new THREE.Vector3(rand(-1, 1) * style.lean * 0.5, style.crownCentre, rand(-1, 1) * style.lean * 0.5);
  const clusters: Array<{ centre: THREE.Vector3; radius: number }> = [];
  for (let i = 0; i < style.clusters; i++) {
    const centre = new THREE.Vector3();
    if (style.conical) {
      const tier = i / Math.max(1, style.clusters - 1);
      const y = THREE.MathUtils.lerp(1.5, 4.85, tier);
      const spread = style.crownRadius[0] * (1 - tier * 0.82);
      const a = rng() * Math.PI * 2;
      centre.set(Math.cos(a) * spread * rand(0.35, 0.8), y, Math.sin(a) * spread * rand(0.35, 0.8));
    } else {
      const a = rng() * Math.PI * 2;
      const up = rand(-0.55, 1);
      const shell = rand(0.55, 0.95);
      const flat = Math.sqrt(1 - up * up);
      centre.set(
        crownCentre.x + Math.cos(a) * flat * style.crownRadius[0] * shell,
        crownCentre.y + up * style.crownRadius[1] * shell,
        crownCentre.z + Math.sin(a) * flat * style.crownRadius[0] * shell,
      );
    }
    clusters.push({ centre, radius: rand(style.clusterRadius[0], style.clusterRadius[1]) });
  }

  // Trunk and branches.
  const top = new THREE.Vector3(crownCentre.x * 0.8, style.trunkTop, crownCentre.z * 0.8);
  const bend = new THREE.Vector3(rand(-1, 1) * style.lean * 0.35, style.trunkTop * 0.45, rand(-1, 1) * style.lean * 0.35);
  const pieces: THREE.BufferGeometry[] = [
    taperedTube([new THREE.Vector3(0, -0.25, 0), bend, top], style.trunkRadius, style.trunkRadius * 0.55, 0.9),
  ];
  const sorted = [...clusters].sort((a, b) => b.centre.y - a.centre.y);
  for (let i = 0; i < style.branches; i++) {
    const target = sorted[Math.floor((i / style.branches) * sorted.length)]!.centre;
    const start = top.clone().lerp(bend, rand(0, 0.35));
    const mid = start.clone().lerp(target, 0.5);
    mid.y += rand(0.1, 0.4);
    pieces.push(
      taperedTube([start, mid, target.clone().lerp(start, 0.15)], style.trunkRadius * 0.5, style.trunkRadius * 0.12, 0, 5, 5),
    );
  }
  // A conifer's trunk runs right through its crown.
  const trunk = mergeGeometries(pieces)!;
  for (const piece of pieces) piece.dispose();

  // Cards.
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const centre = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const axisA = new THREE.Vector3();
  const axisB = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const lowest = style.conical ? 1.2 : crownCentre.y - style.crownRadius[1];
  const highest = style.conical ? 5.1 : crownCentre.y + style.crownRadius[1];

  for (const cluster of clusters) {
    for (let k = 0; k < style.cardsPerCluster; k++) {
      // Spread through the cluster, flattened a little so clumps read as
      // layered sprays rather than balls.
      centre.set(rand(-1, 1), rand(-0.6, 0.6), rand(-1, 1)).multiplyScalar(cluster.radius * 0.7).add(cluster.centre);

      // Lit as a point on the crown: outward from its heart (or its axis,
      // for a conifer), with a little of the cluster's own roundness.
      const heart = style.conical ? new THREE.Vector3(0, centre.y - 0.6, 0) : crownCentre;
      normal.subVectors(centre, heart).normalize();
      const local = centre.clone().sub(cluster.centre).normalize();
      normal.multiplyScalar(0.75).addScaledVector(local, 0.25).normalize();

      // Random card orientation, but never edge-on to the sky.
      facing.set(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize();
      axisA.set(0, 1, 0).cross(facing);
      if (axisA.lengthSq() < 1e-4) axisA.set(1, 0, 0);
      axisA.normalize();
      axisB.crossVectors(facing, axisA).normalize();
      const spin = rng() * Math.PI * 2;
      const ca = Math.cos(spin);
      const sa = Math.sin(spin);
      const size = rand(style.cardSize[0], style.cardSize[1]) * 0.5;

      // Self-shadowing: darker inside and underneath.
      const depth = centre.distanceTo(heart) / Math.max(style.crownRadius[0], style.crownRadius[1]);
      const height = (centre.y - lowest) / Math.max(0.1, highest - lowest);
      const shade = THREE.MathUtils.clamp(0.42 + depth * 0.35 + height * 0.35, 0.4, 1.08);

      const start = positions.length / 3;
      const corners: Array<[number, number, number, number]> = [
        [-1, -1, 0, 0],
        [1, -1, 1, 0],
        [1, 1, 1, 1],
        [-1, 1, 0, 1],
      ];
      for (const [x, y, u, v] of corners) {
        const rx = x * ca - y * sa;
        const ry = x * sa + y * ca;
        corner.copy(centre).addScaledVector(axisA, rx * size).addScaledVector(axisB, ry * size);
        positions.push(corner.x, corner.y, corner.z);
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(u, v);
        colours.push(shade, shade, shade);
      }
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }

  const foliage = new THREE.BufferGeometry();
  foliage.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  foliage.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  foliage.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  foliage.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  foliage.setIndex(indices);
  foliage.computeBoundingSphere();
  trunk.computeBoundingSphere();
  return { trunk, foliage };
}

// ── materials ─────────────────────────────────────────────────────────────

/** Shared by every crown: the wind clock. */
const treeUniforms = { uTreeTime: { value: 0 } };

/** Advance the wind. Once a frame. */
export function updateTrees(dt: number): void {
  treeUniforms.uTreeTime.value += dt;
}

const foliageMaterials = new Map<string, THREE.MeshToonMaterial>();

function foliageMaterial(style: SpeciesStyle, tier: QualityTier): THREE.MeshToonMaterial {
  const key = `${style.leaf}:${tier}`;
  const cached = foliageMaterials.get(key);
  if (cached) return cached;

  const material = new THREE.MeshToonMaterial({
    map: leafTexture(style.leaf),
    vertexColors: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    gradientMap: toonGradient(),
  });
  material.name = `foliage_${style.leaf}`;

  material.onBeforeCompile = (shader) => {
    applyAtmosphere(shader);
    Object.assign(shader.uniforms, treeUniforms, {
      uLeafSunDir: atmosphereUniforms.atmoSunDir,
      uLeafSunColour: atmosphereUniforms.atmoSunColour,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTreeTime;\nvarying vec3 vLeafWorld;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          // Sway grows with height above the trunk's fork; each tree has its
          // own phase from where it stands.
          float lift = max(position.y - 1.6, 0.0);
          #ifdef USE_INSTANCING
            vec3 root = vec3(instanceMatrix[3]);
          #else
            vec3 root = vec3(0.0);
          #endif
          float phase = dot(root, vec3(0.13, 0.17, 0.11));
          float gust = sin(uTreeTime * 0.45 + phase * 0.5) * 0.5 + 0.5;
          transformed.x += sin(uTreeTime * 1.2 + phase + position.y * 0.5) * 0.035 * lift * (0.5 + gust);
          transformed.z += sin(uTreeTime * 1.0 + phase * 1.3 + position.x * 0.7) * 0.03 * lift * (0.5 + gust);
          // Each card flutters on its own.
          transformed += normal * sin(uTreeTime * 3.3 + position.x * 4.1 + position.z * 3.7) * 0.025 * lift;
        }`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vLeafWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vLeafWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uLeafSunDir;\nuniform vec3 uLeafSunColour;\nvarying vec3 vLeafWorld;',
      )
      .replace(
        '#include <alphatest_fragment>',
        `#ifdef USE_MAP
        {
          // Mip levels average the gaps into the leaves, so a distant crown
          // thins to nothing; push alpha back up by how far down the chain
          // this pixel samples.
          vec2 texel = vMapUv * 256.0;
          vec2 tdx = dFdx(texel);
          vec2 tdy = dFdy(texel);
          float mip = max(0.0, 0.5 * log2(max(dot(tdx, tdx), dot(tdy, tdy))));
          diffuseColor.a *= 1.0 + mip * 0.3;
        }
        #endif
        #include <alphatest_fragment>`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        // Both faces of a card are the same point on the crown.
        normal = normalize(vNormal);`,
      )
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${NO_INK}`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 toEye = normalize(cameraPosition - vLeafWorld);
          float back = pow(max(dot(-toEye, uLeafSunDir), 0.0), 4.0);
          reflectedLight.directDiffuse += uLeafSunColour * diffuseColor.rgb * back * 0.9;
        }`,
      );
  };

  foliageMaterials.set(key, material);
  return material;
}

// ── planting ──────────────────────────────────────────────────────────────

const templates = new Map<string, Template>();
function template(species: TreeSpecies, variant: number): Template {
  const key = `${species}:${variant}`;
  let built = templates.get(key);
  if (!built) {
    built = buildTemplate(STYLES[species], species.length * 1009 + variant * 7907);
    templates.set(key, built);
  }
  return built;
}

const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tanA = new THREE.Vector3();
const _tanB = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _sink = new THREE.Vector3();
const _tint = new THREE.Color();
const _tintB = new THREE.Color();

/**
 * Plant a species at the given surface points. Returns the meshes: trunks
 * (tagged `userData.trunk`, which should block the camera) and crowns (which
 * should not — a camera that bumps off leaves is a camera that twitches).
 */
export function plantTrees(
  species: TreeSpecies,
  positions: THREE.Vector3[],
  height: number,
  seed: number,
  tier: QualityTier,
): THREE.InstancedMesh[] {
  if (positions.length === 0) return [];
  const style = STYLES[species];
  const rng = makeRng(seed);
  const variants = 3;
  const groups: THREE.Vector3[][] = Array.from({ length: variants }, () => []);
  positions.forEach((p, i) => groups[i % variants]!.push(p));

  const barkMaterial = createWorldMaterial({ color: style.bark });
  const leaves = foliageMaterial(style, tier);
  const meshes: THREE.InstancedMesh[] = [];

  groups.forEach((spots, variant) => {
    if (spots.length === 0) return;
    const { trunk, foliage } = template(species, variant);
    const trunks = new THREE.InstancedMesh(trunk, barkMaterial, spots.length);
    const crowns = new THREE.InstancedMesh(foliage, leaves, spots.length);
    trunks.name = `${species}_trunk`;
    crowns.name = `${species}_crown`;
    trunks.userData.trunk = true;

    spots.forEach((position, i) => {
      _up.copy(position).normalize();
      _tanA.set(0, 1, 0).projectOnPlane(_up);
      if (_tanA.lengthSq() < 1e-6) _tanA.set(1, 0, 0).projectOnPlane(_up);
      _tanA.normalize().applyAxisAngle(_up, rng() * Math.PI * 2);
      _tanB.crossVectors(_tanA, _up).normalize();
      _quat.setFromRotationMatrix(_basis.makeBasis(_tanA, _up, _tanB));
      const s = (height / NOMINAL_HEIGHT) * (0.82 + rng() * 0.36);
      _scale.setScalar(s);
      // Planted, not perched: on a slope one side of the root would float.
      _sink.copy(position).addScaledVector(_up, -0.12);
      _matrix.compose(_sink, _quat, _scale);
      trunks.setMatrixAt(i, _matrix);
      crowns.setMatrixAt(i, _matrix);

      _tint.set(style.tints[0]).lerp(_tintB.set(style.tints[1]), rng());
      _tint.multiplyScalar(0.9 + rng() * 0.18);
      crowns.setColorAt(i, _tint);
    });

    for (const mesh of [trunks, crowns]) {
      mesh.instanceMatrix.needsUpdate = true;
      // Instances span the planet; see the note in instancedProp.
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Static: only the copies over the horizon are drawn (HorizonInstances).
      mesh.userData.horizonCull = true;
    }
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    meshes.push(trunks, crowns);
  });

  return meshes;
}
