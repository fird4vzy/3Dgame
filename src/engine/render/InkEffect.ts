import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

/**
 * The drawing: an ink line round every shape, on paper.
 *
 * **The line** comes from the depth buffer alone — no second render of the
 * scene with normals, which would double the draw calls for a few strokes. A
 * perspective depth buffer is *linear across a flat surface in screen space*,
 * so its second difference (left + right − 2 × centre, and the same up and
 * down) is zero anywhere on a wall or a floor, however steeply it is seen, and
 * non-zero exactly where surfaces meet or one stops in front of another:
 * silhouettes and creases. Dividing by the distance from the far plane makes
 * the test relative, so a roof edge reads the same at three metres and thirty.
 *
 * The line is drawn at the screen's resolution whatever size the textures
 * underneath are, which is most of why the houses stopped looking blurred: a
 * soft picture inside a crisp contour reads as painted, not as out of focus.
 * It thins with distance, as a pen line does when the artist means "far".
 *
 * Not everything is outlined. Grass and leaves are thousands of slivers a
 * pixel or two wide, and a contour round each is a scribble that crawls. They
 * mark themselves by writing zero into the frame's alpha ({@link NO_INK}),
 * and the line is withheld on and beside them.
 *
 * **The paper** is a grain and a faint fibre, multiplied over everything
 * including the sky — a few per cent, there to be felt rather than seen.
 *
 * **The sharpening** undoes the softness of a frame drawn below the screen's
 * own resolution and stretched to fit it: a small unsharp mask from the four
 * neighbours, held back where it would ring.
 */
/**
 * GLSL to append to a material's fragment shader so the ink leaves it alone.
 * Only for opaque materials: alpha is otherwise unused in the frame.
 */
export const NO_INK = /* glsl */ `gl_FragColor.a = 0.0;`;

const fragmentShader = /* glsl */ `
uniform vec3 inkColour;
uniform float inkStrength;
uniform float inkWidth;
uniform float paper;
uniform float sharpness;

float inkHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 colour = inputColor.rgb;
  vec2 px = texelSize;

  vec4 n4 = texture2D(inputBuffer, uv + vec2(0.0, px.y));
  vec4 s4 = texture2D(inputBuffer, uv - vec2(0.0, px.y));
  vec4 e4 = texture2D(inputBuffer, uv + vec2(px.x, 0.0));
  vec4 w4 = texture2D(inputBuffer, uv - vec2(px.x, 0.0));
  // Zero on or beside anything that asked not to be outlined.
  float inkable = min(inputColor.a, min(min(n4.a, s4.a), min(e4.a, w4.a)));

  // ── sharpen ──
  if (sharpness > 0.0) {
    vec3 n = n4.rgb;
    vec3 s = s4.rgb;
    vec3 e = e4.rgb;
    vec3 w = w4.rgb;
    vec3 blur = (n + s + e + w) * 0.25;
    vec3 detail = colour - blur;
    // Never past the brightest or darkest neighbour: no halos.
    vec3 lo = min(colour, min(min(n, s), min(e, w)));
    vec3 hi = max(colour, max(max(n, s), max(e, w)));
    colour = clamp(colour + detail * sharpness, lo, hi);
  }

  // ── ink ──
  if (inkStrength > 0.0 && inkable > 0.5 && depth < 0.99999) {
    vec2 o = px * inkWidth;
    float dl = readDepth(uv - vec2(o.x, 0.0));
    float dr = readDepth(uv + vec2(o.x, 0.0));
    float dd = readDepth(uv - vec2(0.0, o.y));
    float du = readDepth(uv + vec2(0.0, o.y));

    float away = max(1.0 - depth, 1e-6);
    float bend = (abs(dl + dr - 2.0 * depth) + abs(dd + du - 2.0 * depth)) / away;
    float line = smoothstep(0.012, 0.045, bend);

    // Thinner and paler with distance; nothing at all at the horizon, where
    // it would only outline the haze.
    float metres = -getViewZ(depth);
    float nearness = 1.0 - smoothstep(14.0, 70.0, metres);
    line *= mix(0.25, 1.0, nearness);

    colour = mix(colour, inkColour, line * inkStrength);
  }

  // ── paper ──
  if (paper > 0.0) {
    vec2 cell = uv / px;
    float grain = inkHash(floor(cell)) - 0.5;
    float fibre = inkHash(vec2(floor(cell.x * 0.23), floor(cell.y * 0.031))) - 0.5;
    colour *= 1.0 + (grain * 0.045 + fibre * 0.022) * paper;
  }

  outputColor = vec4(colour, 1.0);
}
`;

export interface InkOptions {
  colour?: THREE.ColorRepresentation;
  /** 0..1, how dark the line is drawn. */
  strength?: number;
  /** Half the line's width, in render pixels. */
  width?: number;
  /** 0..1, how much the paper shows. */
  paper?: number;
  /** 0 is off; 0.6 is about right for a frame stretched by half again. */
  sharpness?: number;
}

export class InkEffect extends Effect {
  constructor(options: InkOptions = {}) {
    super('InkEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['inkColour', new THREE.Uniform(new THREE.Color(options.colour ?? '#2b2238'))],
        ['inkStrength', new THREE.Uniform(options.strength ?? 0.75)],
        ['inkWidth', new THREE.Uniform(options.width ?? 1)],
        ['paper', new THREE.Uniform(options.paper ?? 1)],
        ['sharpness', new THREE.Uniform(options.sharpness ?? 0.5)],
      ]),
    });
  }

  set strength(value: number) {
    this.uniforms.get('inkStrength')!.value = value;
  }

  set sharpness(value: number) {
    this.uniforms.get('sharpness')!.value = value;
  }
}
