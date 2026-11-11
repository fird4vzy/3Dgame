import * as THREE from 'three';

/**
 * The material everything in the world is drawn with.
 *
 * Cel-shaded: the game is drawn as an animation background is painted — a lit
 * tone and a shadow tone with a clean edge between them, an ink line round the
 * shapes (see `InkEffect`), and colour that comes through as it was chosen.
 * The look had drifted to physically based shading under a sky-lit
 * environment, which is a fine way to make a valley look real and the wrong
 * way to make it look drawn: every gradient it adds is one the brush would
 * have left out, and a 512-pixel texture under smooth light reads as blur
 * where the same texture under two flat tones reads as paint.
 *
 * It is also far cheaper. A toon fragment evaluates a ramp lookup per light;
 * a physical one evaluates a microfacet lobe per light and two filtered
 * environment lookups, and on integrated graphics that difference was most of
 * the frame.
 *
 * The shadow tone is not black: the ramp only scales *direct* light, and the
 * hemisphere light — sky above, ground bounce below — fills what it leaves,
 * which is what puts blue in the shade.
 */

export interface WorldMaterialOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  /** Kept for the few physically shaded surfaces (water); ignored by cel shading. */
  roughness?: number;
  metalness?: number;
  side?: THREE.Side;
  map?: THREE.Texture | null;
  alphaTest?: number;
}

/**
 * How much direct light a surface takes, by how squarely it faces the light:
 * none turned away, a half-tone at a glancing angle, full beyond it. The two
 * steps are a few texels wide and filtered, so the terminator is a crisp line
 * that does not crawl.
 */
const RAMP: ReadonlyArray<readonly [facing: number, light: number]> = [
  [-1.0, 0.0],
  [-0.02, 0.0],
  [0.04, 0.5],
  [0.3, 0.5],
  [0.36, 1.0],
  [1.0, 1.0],
];

/** The ramp's value for a surface whose normal makes `facing` = N·L with the light. */
export function toonRamp(facing: number): number {
  for (let i = 1; i < RAMP.length; i++) {
    const [x1, y1] = RAMP[i]!;
    if (facing <= x1) {
      const [x0, y0] = RAMP[i - 1]!;
      return y0 + ((y1 - y0) * (facing - x0)) / Math.max(1e-6, x1 - x0);
    }
  }
  return 1;
}

let ramp: THREE.DataTexture | null = null;

/** The shared ramp texture. three samples it at `N·L * 0.5 + 0.5`. */
export function toonGradient(): THREE.DataTexture {
  if (ramp) return ramp;
  const size = 128;
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const value = Math.round(toonRamp(((i + 0.5) / size) * 2 - 1) * 255);
    data.set([value, value, value, 255], i * 4);
  }
  ramp = new THREE.DataTexture(data, size, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.LinearFilter;
  ramp.magFilter = THREE.LinearFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

/** A cel-shaded world material. */
export function createWorldMaterial(options: WorldMaterialOptions = {}): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({
    color: options.color ?? 0xffffff,
    vertexColors: options.vertexColors ?? false,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
    gradientMap: toonGradient(),
    map: options.map ?? null,
    alphaTest: options.alphaTest ?? 0,
  });

  if (options.emissive !== undefined) {
    material.emissive = new THREE.Color(options.emissive);
    material.emissiveIntensity = options.emissiveIntensity ?? 1;
  }
  return material;
}

/**
 * A physically shaded material, for the one kind of surface that is mostly
 * reflection: water. Everything else should use {@link createWorldMaterial}.
 */
export function createPhysicalMaterial(options: WorldMaterialOptions = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: options.color ?? 0xffffff,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    roughness: options.roughness ?? 0.88,
    metalness: options.metalness ?? 0,
    side: options.side ?? THREE.FrontSide,
  });
}
