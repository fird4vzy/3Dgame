import * as THREE from 'three';

/**
 * Atmospheric perspective for a world you can walk all the way round.
 *
 * three's own fog is a function of view depth alone: one colour, one ramp. That
 * is the single biggest reason a scene looks like a render rather than a place,
 * because real air does two things a depth ramp cannot:
 *
 * 1. **It is thicker low down.** Mist pools in the hollows and over water and
 *    thins with altitude, so a valley reads as a valley from the hill above it.
 *    On a planet "low" means *radius*, not world Y — so the altitude here is
 *    `length(p) - seaRadius`, integrated along the view ray with Simpson's rule
 *    over three samples, which is exact enough at these distances and costs
 *    three `length`s and three `exp`s.
 * 2. **It glows toward the sun.** Forward scattering brightens and warms the
 *    haze in the sun's direction — the golden, backlit look of a valley at the
 *    end of the afternoon. Looking away from the sun the same haze is cool.
 *
 * It is installed by replacing the four fog shader chunks once, at boot, so
 * every material in the game — standard, basic, instanced, imported, the VRM
 * character — picks it up with no per-material work. The parameters reach the
 * shaders through a default `onBeforeCompile` on `Material.prototype`, which
 * hands every program the *same* uniform objects; a material with its own
 * `onBeforeCompile` must call {@link applyAtmosphere} itself.
 *
 * The sky shader computes the same sun glow, so geometry dissolves into the
 * sky behind it instead of cutting against it.
 */

export const atmosphereUniforms = {
  /** World-space unit vector toward the sun. */
  atmoSunDir: { value: new THREE.Vector3(0, 1, 0) },
  /** Linear colour of the in-scattered sunlight; HDR is fine. */
  atmoSunColour: { value: new THREE.Color(1, 0.9, 0.75) },
  /** Colour the low mist settles to, separate from the haze. */
  atmoMistColour: { value: new THREE.Color(0.85, 0.88, 0.9) },
  /**
   * x: haze density per metre (aerial perspective, every altitude).
   * y: mist density per metre at sea level.
   * z: mist falloff per metre of altitude.
   * w: strength of the glow toward the sun.
   */
  atmoParams: { value: new THREE.Vector4(0.012, 0.05, 0.55, 0.6) },
  /** Radius at which the mist is densest. */
  atmoSeaRadius: { value: 58.5 },
};

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorldPosition;
#endif
`;

// mvPosition is defined by project_vertex in every built-in shader, and
// cameraPosition / viewMatrix are in every program's prefix. The inverse of
// the view rotation is its transpose, which is what `v * mat3(M)` computes.
const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogWorldPosition = cameraPosition + mvPosition.xyz * mat3( viewMatrix );
#endif
`;

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogWorldPosition;
  uniform vec3 atmoSunDir;
  uniform vec3 atmoSunColour;
  uniform vec3 atmoMistColour;
  uniform vec4 atmoParams;
  uniform float atmoSeaRadius;
#endif
`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  vec3 atmoRay = vFogWorldPosition - cameraPosition;
  float atmoDist = length( atmoRay );
  vec3 atmoDir = atmoRay / max( atmoDist, 1e-4 );
  // The first few metres are clear: the character and what she is standing
  // next to stay crisp, and the air only shows where there is depth to show.
  float atmoDepth = max( atmoDist - 3.0, 0.0 );

  float atmoHaze = 1.0 - exp( - atmoDepth * atmoParams.x );

  float atmoK = atmoParams.z;
  float atmoH0 = max( length( cameraPosition ) - atmoSeaRadius, 0.0 );
  float atmoH1 = max( length( cameraPosition + atmoRay * 0.5 ) - atmoSeaRadius, 0.0 );
  float atmoH2 = max( length( vFogWorldPosition ) - atmoSeaRadius, 0.0 );
  float atmoMistDensity = ( exp( - atmoK * atmoH0 ) + 4.0 * exp( - atmoK * atmoH1 ) + exp( - atmoK * atmoH2 ) ) / 6.0;
  float atmoMist = 1.0 - exp( - atmoDepth * atmoParams.y * atmoMistDensity );

  float atmoAmount = 1.0 - ( 1.0 - atmoHaze ) * ( 1.0 - atmoMist );
  vec3 atmoColour = mix( fogColor, atmoMistColour, atmoMist / max( atmoHaze + atmoMist, 1e-4 ) );

  float atmoSun = max( dot( atmoDir, atmoSunDir ), 0.0 );
  atmoColour += atmoSunColour * ( pow( atmoSun, 8.0 ) * 0.55 + pow( atmoSun, 48.0 ) * 0.45 ) * atmoParams.w;

  gl_FragColor.rgb = mix( gl_FragColor.rgb, atmoColour, atmoAmount );
#endif
`;

let installed = false;

/** Hand a program the shared atmosphere uniforms. Idempotent. */
export function applyAtmosphere(shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, atmosphereUniforms);
}

/**
 * Replace three's fog with the atmosphere. Must run before the first material
 * compiles; later calls are no-ops.
 */
export function installAtmosphere(): void {
  if (installed) return;
  installed = true;

  THREE.ShaderChunk.fog_pars_vertex = FOG_PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = FOG_VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = FOG_PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT;

  // Every material without its own hook gets the uniforms. The function body
  // is also what three keys the program cache on, so it must stay stable.
  THREE.Material.prototype.onBeforeCompile = function atmosphereHook(shader) {
    applyAtmosphere(shader);
  };
}
