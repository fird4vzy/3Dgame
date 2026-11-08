import * as THREE from 'three';

/**
 * Re-dress the VRoid model as the courier on her character sheet.
 *
 * The model already has the sheet's long dark hair, glasses and white
 * sneakers; what differs is the outfit — a navy sleeveless top and dark
 * jeans, where the sheet has a white shirt with lavender pinstripes and light
 * jeans. Both are repainted at load from the model's own textures, which
 * keeps every seam, pocket and fold the artist drew and only changes the
 * cloth. The geometry is untouched: the top stays sleeveless.
 *
 * Colours are the sheet's, picked off the drawing: shirt `#f4f3f7`, stripes
 * `#9e8ed4`, denim `#a7c2e2`.
 */

/** A VRM's MToon material, as far as this module needs it. */
type ClothMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  shadeMultiplyTexture?: THREE.Texture | null;
  shadeColorFactor?: THREE.Color;
};

const SHIRT = [244, 243, 247] as const;
const STRIPE = [158, 142, 212] as const;
const DENIM = [167, 194, 226] as const;
/** The jeans' shadow tone. VRoid's default is a warm pink, which reads as a stain on pale blue. */
const DENIM_SHADE = new THREE.Color('#c6d2ea');

/** Repaint the top and the jeans of a VRoid model. Safe to call where there is no DOM. */
export function dressFromSheet(root: THREE.Object3D): void {
  if (typeof document === 'undefined') return;
  const painted = new Map<THREE.Texture, THREE.Texture | null>();

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const cloth = material as ClothMaterial;
      const paint = /_Tops_/.test(material.name) ? stripedShirt : /_Bottoms_/.test(material.name) ? lightDenim : null;
      if (!paint) continue;
      if (paint === lightDenim) cloth.shadeColorFactor?.copy(DENIM_SHADE);
      for (const slot of ['map', 'shadeMultiplyTexture'] as const) {
        const source = cloth[slot];
        if (!source) continue;
        if (!painted.has(source)) painted.set(source, repaint(source, paint));
        const replacement = painted.get(source);
        if (replacement) cloth[slot] = replacement;
      }
    }
  });
}

type Painter = (pixels: Uint8ClampedArray, width: number, height: number) => void;

/**
 * Largest side of a repainted texture. On screen she is a few hundred pixels
 * tall; the model's 2048² top is four times the memory for nothing visible.
 */
const MAX_SIZE = 1024;

function repaint(source: THREE.Texture, paint: Painter): THREE.Texture | null {
  const image = source.image as (CanvasImageSource & { width?: number; height?: number }) | null;
  const sourceWidth = image?.width ?? 0;
  const sourceHeight = image?.height ?? 0;
  if (!image || sourceWidth === 0 || sourceHeight === 0) return null;
  const fit = Math.min(1, MAX_SIZE / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * fit);
  const height = Math.round(sourceHeight * fit);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  paint(pixels, width, height);

  // A data texture, not a canvas one: a canvas stores premultiplied colour
  // and loses the RGB under every fully transparent texel. Those are what the
  // mip chain averages into the edges of a cut-out, and black there drew a
  // dark rim round the hem and armholes at any distance.
  const texture = new THREE.DataTexture(new Uint8Array(pixels.buffer), width, height, THREE.RGBAFormat);
  texture.name = `${source.name || 'cloth'}_sheet`;
  texture.flipY = source.flipY;
  texture.colorSpace = source.colorSpace;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.max(source.anisotropy, 4);
  texture.channel = source.channel;
  texture.needsUpdate = true;
  return texture;
}

const luminance = (p: Uint8ClampedArray, i: number): number => 0.2126 * p[i]! + 0.7152 * p[i + 1]! + 0.0722 * p[i + 2]!;

/** Mean luminance of the pixels `include` accepts. */
function meanLuminance(pixels: Uint8ClampedArray, include: (i: number) => boolean): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (!include(i)) continue;
    sum += luminance(pixels, i);
    count++;
  }
  return count > 0 ? sum / count : 1;
}

/**
 * White cotton with lavender pinstripes.
 *
 * The cloth's own shading is kept as a gentle multiplier (folds under the
 * arms stay folds), and the stripes run straight down the texture, which
 * on this layout is straight down the body. About two centimetres apart on
 * her, a little bolder than the sheet's pinstripe: from where the camera
 * sits, finer stripes average out to plain white, and under golden-hour
 * light plain white is the colour of her skin — from behind she read as
 * shirtless. A fifth of the cloth in lavender keeps it a cool white.
 */
export const stripedShirt: Painter = (pixels, width) => {
  const mean = meanLuminance(pixels, (i) => pixels[i + 3]! > 128);
  const period = Math.max(8, Math.round(width / 40));
  const half = Math.max(1.2, period * 0.1);
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) {
      // Cut away, but bled the shirt's colour, so mips fade the edge to white.
      pixels[i] = SHIRT[0];
      pixels[i + 1] = SHIRT[1];
      pixels[i + 2] = SHIRT[2];
      continue;
    }
    const shade = THREE.MathUtils.clamp(1 - (1 - luminance(pixels, i) / mean) * 0.55, 0.72, 1.04);
    const x = (i / 4) % width;
    // Coverage by the stripe whose centre line runs mid-period, antialiased
    // over one pixel.
    const distance = Math.abs(((x + 0.5) % period) - period / 2);
    const stripe = THREE.MathUtils.clamp(half + 0.5 - distance, 0, 1) * 0.9;
    for (let c = 0; c < 3; c++) {
      pixels[i + c] = (SHIRT[c]! + (STRIPE[c]! - SHIRT[c]!) * stripe) * shade;
    }
  }
};

/**
 * Light-wash denim.
 *
 * Everything is repainted except the trims — gold stitching, rivets, the
 * leather patch, the red tab — which keep their colours, as on real jeans.
 * The weave, fades and seams come through as variation in brightness around
 * the new colour, so a dark seam stays a seam rather than a black line.
 */
export const lightDenim: Painter = (pixels) => {
  const trim = (i: number): boolean => {
    const r = pixels[i]!;
    return r > pixels[i + 2]! + 18 && r - Math.min(pixels[i + 1]!, pixels[i + 2]!) > 24;
  };
  const mean = meanLuminance(pixels, (i) => !trim(i));
  for (let i = 0; i < pixels.length; i += 4) {
    if (trim(i)) continue;
    const shade = THREE.MathUtils.clamp(0.58 + 0.42 * (luminance(pixels, i) / mean), 0.5, 1.18);
    for (let c = 0; c < 3; c++) pixels[i + c] = DENIM[c]! * shade;
  }
};
