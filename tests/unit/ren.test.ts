import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildRen, REN_HEIGHT, REN_PALETTE } from '../../src/game/entities/RenCharacter';
import { RenAnimator } from '../../src/game/entities/RenAnimator';

describe('Ren rig', () => {
  it('stands the right height with feet at the origin', () => {
    const rig = buildRen();
    const box = new THREE.Box3().setFromObject(rig.root);

    // Feet at y=0 is the asset contract; everything else assumes it.
    expect(box.min.y).toBeGreaterThan(-0.08);
    expect(box.min.y).toBeLessThan(0.08);
    expect(box.max.y).toBeGreaterThan(REN_HEIGHT * 0.85);
    expect(box.max.y).toBeLessThan(REN_HEIGHT * 1.15);
  });

  it('is roughly as wide as a person, not a billboard', () => {
    const rig = buildRen();
    const box = new THREE.Box3().setFromObject(rig.root);
    const depth = box.max.z - box.min.z;

    // The whole point of the rewrite: he has a front and a back.
    expect(depth).toBeGreaterThan(0.2);
    expect(box.max.x - box.min.x).toBeGreaterThan(0.3);
  });

  it('exposes every joint the animator poses', () => {
    const rig = buildRen();
    for (const joint of [
      rig.hips, rig.torso, rig.head,
      rig.armL, rig.armR, rig.forearmL, rig.forearmR,
      rig.legL, rig.legR, rig.shinL, rig.shinR,
    ]) {
      expect(joint).toBeInstanceOf(THREE.Object3D);
    }
  });

  it('parents forearms to arms and shins to thighs', () => {
    const rig = buildRen();
    // Hierarchy is what makes procedural posing work at all.
    expect(rig.forearmL.parent).toBe(rig.armL);
    expect(rig.shinR.parent).toBe(rig.legR);
    expect(rig.head.parent).toBe(rig.torso);
    expect(rig.torso.parent).toBe(rig.hips);
  });

  it('puts the hand socket inside the right forearm', () => {
    const rig = buildRen();
    // A parcel parented here travels with the arm swing.
    expect(rig.handSocket.parent).toBe(rig.forearmR);
  });

  it('casts shadows from its meshes', () => {
    const rig = buildRen();
    expect(rig.meshes.length).toBeGreaterThan(10);
    expect(rig.meshes.every((m) => m.castShadow)).toBe(true);
  });

  it('keeps the two lenses separated so they do not read as a visor', () => {
    const rig = buildRen();
    expect(rig.lenses).toHaveLength(2);
    const gap = Math.abs(rig.lenses[0]!.position.x - rig.lenses[1]!.position.x);
    const width = (rig.lenses[0]!.geometry as THREE.BoxGeometry).parameters.width;
    // Centres must be further apart than a lens is wide, or they touch.
    expect(gap).toBeGreaterThan(width);
  });

  it('gives him arms long enough to reach mid-thigh', () => {
    const rig = buildRen();
    // Stubby arms were the most obvious flaw in the first pass. On a real
    // figure the fingertips fall around mid-thigh; measure the hand's world
    // height against the knee to keep that true.
    const hand = new THREE.Vector3();
    rig.handSocket.updateWorldMatrix(true, false);
    hand.setFromMatrixPosition(rig.handSocket.matrixWorld);

    const knee = new THREE.Vector3();
    rig.shinR.updateWorldMatrix(true, false);
    knee.setFromMatrixPosition(rig.shinR.matrixWorld);

    expect(hand.y).toBeGreaterThan(knee.y);
    expect(hand.y).toBeLessThan(knee.y + 0.45);
  });

  it('uses a palette light enough to read against a dusk sky', () => {
    // The concept art is very dark; these are the lifted gameplay values.
    // Measured in sRGB — three converts to linear working space on construction,
    // so the default getHSL reports a much lower number for the same swatch.
    const jacket = new THREE.Color(REN_PALETTE.jacket);
    const hsl = { h: 0, s: 0, l: 0 };
    jacket.getHSL(hsl, THREE.SRGBColorSpace);
    expect(hsl.l).toBeGreaterThan(0.3);
  });
});

describe('Ren animation', () => {
  /** Advance the animator by `seconds` in 60 Hz steps. */
  const run = (animator: RenAnimator, seconds: number) => {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) animator.update(dt);
  };

  it('cycles the legs while walking', () => {
    const animator = new RenAnimator();
    animator.play('walk');
    run(animator, 0.6); // let the pose blend in

    const rig = (animator as unknown as { rig: ReturnType<typeof buildRen> }).rig;
    const samples: number[] = [];
    for (let i = 0; i < 60; i++) {
      animator.update(1 / 60);
      samples.push(rig.legL.rotation.x);
    }

    const range = Math.max(...samples) - Math.min(...samples);
    // This is the assertion the sprite could never satisfy.
    expect(range).toBeGreaterThan(0.4);
  });

  it('swings the legs in opposition, not in unison', () => {
    const animator = new RenAnimator();
    animator.play('run');
    run(animator, 1);

    const rig = (animator as unknown as { rig: ReturnType<typeof buildRen> }).rig;
    // A gait where both legs move together is a hop, not a run.
    expect(Math.sign(rig.legL.rotation.x)).not.toBe(Math.sign(rig.legR.rotation.x));
  });

  it('swings arms opposite to the leg on the same side', () => {
    const animator = new RenAnimator();
    animator.play('run');
    run(animator, 1);

    const rig = (animator as unknown as { rig: ReturnType<typeof buildRen> }).rig;
    expect(Math.sign(rig.armL.rotation.x)).not.toBe(Math.sign(rig.legL.rotation.x));
  });

  it('holds still when idle', () => {
    const animator = new RenAnimator();
    animator.play('idle');
    run(animator, 1.5);

    const rig = (animator as unknown as { rig: ReturnType<typeof buildRen> }).rig;
    const samples: number[] = [];
    for (let i = 0; i < 60; i++) {
      animator.update(1 / 60);
      samples.push(rig.legL.rotation.x);
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(0.05);
  });

  it('runs with a bigger stride than it walks', () => {
    const measure = (clip: 'walk' | 'run') => {
      const animator = new RenAnimator();
      animator.play(clip);
      run(animator, 1);
      const rig = (animator as unknown as { rig: ReturnType<typeof buildRen> }).rig;
      const samples: number[] = [];
      for (let i = 0; i < 90; i++) {
        animator.update(1 / 60);
        samples.push(rig.legL.rotation.x);
      }
      return Math.max(...samples) - Math.min(...samples);
    };
    expect(measure('run')).toBeGreaterThan(measure('walk'));
  });

  it('leans forward more when running than idling', () => {
    const lean = (clip: 'idle' | 'run') => {
      const animator = new RenAnimator();
      animator.play(clip);
      run(animator, 1);
      return (animator as unknown as { rig: ReturnType<typeof buildRen> }).rig.torso.rotation.x;
    };
    expect(lean('run')).toBeGreaterThan(lean('idle'));
  });

  it('blends between poses rather than snapping', () => {
    const animator = new RenAnimator();
    animator.play('idle');
    run(animator, 1);
    const rig = (animator as unknown as { rig: ReturnType<typeof buildRen> }).rig;

    animator.play('run');
    animator.update(1 / 60);
    // One frame after the change, the lean must not already be at the target.
    expect(rig.torso.rotation.x).toBeLessThan(0.15);
  });

  it('resolves sockets by canonical name', () => {
    const animator = new RenAnimator();
    expect(animator.getSocket('hand_R')).not.toBeNull();
    expect(animator.getSocket('back')).not.toBeNull();
    expect(animator.getSocket('nonsense')).toBeNull();
  });

  it('tints without driving the character to black', () => {
    const animator = new RenAnimator();
    const rig = (animator as unknown as { rig: ReturnType<typeof buildRen> }).rig;
    const before = (rig.meshes[0]!.material as THREE.MeshToonMaterial).color.getHSL({ h: 0, s: 0, l: 0 });

    animator.setTint(new THREE.Color('#7f8aa8'));
    const after = (rig.meshes[0]!.material as THREE.MeshToonMaterial).color.getHSL({ h: 0, s: 0, l: 0 });

    // The sprite path multiplied two sub-1 colours and produced a silhouette.
    expect(after.l).toBeGreaterThan(before.l * 0.7);
  });

  it('falls back to idle for a clip it has no pose for', () => {
    const animator = new RenAnimator();
    expect(() => animator.play('emote_dance')).not.toThrow();
    animator.update(1 / 60);
  });
});
