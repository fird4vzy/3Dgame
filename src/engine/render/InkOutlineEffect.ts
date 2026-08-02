import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

/**
 * Ink outlines, from the depth buffer.
 *
 * The reference art direction is flat colour behind a hard black line, and the
 * line is not a detail — it is the single loudest thing about the style. Cel
 * shading without it reads as "soft 3D with banded lighting"; with it, the same
 * geometry reads as drawn.
 *
 * **Why depth rather than an inverted hull.** The usual trick is to draw every
 * mesh a second time, scaled along its normals, back faces only. That doubles
 * the draw calls, needs a second material per object, and fights instancing —
 * and this world is mostly `InstancedMesh`, so it would mean duplicating the
 * instance buffers too. Reading the depth buffer costs one texture fetch per
 * neighbour in a pass that already exists, is completely indifferent to how the
 * geometry got there, and lines every object in the scene including instanced
 * props for free.
 *
 * **Why the depth difference is scaled by view distance.** Raw depth deltas grow
 * with distance, so a fixed threshold draws a clean line up close and then
 * smears the whole horizon into a black band. Dividing by linear eye depth makes
 * the test scale-invariant: the line stays one pixel wide whether the cottage is
 * three metres away or thirty.
 *
 * A grazing surface — a floor stretching to the horizon — has a large depth
 * gradient everywhere and would outline solid. That is what the normal-facing
 * term is for: where the surface is nearly edge-on to the camera the threshold
 * is relaxed, so ground planes stay clean and silhouettes stay crisp.
 */
const fragment = /* glsl */ `
uniform vec3 uInk;
uniform float uThickness;
uniform float uThreshold;
uniform float uStrength;
uniform float uMaxDistance;

// Depth buffer value -> distance from the eye, in world units.
//
// readDepth hands back the *raw* non-linear buffer value. Rescaling that
// linearly between near and far - the orthographic formula - is wrong for a
// perspective camera and quietly ruins the whole effect: perspective depth is
// crushed towards the far plane, so beyond a few metres every neighbouring
// sample reads as very nearly the same number and no edge ever clears the
// threshold. getViewZ is the helper that branches on the camera type; view Z
// runs down the negative axis, hence the sign.
//
// (No backticks in here. This is a JS template literal, and one closes it.)
float linearDepth(const in vec2 uv) {
  return -getViewZ(readDepth(uv));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 texel = uThickness / resolution;

  float centre = linearDepth(uv);

  // Beyond a certain range the line is more noise than drawing, and the fog has
  // taken over anyway.
  if (centre >= uMaxDistance) {
    outputColor = inputColor;
    return;
  }

  // Four taps in a cross. A full Sobel is eight and looks no better at one
  // pixel wide — this is a silhouette line, not an edge-detection filter.
  float l = linearDepth(uv - vec2(texel.x, 0.0));
  float r = linearDepth(uv + vec2(texel.x, 0.0));
  float d = linearDepth(uv - vec2(0.0, texel.y));
  float u = linearDepth(uv + vec2(0.0, texel.y));

  // The larger of the two second derivatives. Using the *difference of
  // differences* rather than a plain gradient is what keeps a tilted-but-flat
  // surface from lining itself: a constant slope cancels here, a crease does
  // not.
  float dx = abs(l + r - 2.0 * centre);
  float dy = abs(u + d - 2.0 * centre);
  float edge = max(dx, dy);

  // Scale-invariance: near geometry and far geometry get the same line.
  edge /= max(centre, 0.001);

  float line = smoothstep(uThreshold, uThreshold * 3.0, edge) * uStrength;

  // Fade the line out as it approaches the cutoff, so it does not pop.
  line *= 1.0 - smoothstep(uMaxDistance * 0.7, uMaxDistance, centre);

  outputColor = vec4(mix(inputColor.rgb, uInk, clamp(line, 0.0, 1.0)), inputColor.a);
}
`;

export interface InkOutlineOptions {
  /** Line colour. Never pure black — see the default. */
  colour?: THREE.Color;
  /** Sampling radius in pixels. Above ~1.5 the line stops looking drawn. */
  thickness?: number;
  /** Depth curvature above which a line is drawn. Lower means more lines. */
  threshold?: number;
  /** How opaque the line is, 0..1. */
  strength?: number;
  /** Distance in world units past which lines stop being drawn. */
  maxDistance?: number;
}

export class InkOutlineEffect extends Effect {
  constructor(options: InkOutlineOptions = {}) {
    const {
      // A very dark blue-grey rather than #000. Pure black lines on a dusk
      // palette read as holes punched in the image; a hint of the sky's hue
      // keeps them sitting *in* the picture.
      colour = new THREE.Color('#131a26'),
      thickness = 1.4,
      // A ratio, not a distance: the depth curvature divided by view distance,
      // so it means the same thing at three metres and at thirty. Low enough
      // to catch creases as well as silhouettes, which is what makes the line
      // read as drawn rather than as a rim.
      threshold = 0.018,
      strength = 1.0,
      maxDistance = 90,
    } = options;

    super('InkOutlineEffect', fragment, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['uInk', new THREE.Uniform(colour)],
        ['uThickness', new THREE.Uniform(thickness)],
        ['uThreshold', new THREE.Uniform(threshold)],
        ['uStrength', new THREE.Uniform(strength)],
        ['uMaxDistance', new THREE.Uniform(maxDistance)],
      ]),
    });
  }

  private uniform(name: string): THREE.Uniform | undefined {
    return this.uniforms.get(name);
  }

  setStrength(value: number): void {
    const u = this.uniform('uStrength');
    if (u) u.value = value;
  }

  setThickness(value: number): void {
    const u = this.uniform('uThickness');
    if (u) u.value = value;
  }
}
