import * as THREE from 'three';
import { BlendFunction, Effect } from 'postprocessing';

/**
 * The final colour grade.
 *
 * Tone mapping decides how light becomes a picture; this decides the
 * picture's *mood*. Three moves, each small, all standard in film grading:
 *
 * - **Lifted, tinted blacks.** Real air and real lenses never deliver true
 *   black; a shadow full of warm haze is most of what makes a frame feel like
 *   an afternoon rather than a render.
 * - **Gentle S-curve contrast**, applied in a perceptual (square-root) space
 *   so it bites on mid-tones rather than crushing shadows.
 * - **Saturation** a touch either side of neutral.
 *
 * Runs after tone mapping, on display-range values.
 */
const fragmentShader = /* glsl */ `
uniform vec3 lift;
uniform vec3 gain;
uniform float contrast;
uniform float saturation;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0);

  vec3 p = sqrt(c);
  p = clamp((p - 0.5) * contrast + 0.5, 0.0, 1.0);
  c = p * p;

  c = c * gain + lift * (1.0 - c);

  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, saturation);

  outputColor = vec4(max(c, 0.0), inputColor.a);
}
`;

export interface GradeOptions {
  lift?: THREE.Color;
  gain?: THREE.Color;
  contrast?: number;
  saturation?: number;
}

export class GradeEffect extends Effect {
  constructor(options: GradeOptions = {}) {
    super('GradeEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['lift', new THREE.Uniform(options.lift ?? new THREE.Color(0.018, 0.014, 0.01))],
        ['gain', new THREE.Uniform(options.gain ?? new THREE.Color(1.0, 0.985, 0.95))],
        ['contrast', new THREE.Uniform(options.contrast ?? 1.06)],
        ['saturation', new THREE.Uniform(options.saturation ?? 1.06)],
      ]),
    });
  }
}
