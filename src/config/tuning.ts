/**
 * Every number that controls how the game *feels*.
 *
 * Rule from docs/05-folder-structure.md: if a numeric literal controls feel and
 * lives outside this file, that is a review comment. Mutable at runtime so the
 * debug panel can tune it live.
 */
export const tuning = {
  move: {
    walkSpeed: 2.2,
    runSpeed: 4.6,
    groundAccel: 26,
    groundFriction: 14,
    airAccel: 6,
    jumpSpeed: 6.6,
    maxFallSpeed: 32,
    /** Grace period after leaving ground during which jump still works. */
    coyoteTime: 0.12,
    /** How long a jump press is remembered while airborne. */
    jumpBuffer: 0.14,
    /** Slerp rate (per second) for aligning the character to the surface. */
    orientLerp: 12,
    maxSlopeDeg: 52,
    /** Distance below the feet searched for ground when snapping. */
    groundSnapDistance: 0.5,
    /** Speed above which locomotion is considered a run, for animation. */
    runThreshold: 3.0,
  },

  glide: {
    descentSpeed: 2.4,
    forwardSpeed: 7.5,
    thermalForwardSpeed: 11,
    turnRateDeg: 90,
    /** Minimum clearance below the player required to deploy. */
    minClearance: 1.5,
    thermalRadius: 8,
    thermalLift: 4,
  },

  camera: {
    armLength: 4.5,
    /** Zoom limits. 1.1 m is close enough to read a face without clipping it. */
    minArmLength: 1.1,
    maxArmLength: 11,
    glideArmLength: 6.5,
    heightOffset: 1.5,
    /** Critically damped spring frequency for position follow. */
    positionOmega: 9,
    /** Slerp rate (per second) for rotation follow. */
    rotationLerp: 14,
    minPitchDeg: -35,
    maxPitchDeg: 55,
    mouseSensitivity: 0.0022,
    touchSensitivity: 0.004,
    gamepadSensitivity: 2.4,
    fov: 55,
    glideFov: 68,
    /** Radius of the sphere-cast used to pull the camera past obstacles. */
    occlusionRadius: 0.25,
    /** Rate at which the arm returns to full length after an occlusion. */
    occlusionRecoverSpeed: 6,
  },

  input: {
    stickDeadzone: 0.12,
    /** Stick/joystick magnitude above which movement counts as running. */
    runThreshold: 0.7,
  },
} as const;

export type Tuning = typeof tuning;
