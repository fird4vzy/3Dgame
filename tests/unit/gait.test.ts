import { describe, expect, it } from 'vitest';
import {
  STANCE,
  airPose,
  armSwing,
  cycleLength,
  ankleDrop,
  hipAmplitude,
  hipCompensation,
  hipDrop,
  lateralShift,
  legPose,
  nearestFootfall,
  phaseAdvance,
  stanceFraction,
  stanceTravel,
  stepLength,
  wrapPhase,
} from '../../src/game/entities/gait';

/** Proportions of the shipped character, measured from the rig. */
const FOOT = { thighLength: 0.44, shinLength: 0.41, toeLength: 0.15, heelLength: 0.07 };

describe('cadence is locked to the ground', () => {
  it('advances one cycle per cycle-length travelled, whatever the timestep', () => {
    const speed = 3.6;
    const distance = cycleLength(speed);

    // The same journey, integrated at three different tick rates.
    for (const steps of [1, 60, 977]) {
      const dt = distance / speed / steps;
      let phase = 0;
      for (let i = 0; i < steps; i++) phase += phaseAdvance(speed, dt);
      expect(phase).toBeCloseTo(1, 6);
    }
  });

  it('covers exactly the distance walked, not a fixed number of steps per second', () => {
    // This is the regression the old `phase += stride * dt` could not pass:
    // its phase depended only on elapsed time, so twice the speed for half the
    // time gave half the strides for the same ground.
    const far = phaseAdvance(5.0, 1.0) * cycleLength(5.0);
    const slow = phaseAdvance(1.0, 1.0) * cycleLength(1.0);
    expect(far).toBeCloseTo(5.0, 9);
    expect(slow).toBeCloseTo(1.0, 9);
  });

  it('lengthens the step as speed rises, and shortens it to a shuffle at a crawl', () => {
    expect(stepLength(0.2)).toBeLessThan(stepLength(1.4));
    expect(stepLength(1.4)).toBeLessThan(stepLength(3.0));
    expect(stepLength(3.0)).toBeLessThan(stepLength(5.2));
    // Clamped at both ends rather than extrapolating into nonsense.
    expect(stepLength(40)).toBeCloseTo(stepLength(5.2), 6);
    expect(stepLength(0)).toBeGreaterThan(0);
  });
});

describe('hip amplitude solves for the step it is given', () => {
  it('reproduces the requested step length to within a millimetre', () => {
    for (const legLength of [0.62, 0.85, 1.02]) {
      for (const step of [0.5, 0.95, 1.35, 1.55]) {
        const a = hipAmplitude(step, legLength);
        if (a >= 1.15) continue; // clamped: the leg is too short for the step
        const reach = legLength * (Math.sin(a) + Math.sin(0.82 * a));
        expect(Math.abs(reach - step)).toBeLessThan(0.001);
      }
    }
  });

  it('gives a shorter leg a wider swing for the same step', () => {
    expect(hipAmplitude(0.95, 0.62)).toBeGreaterThan(hipAmplitude(0.95, 1.02));
  });

  it('never returns a hip angle a body could not reach', () => {
    expect(hipAmplitude(4, 0.4)).toBeLessThanOrEqual(1.15);
    expect(hipAmplitude(0.9, 0)).toBe(0);
  });
});

describe('the cycle has a stance and a swing, not two equal halves', () => {
  it('sweeps the hip backwards throughout stance', () => {
    let previous = Infinity;
    for (let p = 0; p < STANCE; p += 0.01) {
      const { thigh } = legPose(p);
      expect(thigh).toBeLessThan(previous);
      previous = thigh;
    }
  });

  it('spends more of the cycle planted than swinging', () => {
    expect(STANCE).toBeGreaterThan(0.5);
  });

  it('returns the leg forward again during the swing', () => {
    expect(legPose(STANCE).thigh).toBeLessThan(0);
    expect(legPose(0.999).thigh).toBeGreaterThan(0.9);
  });

  it('never hyperextends the knee', () => {
    for (let p = 0; p < 1; p += 0.005) {
      expect(legPose(p).knee).toBeGreaterThanOrEqual(0);
    }
  });

  it('folds the knee to clear the ground during swing, and straightens it in stance', () => {
    const midStance = legPose(0.35).knee;
    const midSwing = legPose(0.8).knee;
    expect(midSwing).toBeGreaterThan(midStance * 4);
    expect(midStance).toBeLessThan(0.06);
  });

  it('is nearly straight-legged at the moment of contact', () => {
    expect(legPose(0).knee).toBeLessThan(0.05);
  });

  it('pushes the toes down at toe-off and lifts them to clear during swing', () => {
    // Peak plantarflexion sits just before the foot leaves the ground.
    expect(legPose(STANCE - 0.03).ankle).toBeGreaterThan(0.5);
    expect(legPose(0.8).ankle).toBeLessThan(0);
    // ...and the foot is flat through mid-stance, not rolled up on the ball.
    expect(Math.abs(legPose(0.3).ankle)).toBeLessThan(0.05);
  });

  it('scales linearly with amplitude', () => {
    const one = legPose(0.3, 1);
    const half = legPose(0.3, 0.5);
    expect(half.thigh).toBeCloseTo(one.thigh * 0.5, 9);
    expect(half.knee).toBeCloseTo(one.knee * 0.5, 9);
    expect(half.ankle).toBeCloseTo(one.ankle * 0.5, 9);
  });

  it('is periodic', () => {
    for (const p of [0.13, 0.44, 0.71, 0.96]) {
      expect(legPose(p + 3).thigh).toBeCloseTo(legPose(p).thigh, 9);
    }
  });

  it('always has a foot down at a walk', () => {
    // One leg is planted while the other swings — never both swinging. This is
    // what makes a walk a walk, and it is exactly what a run gives up.
    for (let p = 0; p < 1; p += 0.02) {
      const leftPlanted = wrapPhase(p) < STANCE;
      const rightPlanted = wrapPhase(p + 0.5) < STANCE;
      expect(leftPlanted || rightPlanted).toBe(true);
    }
  });
});

describe('a run is not a fast walk', () => {
  it('keeps both feet down for part of a walk cycle', () => {
    expect(stanceFraction(1.0)).toBeGreaterThan(0.5);
  });

  it('opens a flight phase once running', () => {
    const stance = stanceFraction(4.9);
    expect(stance).toBeLessThan(0.5);

    // Below 0.5, there is a moment with neither foot on the ground.
    let airborneSamples = 0;
    for (let p = 0; p < 1; p += 0.005) {
      const left = wrapPhase(p) < stance;
      const right = wrapPhase(p + 0.5) < stance;
      if (!left && !right) airborneSamples++;
    }
    expect(airborneSamples).toBeGreaterThan(0);
  });

  it('shortens the stance monotonically as speed rises', () => {
    let previous = Infinity;
    for (const speed of [0, 1, 2, 3, 4, 5, 8]) {
      const s = stanceFraction(speed);
      expect(s).toBeLessThanOrEqual(previous);
      previous = s;
    }
  });

  it('asks the leg to reach the distance the foot actually covers', () => {
    // The trap this exists to avoid: reaching for one *step* rather than for
    // the ground covered during one *stance*, which under-reaches by a third
    // and puts the scrape straight back in.
    for (const speed of [1.0, 2.3, 3.5, 4.9]) {
      expect(stanceTravel(speed)).toBeCloseTo(stanceFraction(speed) * cycleLength(speed), 9);
      expect(stanceTravel(speed)).toBeGreaterThan(0);
    }
  });

  it('holds the reach within a hip joint at every speed', () => {
    for (let speed = 0; speed <= 6; speed += 0.1) {
      const a = hipAmplitude(stanceTravel(speed), 0.85);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThanOrEqual(1.15);
    }
  });

  it('puts toe-off wherever the stance ends', () => {
    // The leg is at full extension at the instant the foot leaves the ground,
    // whatever fraction of the cycle that is.
    for (const stance of [0.38, 0.5, 0.62]) {
      const atToeOff = legPose(stance, 1, stance).thigh;
      for (let p = 0; p < 1; p += 0.01) {
        expect(legPose(p, 1, stance).thigh).toBeGreaterThanOrEqual(atToeOff - 1e-9);
      }
    }
  });
});

describe('the body above the legs', () => {
  it('stands at full height with the legs straight', () => {
    const straight = { thigh: 0, knee: 0, ankle: 0 };
    expect(ankleDrop(straight, FOOT)).toBeCloseTo(0.85, 9);
    // A standstill has no stride, so no drop.
    expect(hipDrop(0, 0, STANCE, FOOT)).toBeCloseTo(0, 9);
  });

  it('measures to the sole, not the ankle bone', () => {
    // Toes pointed: the ball of the foot is below the ankle, so the pelvis can
    // sit higher. Getting this wrong put the body at its lowest at push-off.
    const flat = { thigh: 0, knee: 0, ankle: 0 };
    const pointed = { thigh: 0, knee: 0, ankle: 0.6 };
    const heelDown = { thigh: 0, knee: 0, ankle: -0.4 };
    expect(ankleDrop(pointed, FOOT)).toBeGreaterThan(ankleDrop(flat, FOOT));
    expect(ankleDrop(heelDown, FOOT)).toBeGreaterThan(ankleDrop(flat, FOOT));
    // The forefoot is longer than the heel, so pointing drops further.
    expect(ankleDrop(pointed, FOOT)).toBeGreaterThan(ankleDrop(heelDown, FOOT));
  });

  it('never lets a planted foot go through the floor', () => {
    const standing = FOOT.thighLength + FOOT.shinLength;
    const cases: Array<[number, number]> = [[0.8, STANCE], [0.85, 0.38], [0.6, 0.5]];
    for (const [amp, stance] of cases) {
      for (let p = 0; p < 1; p += 0.005) {
        const drop = hipDrop(p, amp, stance, FOOT);
        const leftDown = wrapPhase(p) < stance;
        const rightDown = wrapPhase(p + 0.5) < stance;
        // Sole height above the standing datum, for each foot that is down.
        if (leftDown) {
          expect(standing - drop - ankleDrop(legPose(p, amp, stance), FOOT)).toBeGreaterThan(-1e-6);
        }
        if (rightDown) {
          expect(standing - drop - ankleDrop(legPose(p + 0.5, amp, stance), FOOT)).toBeGreaterThan(-1e-6);
        }
      }
    }
  });

  it('rides highest when a leg is straight beneath the body', () => {
    const at = (p: number) => hipDrop(p, 0.8, STANCE, FOOT);
    // Mid-stance (a near-vertical supporting leg) versus contact (spread).
    expect(at(0.28)).toBeLessThan(at(0));
    // And it genuinely moves — a pelvis that never dips is a body on rails.
    expect(at(0) - at(0.28)).toBeGreaterThan(0.02);
  });

  it('does not dive to meet a swinging leg during a run flight phase', () => {
    // The regression: with no foot down, taking the longest leg pulled the
    // pelvis to the floor and the swing foot skated through it at 7 m/s.
    const stance = 0.38;
    const amp = 0.85;
    const inFlight = [];
    for (let p = 0; p < 1; p += 0.005) {
      if (wrapPhase(p) < stance || wrapPhase(p + 0.5) < stance) continue;
      inFlight.push(hipDrop(p, amp, stance, FOOT));
    }
    expect(inFlight.length).toBeGreaterThan(10);
    // The body is at its highest in flight, so the drop there never exceeds
    // the drop at the contact that ends it.
    const atContact = hipDrop(0, amp, stance, FOOT);
    for (const drop of inFlight) expect(drop).toBeLessThanOrEqual(atContact + 1e-6);
  });

  it('lands a run on a bent knee, and a walk on a straight one', () => {
    // Absorption is what stops a run pogoing; it must not leak into the walk.
    const runMid = legPose(0.19, 0.85, 0.38).knee;
    const walkMid = legPose(0.31, 0.85, STANCE).knee;
    expect(runMid).toBeGreaterThan(0.2);
    expect(walkMid).toBeLessThan(0.06);
  });

  it('holds the ankle in place when the knee absorbs', () => {
    // A bent knee swings the ankle backwards, which would put the slide
    // straight back into the run. The hip rotates by exactly enough to cancel
    // it: fore-aft ankle offset must match the straight-leg value.
    const T = 0.52;
    const Sh = 0.48;
    for (const thigh of [-0.7, -0.3, 0, 0.35, 0.8]) {
      for (const knee of [0.1, 0.35, 0.62]) {
        const d = hipCompensation(thigh, knee);
        const moved = T * Math.sin(thigh + d) + Sh * Math.sin(thigh + d - knee);
        expect(Math.abs(moved - Math.sin(thigh))).toBeLessThan(0.002);
      }
    }
  });

  it('needs no compensation when the knee is straight', () => {
    expect(hipCompensation(0.5, 0)).toBeCloseTo(0, 9);
  });

  it('shifts weight onto whichever foot is planted', () => {
    // Left foot is down for the first 62% of the cycle.
    expect(lateralShift(0.25)).toBeGreaterThan(0);
    expect(lateralShift(0.75)).toBeLessThan(0);
  });

  it('swings each arm against the leg on the same side', () => {
    // Left leg fully forward at phase 0, so the left arm must be back.
    expect(legPose(0).thigh).toBeGreaterThan(0);
    expect(armSwing(0)).toBeGreaterThan(0.9);
    // ...and the right arm forward, half a cycle out.
    expect(armSwing(0.5)).toBeLessThan(-0.9);
  });
});

describe('settling to a stop', () => {
  it('snaps to the nearer moment where both feet are on the ground', () => {
    expect(nearestFootfall(0.08)).toBe(0);
    expect(nearestFootfall(0.42)).toBe(0.5);
    expect(nearestFootfall(0.61)).toBe(0.5);
    expect(nearestFootfall(0.93)).toBe(1);
  });
});

describe('the jump is shaped by velocity, not a timer', () => {
  it('separates rising from falling, so the two can pose differently', () => {
    expect(airPose(6).rise).toBeGreaterThan(0.9);
    expect(airPose(6).fall).toBeCloseTo(0, 9);
    expect(airPose(-6).fall).toBeGreaterThan(0.8);
    expect(airPose(-6).rise).toBeCloseTo(0, 9);
  });

  it('tucks hardest at the apex', () => {
    const apex = airPose(0).tuck;
    expect(apex).toBeGreaterThan(airPose(-7).tuck);
    expect(apex).toBeGreaterThan(0.8);
  });

  it('reaches for the ground only on the way down', () => {
    expect(airPose(5).reach).toBeCloseTo(0, 9);
    expect(airPose(0).reach).toBeCloseTo(0, 9);
    expect(airPose(-7).reach).toBeCloseTo(1, 6);
  });

  it('plays the same shape for a hop and a cliff, scaled by the fall', () => {
    // A short hop never reaches the deep reach a long drop does — which is the
    // whole point of reading velocity instead of replaying a fixed clip.
    expect(airPose(-1.5).reach).toBeLessThan(airPose(-7).reach);
  });

  it('is continuous through the apex', () => {
    const before = airPose(0.05);
    const after = airPose(-0.05);
    expect(Math.abs(before.tuck - after.tuck)).toBeLessThan(0.05);
    expect(Math.abs(before.rise - after.rise)).toBeLessThan(0.05);
    expect(Math.abs(before.fall - after.fall)).toBeLessThan(0.05);
  });
});
