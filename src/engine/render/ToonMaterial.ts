import * as THREE from 'three';

/**
 * Cel-shaded material.
 *
 * Built on `MeshToonMaterial` with a generated gradient map rather than a
 * hand-written shader: three-band toon lighting is exactly what
 * `MeshToonMaterial` does, and going through the standard material keeps
 * shadows, fog and instancing working for free. A custom `ShaderMaterial` would
 * mean reimplementing all three.
 *
 * The gradient map is the whole trick — a tiny 1-D texture with hard steps,
 * sampled by N·L, which is what turns smooth lighting into bands.
 */

const gradientCache = new Map<number, THREE.DataTexture>();

/** A 1-D ramp with `bands` hard steps, cached per band count. */
export function toonGradient(bands = 3): THREE.DataTexture {
  const cached = gradientCache.get(bands);
  if (cached) return cached;

  const data = new Uint8Array(bands);
  for (let i = 0; i < bands; i++) {
    // Keep the darkest band well above black: on a dusk planet, unlit faces
    // still have to read as material rather than as holes.
    //
    // The range is deliberately *narrow* — 0.58 to 1.0 rather than 0.35 to 1.0.
    // Flat-colour art is flat because the shadow is a small step away from the
    // light, not because there are few steps: spread the same three bands over
    // twice the tonal range and the eye reads a gradient with banding artefacts
    // instead of a drawn shadow. Narrowing it is most of what separates "cel
    // shading" from a picture that looks painted.
    const level = 0.58 + (i / Math.max(1, bands - 1)) * 0.42;
    data[i] = Math.round(level * 255);
  }

  const texture = new THREE.DataTexture(data, bands, 1, THREE.RedFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  gradientCache.set(bands, texture);
  return texture;
}

export interface ToonOptions {
  color?: THREE.ColorRepresentation;
  bands?: number;
  vertexColors?: boolean;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  flatShading?: boolean;
}

export function createToonMaterial(options: ToonOptions = {}): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({
    color: options.color ?? 0xffffff,
    gradientMap: toonGradient(options.bands ?? 3),
    vertexColors: options.vertexColors ?? false,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
  });

  if (options.emissive !== undefined) {
    material.emissive = new THREE.Color(options.emissive);
    material.emissiveIntensity = options.emissiveIntensity ?? 1;
  }
  return material;
}

/**
 * Inverted-hull outline.
 *
 * A back-faced copy of the mesh, pushed out along its normals. Cheaper than a
 * full-screen depth/normal edge pass and — more importantly — art-directable
 * per object: hero props get an outline, scatter geometry does not, which is
 * the choice a screen-space pass takes away from you.
 *
 * Requires the source geometry to have sane normals; on flat-shaded terrain it
 * produces gaps, so it is meant for props and characters only.
 */
export function createOutline(
  source: THREE.Mesh,
  thickness = 0.03,
  colour: THREE.ColorRepresentation = 0x0d1018,
): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    color: colour,
    side: THREE.BackSide,
  });

  // Push vertices along their normals in the vertex shader so the hull scales
  // with distance correctly, rather than scaling the whole mesh (which breaks
  // on anything that is not roughly spherical).
  material.onBeforeCompile = (shader) => {
    shader.uniforms.outlineThickness = { value: thickness };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineThickness;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed += normalize(objectNormal) * outlineThickness;',
      );
  };

  const outline = new THREE.Mesh(source.geometry, material);
  outline.name = `${source.name}_outline`;
  outline.castShadow = false;
  outline.receiveShadow = false;
  return outline;
}
