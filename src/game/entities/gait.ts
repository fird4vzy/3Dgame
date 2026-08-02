/**
 * Gait curves.
 *
 * This module exists because the first locomotion pass drove every limb from
 * one sine wave at a fixed frequency, and that is wrong in two separate ways
 * that compound into "awkward":
 *
 * 1. **The cadence was not locked to the ground.** `phase += stride * dt` runs
 *    at a constant rate regardless of how fast the character is actually
 *    travelling, so the feet slide across the surface — the single most
 *    recognisable tell of bad locomotion, and the reason accelerating out of a
 *    walk looked like skating. Here the phase is advanced by *distance
 *    travelled*, so one stride always covers one stride's worth of ground.
 *
 * 2. **A sine spends half the cycle in stance and half in swing.** Real walking
 *    is roughly 60/40: the planted leg sweeps back slowly and almost linearly
 *    while the body rides over it, then the free leg whips through in a little
 *    over a third of the time with the knee folded to clear the ground. Equal
 *    halves read as wading, which is exactly what it looked like.
 *
 * Everything below is a pure function of phase, so it is unit-testable without
 * a renderer, a VRM or a browser — and shared by the character rig and the
 * footstep emitter, so audio and animation cannot drift apart.
 *
 * Phase is measured in **turns** (one full gait cycle = 1.0, not 2π) with 0 at
 * left heel strike. Angles are returned as multiples of the caller's amplitude,
 * so a single `amp` term scales a walk into a run.
 */

const TAU = Math.PI * 2;

/** Wrap a phase into [0, 1). */
export const wrapPhase = (p: number): number => p - Math.floor(p);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Zero outside `[a, b]`, a half-sine arch inside it. */
function bump(p: number, a: number, b: number): number {
  if (p <= a || p >= b) return 0;
  return Math.sin(((p - a) / (b - a)) * Math.PI);
}

/** `bump`, for an interval that crosses the end of the cycle (a > b). */
function bumpWrapped(p: number, a: number, b: number): number {
  if (b > a) return bump(p, a, b);
  return bump(p < b ? p + 1 : p, a, b + 1);
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

// ── stride geometry ────────────────────────────────────────────────────────

/**
 * Ground covered by one step at a walk, in metres.
 *
 * These were 0.95 and 1.55, which are *long*. A 1.65 m character taking a 1.1 m
 * step has to swing the hip about 49° to reach it, and 49° is not a walk — it
 * is a lunge, which is exactly how it read. Real walking is nearer 25–30°.
 *
 * Shortening the step is the right lever rather than capping the hip angle,
 * because step length and cadence are two ends of the same equation: take
 * shorter steps at the same speed and the legs simply turn over faster, which
 * is what a person actually does when they hurry. Capping the angle instead
 * would break the reach-versus-ground relationship and put the foot-slide back.
 */
export const WALK_STEP = 0.72;
/** Ground covered by one step at a run, in metres. */
export const RUN_STEP = 1.15;

/**
 * Step length at a given speed.
 *
 * People lengthen their stride as they speed up rather than just spinning their
 * legs faster, so this interpolates instead of switching. The endpoints are the
 * walk and run speeds from `tuning.move`; between them the blend is linear,
 * which is close enough to the real relationship at these speeds.
 *
 * **The footstep emitter and the character rig both call this.** That is the
 * point: cadence is derived once, so a footfall sound always lands on a frame
 * where a foot is actually on the ground.
 */
export function stepLength(speed: number): number {
  // Below a walk people take shorter steps rather than slower ones, so the
  // step has to shrink too — otherwise a slow approach slides.
  if (speed < 1.4) return WALK_STEP * (0.5 + 0.5 * clamp01(speed / 1.4));
  const t = clamp01((speed - 1.4) / (5.2 - 1.4));
  return WALK_STEP + (RUN_STEP - WALK_STEP) * t;
}

/**
 * The hip swing that makes the foot travel a given distance.
 *
 * Picking leg amplitude by eye is the other half of the sliding-feet problem:
 * cadence can be perfectly locked to the ground and the feet will still scrape
 * if the legs are not reaching far enough to cover the distance. The foot's
 * fore-aft travel is `legLength * (sin(a) + sin(0.82a))` for hip amplitude `a`,
 * so this inverts that — three Newton steps, which converges to well under a
 * degree from the small-angle first guess.
 *
 * `travel` is what the planted foot must cover through the body's frame during
 * one stance, i.e. `stanceFraction(speed) * cycleLength(speed)` — *not* the step
 * length. Confusing the two under-reaches by a third and the feet scrape again.
 *
 * Deriving it means the same code fits a tall character and a short one without
 * a magic number per model.
 */
export function hipAmplitude(travel: number, legLength: number): number {
  if (legLength <= 0) return 0;
  let a = travel / (legLength * (1 + 0.82));
  for (let i = 0; i < 3; i++) {
    const f = legLength * (Math.sin(a) + Math.sin(0.82 * a)) - travel;
    const d = legLength * (Math.cos(a) + 0.82 * Math.cos(0.82 * a));
    if (Math.abs(d) < 1e-6) break;
    a -= f / d;
  }
  // A hip cannot flex past about 65°, and asking for more folds the model.
  return Math.max(0, Math.min(a, 1.15));
}

/** Metres covered by a full two-step cycle at a given speed. */
export const cycleLength = (speed: number): number => 2 * stepLength(speed);

/**
 * How far the planted foot must travel through the body's frame, in one stance.
 *
 * The foot is stationary on the ground, so in the character's own frame it
 * sweeps backwards at the body's speed for as long as it is planted. That
 * distance — not the step length — is what the leg has to reach.
 */
export const stanceTravel = (speed: number): number =>
  stanceFraction(speed) * cycleLength(speed);

/**
 * Phase advance, in turns, for one tick at a given speed.
 *
 * This is the fix for the sliding feet: cadence is a consequence of how far the
 * character moved, never a constant.
 */
export function phaseAdvance(speed: number, dt: number): number {
  return (speed * dt) / cycleLength(speed);
}

// ── the cycle ──────────────────────────────────────────────────────────────

/** Fraction of the cycle a foot spends on the ground, at a walk. */
export const STANCE = 0.62;

/**
 * Stance fraction at a given speed.
 *
 * This is the actual difference between walking and running, and it is not a
 * matter of degree. At 0.62 both feet are down for a quarter of every cycle;
 * below 0.5 there is a moment with *neither* foot down — the flight phase — and
 * that is what makes a run read as a run rather than as a walk played fast.
 * Running it as a constant is why the old sprint looked like a hurried stroll.
 *
 * It also closes the geometry. The planted foot has to travel
 * `stance × cycleLength` through the body's frame, so a shorter stance is a
 * shorter reach, which is what keeps the hip angle inside what a hip can do at
 * speed.
 */
export function stanceFraction(speed: number): number {
  const t = clamp01((speed - 1.4) / (4.5 - 1.4));
  return 0.62 + (0.38 - 0.62) * t;
}

/** Hip flexion at heel strike, relative to amplitude. */
const HIP_FORWARD = 1.0;
/** Hip extension at toe-off. Less than the flexion, as in life. */
const HIP_BACK = -0.82;

export interface LegPose {
  /** Hip pitch. Positive swings the thigh forward. */
  thigh: number;
  /** Knee flexion. Positive folds the shin back; never negative. */
  knee: number;
  /** Ankle pitch *in addition to* keeping the sole level. Positive points the toes down. */
  ankle: number;
}

/**
 * One leg, at one moment in the cycle.
 *
 * Phase 0 is heel strike for this leg; pass `phase + 0.5` for the other one.
 *
 * The two halves are deliberately different shapes. Stance is very nearly
 * linear because the hip angle tracks the body's constant travel over a planted
 * foot. Swing is a smoothstep over a much shorter interval, so the leg leaves
 * quickly and arrives gently — a foot that is still moving when it lands is
 * what makes a walk look like it is being dragged.
 */
export function legPose(phase: number, amp = 1, stance = STANCE): LegPose {
  const p = wrapPhase(phase);

  let thigh: number;
  if (p < stance) {
    thigh = HIP_FORWARD + (HIP_BACK - HIP_FORWARD) * (p / stance);
  } else {
    thigh = HIP_BACK + (HIP_FORWARD - HIP_BACK) * smoothstep((p - stance) / (1 - stance));
  }

  // Loading response: the knee gives a little as the weight arrives on it.
  // Small, but its absence is what makes a walk look stiff-legged.
  const loading = bump(p, 0, stance * 0.42) * 0.34;
  // Swing clearance: the fold that lifts the foot over the ground.
  //
  // It starts at toe-off, not before it. Folding the knee while the foot is
  // still bearing weight forces the pelvis down at exactly the moment a runner
  // is pushing *up* off the ground, and the body ends up at its lowest at
  // push-off — backwards. The pointed toe is what keeps the foot clear through
  // that instant instead.
  //
  // A run folds it much harder than a walk — heel almost to the backside — and
  // that deep tuck is one of the loudest signals that someone is running
  // rather than walking quickly. `run` below is 0 at a walk and 1 at a sprint.
  const runFold = clamp01((STANCE - stance) / (STANCE - 0.38));
  const clearance = bump(p, stance - 0.02, 1.0) * (1.8 + 1.15 * runFold);

  // Ankle, as three separate actions rather than one curve. Plantarflexion is
  // tight around toe-off: spread earlier it rolls the body up onto the ball of
  // a still-vertical leg, which lifts the pelvis at the exact moment both legs
  // are spread and it should be at its lowest.
  const toeOff = bump(p, stance - 0.12, stance + 0.06) * 0.75;
  const toeClear = -bump(p, stance + 0.05, 0.94) * 0.34;
  const heelStrike = -bumpWrapped(p, 0.93, 0.12) * 0.26;

  let hip = thigh * amp;
  let knee = (loading + clearance) * amp;

  // Running lands on a bent leg and springs off it. Without that absorption a
  // straight leg reaching 45° forward forces the pelvis a third of a metre
  // below standing height at every contact, and the character pogos. It fades
  // to nothing at a walk, where the knee really is close to straight through
  // stance.
  const run = clamp01((STANCE - stance) / (STANCE - 0.38));
  if (run > 0.001) {
    const absorb = bump(p, 0, stance) * 0.62 * run * amp;
    knee += absorb;
    // Bending the knee also swings the ankle backwards, which would put the
    // slide straight back in. Rotate the hip by exactly enough to hold the
    // ankle where it was — a one-axis solve, and the cheapest possible IK.
    hip += hipCompensation(hip, absorb);
  }

  return {
    thigh: hip,
    knee,
    ankle: (toeOff + toeClear + heelStrike) * amp,
  };
}

/** Thigh lengths as a fraction of the whole leg. Only the ratio matters here. */
const THIGH_RATIO = 0.52;
const SHIN_RATIO = 0.48;

/**
 * Extra hip flexion that cancels the fore-aft ankle shift caused by `knee`.
 *
 * Ankle offset is `Lt·sin(θ) + Ls·sin(θ − κ)`; we want that to equal the
 * straight-leg value `(Lt + Ls)·sin(θ)`. Two Newton steps from zero, which is
 * plenty — the correction is small and the function is smooth.
 */
export function hipCompensation(thigh: number, knee: number): number {
  const target = Math.sin(thigh);
  let d = 0;
  for (let i = 0; i < 2; i++) {
    const f =
      THIGH_RATIO * Math.sin(thigh + d) + SHIN_RATIO * Math.sin(thigh + d - knee) - target;
    const df = THIGH_RATIO * Math.cos(thigh + d) + SHIN_RATIO * Math.cos(thigh + d - knee);
    if (Math.abs(df) < 1e-6) break;
    d -= f / df;
  }
  return d;
}

/** Foot proportions, needed because the sole touches the ground, not the ankle. */
export interface FootGeometry {
  thighLength: number;
  shinLength: number;
  /** Ankle to the ball of the foot. */
  toeLength: number;
  /** Ankle back to the heel. */
  heelLength: number;
}

/**
 * Hip-to-lowest-contact-point distance for one leg, given its pose.
 *
 * Two-link forward kinematics for the ankle — the thigh hangs at `thigh` from
 * vertical, the shin folds back from it by `knee` — plus the part that is easy
 * to forget: **the ankle is not what touches the floor.** At heel strike the
 * heel is below the ankle; at toe-off the whole foot is rolled over and the toe
 * is below it by more. Measuring to the ankle alone made the pelvis sit lowest
 * exactly at push-off, which is the opposite of what a body does.
 */
export function ankleDrop(pose: LegPose, foot: FootGeometry): number {
  const ankle =
    foot.thighLength * Math.cos(pose.thigh) +
    foot.shinLength * Math.cos(pose.thigh - pose.knee);

  // The sole's pitch is `pose.ankle` (positive = toes down), because the rig
  // cancels the rest of the chain to keep it level.
  const toeBelow = foot.toeLength * Math.max(0, Math.sin(pose.ankle));
  const heelBelow = foot.heelLength * Math.max(0, Math.sin(-pose.ankle));
  return ankle + Math.max(toeBelow, heelBelow);
}

/**
 * How far the pelvis must sink for the lower foot to reach the ground.
 *
 * This replaces the bob with the reason for the bob. A pelvis bobbing on a sine
 * is decoration, and it is decoration that actively lies: swing the hip 45°
 * forward while holding the pelvis at standing height and the foot simply
 * cannot reach the floor, so the character walks on air. Placing the pelvis
 * where the legs put it means the feet land because they *must*, and the rise
 * and fall that comes out is the real one — high at mid-stance where the
 * supporting leg is straight, low at contact where the legs are spread.
 *
 * Take the larger of the two required heights, or the other foot goes through
 * the floor.
 */
export function hipDrop(
  phase: number,
  amp: number,
  stance: number,
  foot: FootGeometry,
): number {
  const standing = foot.thighLength + foot.shinLength;
  const need = (p: number): number => ankleDrop(legPose(p, amp, stance), foot);

  const p = wrapPhase(phase);
  const leftDown = p < stance;
  const rightDown = wrapPhase(p + 0.5) < stance;

  // Whatever else happens, no foot may end up under the floor. Taking the
  // longest leg — swinging or not — is a ceiling on how far the pelvis may
  // sink. It can only ever raise the body, so the worst case is a planted foot
  // hovering a centimetre or two, which is invisible; the alternative is a foot
  // disappearing into the terrain, which is not.
  const noPenetration = standing - Math.max(need(p), need(p + 0.5));

  if (leftDown || rightDown) {
    let needed = 0;
    if (leftDown) needed = Math.max(needed, need(p));
    if (rightDown) needed = Math.max(needed, need(p + 0.5));
    return Math.min(standing - needed, noPenetration);
  }

  // Flight. Nothing is touching the ground, so nothing on the ground can
  // dictate where the pelvis goes — and letting the longest leg dictate it
  // anyway is exactly the bug this replaced: the body dove downwards to meet a
  // leg that was only passing through, and the foot skated forwards at 7 m/s
  // while grazing the floor. Carry the pelvis from the last toe-off to the next
  // contact instead, over a small ballistic arc.
  const half = p % 0.5;
  const u = clamp01((half - stance) / (0.5 - stance));
  const fromToeOff = standing - need(stance);
  const toContact = standing - need(0);
  const arc = 0.1 * (1 - stance / 0.5) * standing;
  const ballistic = fromToeOff + (toContact - fromToeOff) * u - arc * 4 * u * (1 - u);

  return Math.min(ballistic, noPenetration);
}

/** Lateral weight shift toward the stance foot, -1..1 (positive = left). */
export function lateralShift(phase: number): number {
  return Math.sin(wrapPhase(phase) * TAU);
}

/**
 * Arm swing for the *left* arm, -1..1. Positive is behind the body.
 *
 * Peaks back exactly when the left leg is forward, which is the contralateral
 * pairing every walk has and the thing people notice instantly when it is
 * wrong. Pass `phase + 0.5` for the right arm.
 */
export function armSwing(phase: number): number {
  return Math.cos(wrapPhase(phase) * TAU);
}

/**
 * Where the phase should settle when the character comes to rest.
 *
 * Stopping mid-swing leaves one leg hanging in the air, which then eases back
 * to neutral looking boneless. Snapping toward the nearer double-support moment
 * — feet together, weight even — lands the character in a pose it could
 * actually stand in.
 */
export function nearestFootfall(phase: number): number {
  return Math.round(phase * 2) / 2;
}

// ── airborne ───────────────────────────────────────────────────────────────

export interface AirPose {
  /** How much the legs are tucked up under the body, 0..1. */
  tuck: number;
  /** How much the legs reach out for the ground, 0..1. */
  reach: number;
  /** How hard the body is travelling upwards, 0..1. */
  rise: number;
  /** How hard it is travelling downwards, 0..1. */
  fall: number;
}

/**
 * The jump arc, as a function of *vertical velocity* rather than elapsed time.
 *
 * This is the other half of the fix. Keying an airborne pose to a clip timer
 * assumes every jump lasts the same length, so a hop off a kerb played the same
 * tuck-and-reach as a fall down a cliff and both looked like a puppet on a
 * string. Reading the actual velocity means the character extends as it leaves
 * the ground, tucks at the apex where the velocity passes through zero, and
 * reaches for the ground on the way down — automatically, at any height.
 */
export function airPose(verticalSpeed: number): AirPose {
  const rising = clamp01(verticalSpeed / 5);
  const falling = clamp01(-verticalSpeed / 7);
  // Apex: neither rising nor falling much. This is where the tuck belongs.
  const apex = clamp01(1 - Math.abs(verticalSpeed) / 4);

  return {
    tuck: apex * 0.85 + rising * 0.35,
    reach: falling,
    rise: rising,
    fall: falling,
  };
}
