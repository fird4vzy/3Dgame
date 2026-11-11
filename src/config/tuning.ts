/**
 * Every number that controls how the game *feels*.
 *
 * Rule from docs/05-folder-structure.md: if a numeric literal controls feel and
 * lives outside this file, that is a review comment. Mutable at runtime so the
 * debug panel can tune it live.
 */
export const tuning = {
  move: {
    /**
     * The captured walk covers 1.41 m/s per cycle on her legs; at 1.8 it plays
     * at x1.27, a brisk 158 steps a minute. At the old 2.2 it had to play at
     * x1.56, 193 steps a minute, which reads as scurrying. See docs/27.
     */
    walkSpeed: 1.8,
    runSpeed: 4.6,
    groundAccel: 26,
    groundFriction: 14,
    airAccel: 6,
    jumpSpeed: 6.6,
    /** Share of the rise kept when jump is let go early: a tap is a hop. */
    jumpCut: 0.45,
    /** Seconds of full rise even the shortest tap gets. */
    minJumpTime: 0.08,
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
    /** A little further back than a portrait: the valley is the subject. */
    armLength: 5.0,
    /** Zoom limits. 1.1 m is close enough to read a face without clipping it. */
    minArmLength: 1.1,
    maxArmLength: 8,
    /** Metres the camera must stay above the terrain under it. */
    groundClearance: 0.9,
    /**
     * How far above her feet the camera looks: just over her head, so she
     * stands in the lower middle of the frame and the centre is the view.
     */
    heightOffset: 1.7,
    /**
     * Where the camera starts, radians; positive looks up. A little down, from
     * above her shoulder. It began below her looking up, which meant the lens
     * rode the ground clearance and bobbed with every rise it passed over.
     */
    startPitch: -0.12,
    /**
     * How quickly the point the camera orbits catches the player, as the
     * natural frequency of a critically damped spring. Along the ground it is
     * quick — at a run she leads the frame by under half a metre and no more —
     * and slower vertically, so a jump or a bump in the ground moves her on
     * screen instead of bouncing the whole picture.
     */
    followOmega: 20,
    followOmegaVertical: 9,
    /** Looking down from overhead, and up from the grass. */
    minPitchDeg: -62,
    maxPitchDeg: 42,
    /** Radians per pixel of mouse travel, at a look sensitivity of 1. */
    mouseSensitivity: 0.0022,
    touchSensitivity: 0.004,
    /** Radians a second at full deflection of the right stick. */
    gamepadYawSpeed: 2.7,
    gamepadPitchSpeed: 1.7,
    fov: 55,
    /** The postcard camera's lens: longer, so a far thing fills the frame. */
    photoFov: 38,
    /** Degrees the lens opens at a full run. Off under reduced motion. */
    runFovKick: 3.5,
    /** Radius of the sphere-cast used to pull the camera past obstacles. */
    occlusionRadius: 0.25,
    /** Rate (per second) at which the arm closes on an obstacle. */
    occlusionPullRate: 26,
    /** Rate (per second) at which the arm returns to full length afterwards. */
    occlusionRecoverRate: 3.2,
    /**
     * Seconds something must stay between the camera and her before the
     * camera moves for it. A lantern post crossing the view is not a wall.
     */
    occlusionPatience: 0.14,
  },

  input: {
    stickDeadzone: 0.12,
    /** Stick/joystick magnitude above which movement counts as running. */
    runThreshold: 0.7,
  },
} as const;

export type Tuning = typeof tuning;
