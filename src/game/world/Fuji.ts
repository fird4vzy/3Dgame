/**
 * Mount Fuji, and the country it stands in — painted into the sky.
 *
 * The planet is sixty metres across, so nothing *on* it can be a distant
 * mountain, and nothing standing a few hundred metres off in the world can
 * either: a few dozen steps round a world this small is a large fraction of
 * the way there, and the mountain swings across the sky as you walk. Two
 * earlier versions tried, as geometry. The second one followed the camera,
 * which fixed the swinging and left three other things wrong:
 *
 * - **It sat below eye level.** Its summit was placed seven degrees above the
 *   planet's rim, and from head height on a sixty-metre ball the rim is
 *   thirteen degrees *down*. A mountain you look down on is a hill.
 * - **Nothing stood in front of it.** A cone rising straight out of haze has
 *   no scale. Distance is read from layers — a near ridge, a far ridge, mist
 *   between them, then the mountain — and there were none.
 * - **It was lit like an object**, by a dot product on a lathe, so it read as a
 *   grey cone rather than as a painted peak.
 *
 * A distant mountain has no parallax, so it does not need to be geometry at
 * all: it is part of the backdrop, drawn by the sky's own shader in the sky's
 * own frame (see `Environment` for why that frame never turns as you walk).
 * What lives here is the shape — as plain functions, so the silhouette can be
 * tested — and the GLSL that paints it.
 *
 * Coordinates are *gnomonic* about the mountain's bearing: `u` is the tangent
 * of the angle left or right of it and `v` the tangent of the elevation, which
 * is exactly how a real far-off mountain projects — a flat picture, standing
 * upright, a long way away.
 */

/** Tangent of the elevation of the summit: 12.5° above eye level. */
export const FUJI_PEAK = 0.222;
/** Tangent of the elevation of the foot, hidden behind the ridges: 4° below. */
export const FUJI_FOOT = -0.07;
/** Tangent of the half-angle the mountain spans at its foot: 27°. */
export const FUJI_HALF_WIDTH = 0.52;
/** Half-width of the summit plateau, as a fraction of the half-width. */
export const FUJI_CRATER = 0.075;
/**
 * How concave the flanks are. 1 is a straight cone; Fuji's sweep is well past
 * it — steep under the summit, running out long and shallow at the foot.
 */
export const FUJI_CONCAVITY = 1.5;
/** Where the Hōei shoulder sits on the right flank, and how far it stands out. */
export const FUJI_SHOULDER_AT = 0.36;
export const FUJI_SHOULDER = 0.035;

/**
 * Height of the silhouette at `u`, from 0 at the foot to 1 on the crater rim.
 * The same expression as the shader's `fujiRise`, without the rim's notches.
 */
export function fujiRise(u: number): number {
  const x = Math.min(1, Math.abs(u) / FUJI_HALF_WIDTH);
  const flank = Math.pow(Math.max(0, (1 - x) / (1 - FUJI_CRATER)), FUJI_CONCAVITY);
  const side = (u / FUJI_HALF_WIDTH - FUJI_SHOULDER_AT) / 0.07;
  const shoulder = FUJI_SHOULDER * Math.exp(-side * side) * (1 - x);
  return Math.min(1, flank + shoulder);
}

/** Tangent of the elevation of the skyline at `u`. */
export function fujiSkyline(u: number): number {
  return FUJI_FOOT + (FUJI_PEAK - FUJI_FOOT) * fujiRise(u);
}

/**
 * The backdrop below and beside the mountain, as GLSL: two ridgelines right
 * round the horizon, mist lying between them, and the lowland running down to
 * wherever the planet's own rim cuts it off.
 *
 * Expects `hash`, `noise` and `fbm3` from the sky shader, and its uniforms.
 */
export const FAR_COUNTRY_GLSL = /* glsl */ `
  // A ridgeline's height right round the horizon. Sampled on a circle so it
  // joins up with itself: an azimuth has a seam, a circle does not.
  float ridgeLine(vec2 around, float scale, float seed) {
    vec2 p = around * scale + seed;
    float broad = fbm3(p);
    float teeth = noise(p * 5.3 + seed * 2.0);
    return broad + (teeth - 0.5) * 0.16;
  }

  float fujiRise(float u) {
    float x = min(1.0, abs(u) / ${FUJI_HALF_WIDTH.toFixed(4)});
    float flank = pow(max(0.0, (1.0 - x) / ${(1 - FUJI_CRATER).toFixed(4)}), ${FUJI_CONCAVITY.toFixed(3)});
    float side = (u / ${FUJI_HALF_WIDTH.toFixed(4)} - ${FUJI_SHOULDER_AT.toFixed(3)}) / 0.07;
    float shoulder = ${FUJI_SHOULDER.toFixed(4)} * exp(-side * side) * (1.0 - x);
    return flank + shoulder;
  }

  // Everything further off than the planet. 'air' is the sky already painted
  // behind it, which is what distance fades the land toward.
  vec3 farCountry(vec3 dir, float h, vec3 behind, vec3 air) {
    vec3 colour = behind;
    vec2 around = normalize(vec2(dot(dir, uTanA), dot(dir, uTanB)) + 1e-5);
    float aa = fwidth(h) * 1.2 + 1e-4;
    float sunSide = dot(uSunDir, uFujiRight);

    // ── the mountain ────────────────────────────────────────────────────
    float front = dot(dir, uFujiDir);
    if (front > 0.15) {
      float u = dot(dir, uFujiRight) / front;
      float v = h / front;
      float span = ${(FUJI_PEAK - FUJI_FOOT).toFixed(4)};
      float rise = fujiRise(u);
      // The crater rim: a flat top, a little ragged, higher on the left.
      float rim = 1.0 + (noise(vec2(u * 90.0, 3.7)) - 0.5) * 0.022 - u * 0.11;
      float top = ${FUJI_FOOT.toFixed(4)} + span * min(rise, rim);
      float edge = fwidth(v) * 1.2 + 1e-4;
      float inside = smoothstep(-edge, edge, top - v);
      if (inside > 0.0) {
        float r = clamp((v - ${FUJI_FOOT.toFixed(4)}) / span, 0.0, 1.0);

        // Ravines run down the flanks, and the snow lies in them longest:
        // the hem of the cap is a row of fingers, not a line.
        float gully = noise(vec2(u * 150.0, 1.3));
        // Narrow tongues: a triangle wave, sharpened, so each one comes to a
        // point the way a snow-filled ravine does.
        float tongue = abs(fract(u * 23.0 + noise(vec2(u * 11.0, 4.4)) * 1.6) - 0.5) * 2.0;
        float reach = noise(vec2(u * 14.0, 9.1));
        float fingers = pow(1.0 - tongue, 3.0) * reach * reach * 1.6 + pow(noise(vec2(u * 64.0, 2.2)), 2.0) * 0.35;
        float hem = 0.52 - fingers * 0.13 - gully * 0.03 + abs(u) * 0.10;
        float snow = smoothstep(hem - 0.008, hem + 0.008, r);

        // Two tones, as a painter would lay them: the flank the sun reaches
        // and the flank it does not, with a ragged edge between them.
        float turn = -u / ${FUJI_HALF_WIDTH.toFixed(4)} * sign(sunSide + 1e-4);
        float lit = smoothstep(-0.03, 0.03, turn + 0.06 + (noise(vec2(u * 19.0, r * 5.0)) - 0.5) * 0.2);
        lit = mix(0.5, lit, clamp(abs(sunSide) * 2.2, 0.0, 1.0));

        vec3 rock = mix(uFujiRock * 0.72, uFujiRock * 1.12 + uSunColour * 0.035, lit);
        vec3 cap = mix(uFujiSnow * vec3(0.66, 0.74, 0.93), uFujiSnow + uSunColour * 0.05, lit);
        vec3 body = mix(rock, cap, snow);

        // The foot is lost in the air; the summit stands clear of it.
        float veil = uFarHaze * mix(0.16, 0.86, pow(1.0 - r, 2.2));
        body = mix(body, air, clamp(veil, 0.0, 0.96));
        colour = mix(colour, body, inside);
      }
    }

    // ── far ridge: pale, in front of the mountain's foot ────────────────
    float farTop = -0.015 + (ridgeLine(around, 2.3, 11.0) - 0.5) * 0.085;
    float farIn = smoothstep(-aa, aa, farTop - h);
    if (farIn > 0.0) {
      float depth = clamp((farTop - h) / 0.09, 0.0, 1.0);
      vec3 ridge = mix(uRidgeFar, air, clamp(uFarHaze * 0.78, 0.0, 0.95));
      // Mist gathers at the foot of every range, which is what separates it
      // from the one in front.
      ridge = mix(ridge, uMistBand, depth * 0.75);
      colour = mix(colour, ridge, farIn);
    }

    // ── near ridge: darker, wooded ──────────────────────────────────────
    float nearTop = -0.085 + (ridgeLine(around, 3.9, 37.0) - 0.5) * 0.10;
    float nearIn = smoothstep(-aa, aa, nearTop - h);
    if (nearIn > 0.0) {
      float depth = clamp((nearTop - h) / 0.11, 0.0, 1.0);
      float trees = noise(around * 60.0 + h * 40.0);
      vec3 ridge = mix(uRidgeNear * (0.9 + trees * 0.2), air, clamp(uFarHaze * 0.42, 0.0, 0.9));
      ridge = mix(ridge, uMistBand, depth * depth * 0.8);
      colour = mix(colour, ridge, nearIn);
    }

    // ── the lowland, down to wherever the planet's rim cuts it off ──────
    float low = smoothstep(-0.16, -0.30, h);
    colour = mix(colour, uLowland, low * 0.85);
    return colour;
  }
`;
