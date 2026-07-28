/**
 * Deterministic RNG and value noise.
 *
 * The world must regenerate identically from a seed: terrain, prop scatter and
 * collectible placement all depend on it, and so do reproducible bug reports.
 */

/** mulberry32 — small, fast, good enough distribution for content generation. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fract = (n: number) => n - Math.floor(n);

/** Deterministic hash of an integer lattice point to [0,1). */
function hash3(x: number, y: number, z: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 0.017) * 43758.5453123;
  return fract(n);
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Trilinear value noise over the integer lattice. Range roughly [0,1]. */
export function valueNoise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smoothstep(x - xi);
  const yf = smoothstep(y - yi);
  const zf = smoothstep(z - zi);

  const mix = (a: number, b: number, t: number) => a + (b - a) * t;

  const c000 = hash3(xi, yi, zi, seed);
  const c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed);
  const c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed);
  const c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed);
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed);

  const x00 = mix(c000, c100, xf);
  const x10 = mix(c010, c110, xf);
  const x01 = mix(c001, c101, xf);
  const x11 = mix(c011, c111, xf);

  return mix(mix(x00, x10, yf), mix(x01, x11, yf), zf);
}

/** Fractal Brownian motion — layered noise, range roughly [0,1]. */
export function fbm3(
  x: number,
  y: number,
  z: number,
  octaves = 4,
  lacunarity = 2.0,
  gain = 0.5,
  seed = 0,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise3(x * frequency, y * frequency, z * frequency, seed + i * 13);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
