import * as THREE from 'three';

/**
 * Dress the VRoid model in the courier's clothes.
 *
 * The model already has her long dark hair, glasses and white sneakers. What
 * it wore was a navy sleeveless top and dark jeans; she likes burgundy and
 * brown, so the top becomes a burgundy knit and the jeans brown wide-leg
 * trousers. Both are repainted at load from the model's own textures, which
 * keeps every seam, pocket and fold the artist drew and only changes the
 * cloth. The geometry is untouched: the top stays sleeveless.
 *
 * (The first dressing was the character sheet's white shirt with lavender
 * stripes and light jeans, docs/27. Its lessons hold for any colour: bleed
 * the cloth under cut-away texels, keep the trims, and check the top still
 * reads as cloth against her skin from behind in golden light.)
 */

type RGB = readonly [number, number, number];

/** Her clothes, in sRGB. */
export const OUTFIT = {
  /** Burgundy knit top. */
  top: [88, 22, 36] as RGB,
  /** Brown wide-leg trousers. */
  trousers: [100, 78, 62] as RGB,
  /** The trousers' shadow tone. VRoid's default is a cool pink, which reads as a stain on brown. */
  trousersShade: new THREE.Color('#cdc3bd'),
};

/** A VRM's MToon material, as far as this module needs it. */
type ClothMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  shadeMultiplyTexture?: THREE.Texture | null;
  shadeColorFactor?: THREE.Color;
};

/** Repaint the top and the trousers of a VRoid model. Safe to call where there is no DOM. */
export function dressAria(root: THREE.Object3D): void {
  if (typeof document === 'undefined') return;
  const painted = new Map<THREE.Texture, THREE.Texture | null>();
  const top = knit(OUTFIT.top);
  const trousers = cloth(OUTFIT.trousers);

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const garment = material as ClothMaterial;
      const paint = /_Tops_/.test(material.name) ? top : /_Bottoms_/.test(material.name) ? trousers : null;
      if (!paint) continue;
      if (paint === trousers) garment.shadeColorFactor?.copy(OUTFIT.trousersShade);
      for (const slot of ['map', 'shadeMultiplyTexture'] as const) {
        const source = garment[slot];
        if (!source) continue;
        if (!painted.has(source)) painted.set(source, repaint(source, paint));
        const replacement = painted.get(source);
        if (replacement) garment[slot] = replacement;
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
  texture.name = `${source.name || 'cloth'}_dressed`;
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
 * A ribbed knit in `colour`.
 *
 * The cloth's own shading is kept as a multiplier (folds under the arms stay
 * folds) and fine ribs run straight down the texture, which on this layout
 * is straight down the body, about 8 mm apart on her: from where the camera
 * sits they melt into the colour, close up they make it read as knitwear
 * rather than plastic.
 */
export function knit(colour: RGB): Painter {
  return (pixels, width) => {
    const mean = meanLuminance(pixels, (i) => pixels[i + 3]! > 128);
    const period = Math.max(4, Math.round(width / 96));
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) {
        // Cut away, but bled the cloth's colour, so mips fade the edge to it.
        pixels[i] = colour[0];
        pixels[i + 1] = colour[1];
        pixels[i + 2] = colour[2];
        continue;
      }
      const shade = THREE.MathUtils.clamp(1 - (1 - luminance(pixels, i) / mean) * 0.6, 0.7, 1.08);
      const x = (i / 4) % width;
      const rib = 0.5 + 0.5 * Math.cos(((x + 0.5) / period) * Math.PI * 2);
      const tone = shade * (1 - 0.16 * rib);
      for (let c = 0; c < 3; c++) pixels[i + c] = colour[c]! * tone;
    }
  };
}

/**
 * Woven cloth in `colour`, from the jeans' texture.
 *
 * Everything is repainted except the trims — gold stitching, rivets, the
 * leather patch, the red tab — which keep their colours, as they would on
 * real trousers. The weave, fades and seams come through as variation in
 * brightness around the new colour, so a seam stays a seam.
 */
export function cloth(colour: RGB): Painter {
  return (pixels) => {
    const trim = (i: number): boolean => {
      const r = pixels[i]!;
      return r > pixels[i + 2]! + 18 && r - Math.min(pixels[i + 1]!, pixels[i + 2]!) > 24;
    };
    const mean = meanLuminance(pixels, (i) => !trim(i));
    for (let i = 0; i < pixels.length; i += 4) {
      if (trim(i)) continue;
      const shade = THREE.MathUtils.clamp(0.55 + 0.45 * (luminance(pixels, i) / mean), 0.45, 1.2);
      for (let c = 0; c < 3; c++) pixels[i + c] = colour[c]! * shade;
    }
  };
}
