/**
 * World constants. 1 unit = 1 metre throughout the project.
 *
 * These are structural (changing them reshapes the world); values that only
 * affect *feel* live in tuning.ts so they can be adjusted at runtime.
 */

/** Sea-level radius of the planet. Circumference ~377 m. */
export const PLANET_RADIUS = 60;

/** Peak terrain displacement above and below sea level. */
export const TERRAIN_AMPLITUDE = 6;

/** Below this radius is water. */
export const SEA_LEVEL_RADIUS = PLANET_RADIUS - 1.5;

/** Downward acceleration toward the planet core. Higher than real gravity. */
export const GRAVITY = 18;

/** Character capsule. */
export const PLAYER_HEIGHT = 1.6;
export const PLAYER_RADIUS = 0.35;

/** Fixed simulation step. The controller depends on this being constant. */
export const FIXED_DT = 1 / 60;

/** Anti spiral-of-death clamp on a single frame's elapsed time. */
export const MAX_FRAME_TIME = 0.25;

/** Terrain tessellation: subdivisions per icosahedron edge. */
export const TERRAIN_DETAIL = 48;

/** Deterministic seed for terrain generation, so the world is reproducible. */
export const WORLD_SEED = 20260728;
