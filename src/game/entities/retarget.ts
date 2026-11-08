import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { prepareClip } from '@engine/character/CharacterFactory';

/**
 * Captured motion from one skeleton, played on a VRM's normalized rig.
 *
 * The source is a Mixamo-style rig (Meshy's, here) whose rest pose is an
 * **A-pose**; a VRM's normalized rig rests in a **T-pose** with every local
 * rotation identity. Copying local rotations across therefore fails in the
 * most visible way possible — every arm ends up forty-five degrees higher
 * than it was captured — so the retarget works in world space instead:
 *
 * - For every frame, each source bone's *world delta from its rest*,
 *   `D = W(t) · W_rest⁻¹`, says how the bone has turned since standing still.
 * - Each target bone is first turned so its rest direction matches the
 *   source's rest direction (`A`, the T-to-A correction, from the direction
 *   to the next joint), then by the same delta: `G = D · A · W_target_rest`.
 *   The bone then points exactly where the captured bone points.
 * - Local rotations come back out as `G_parent⁻¹ · G`, which is what the
 *   normalized rig's tracks hold.
 *
 * The hips' translation is scaled by the ratio of hip heights and made to
 * play in place; the controller moves the body. The jump's own rise is
 * clipped off for the same reason (see `prepareClip`).
 */

/** Source bone → VRM humanoid bone, and the joint each one points toward. */
const MIXAMO_STYLE: Array<[string, VRMHumanBoneName, string | null]> = [
  ['Hips', 'hips', 'Spine02'],
  ['Spine02', 'spine', 'Spine01'],
  ['Spine01', 'chest', 'Spine'],
  ['Spine', 'upperChest', 'neck'],
  ['neck', 'neck', 'Head'],
  ['Head', 'head', 'head_end'],
  ['LeftShoulder', 'leftShoulder', 'LeftArm'],
  ['LeftArm', 'leftUpperArm', 'LeftForeArm'],
  ['LeftForeArm', 'leftLowerArm', 'LeftHand'],
  ['LeftHand', 'leftHand', null],
  ['RightShoulder', 'rightShoulder', 'RightArm'],
  ['RightArm', 'rightUpperArm', 'RightForeArm'],
  ['RightForeArm', 'rightLowerArm', 'RightHand'],
  ['RightHand', 'rightHand', null],
  ['LeftUpLeg', 'leftUpperLeg', 'LeftLeg'],
  ['LeftLeg', 'leftLowerLeg', 'LeftFoot'],
  ['LeftFoot', 'leftFoot', 'LeftToeBase'],
  ['LeftToeBase', 'leftToes', null],
  ['RightUpLeg', 'rightUpperLeg', 'RightLeg'],
  ['RightLeg', 'rightLowerLeg', 'RightFoot'],
  ['RightFoot', 'rightFoot', 'RightToeBase'],
  ['RightToeBase', 'rightToes', null],
];

/** The VRM bone each target points toward, mirroring the table above. */
const VRM_CHILD: Partial<Record<VRMHumanBoneName, VRMHumanBoneName>> = {
  hips: 'spine',
  spine: 'chest',
  chest: 'upperChest',
  upperChest: 'neck',
  neck: 'head',
  leftShoulder: 'leftUpperArm',
  leftUpperArm: 'leftLowerArm',
  leftLowerArm: 'leftHand',
  rightShoulder: 'rightUpperArm',
  rightUpperArm: 'rightLowerArm',
  rightLowerArm: 'rightHand',
  leftUpperLeg: 'leftLowerLeg',
  leftLowerLeg: 'leftFoot',
  leftFoot: 'leftToes',
  rightUpperLeg: 'rightLowerLeg',
  rightLowerLeg: 'rightFoot',
  rightFoot: 'rightToes',
};

export interface RetargetedClip {
  clip: THREE.AnimationClip;
  /** Ground speed the clip was captured at, scaled to the VRM's legs, m/s. 0 if not a gait. */
  groundSpeed: number;
  /**
   * For a jump: when the feet leave the ground and when they come back, in
   * clip seconds. The controller does the real jump, so the clip is started
   * at take-off, held before touchdown while she is still in the air, and
   * resumed from touchdown when she lands.
   */
  flight?: { takeoff: number; touchdown: number };
}

/** A foot this far above where it stands (metres) is off the ground. */
const CONTACT = 0.03;
/** Feet must clear the ground by this much for a clip to count as a jump. */
const MIN_JUMP = 0.1;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Unit direction from a node to another, in world space. */
function direction(from: THREE.Object3D, to: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(to.getWorldPosition(_b)).sub(from.getWorldPosition(_a)).normalize();
}

interface Pair {
  source: THREE.Object3D;
  target: THREE.Object3D;
  /** Rest world rotation of the source bone, inverted. */
  sourceRestInverse: THREE.Quaternion;
  /** T-to-A correction times the target's rest world rotation. */
  aligned: THREE.Quaternion;
  /** Index of the paired parent, or -1 to use the target parent's rest. */
  parent: number;
  parentRest: THREE.Quaternion;
}

/**
 * Retarget every clip in `clips` (animating `source`) onto `vrm`'s normalized
 * rig. `source` must be at its rest pose; so must the VRM.
 */
export function retargetToVrm(
  source: THREE.Object3D,
  clips: THREE.AnimationClip[],
  vrm: VRM,
  options: { airborne?: Set<string>; gaits?: Set<string>; fps?: number } = {},
): Map<string, RetargetedClip> {
  const humanoid = vrm.humanoid;
  const result = new Map<string, RetargetedClip>();
  if (!humanoid) return result;

  source.updateWorldMatrix(true, true);
  vrm.scene.updateWorldMatrix(true, true);

  const pairs: Pair[] = [];
  const byTarget = new Map<THREE.Object3D, number>();
  for (const [sourceName, boneName, sourceChild] of MIXAMO_STYLE) {
    const s = source.getObjectByName(sourceName);
    const t = humanoid.getNormalizedBoneNode(boneName);
    if (!s || !t) continue;

    // Rest directions: toward the next joint where there is one, otherwise
    // along the segment that ends here (a hand points the way its forearm does).
    const sourceTo = sourceChild ? source.getObjectByName(sourceChild) : null;
    const targetChildName = VRM_CHILD[boneName];
    const targetTo = targetChildName ? humanoid.getNormalizedBoneNode(targetChildName) : null;
    const sourceDir = new THREE.Vector3();
    const targetDir = new THREE.Vector3();
    if (sourceTo && targetTo) {
      direction(s, sourceTo, sourceDir);
      direction(t, targetTo, targetDir);
    } else if (s.parent && t.parent) {
      direction(s.parent, s, sourceDir);
      direction(t.parent, t, targetDir);
    }
    const correction = new THREE.Quaternion();
    if (sourceDir.lengthSq() > 0 && targetDir.lengthSq() > 0) correction.setFromUnitVectors(targetDir, sourceDir);

    pairs.push({
      source: s,
      target: t,
      sourceRestInverse: s.getWorldQuaternion(new THREE.Quaternion()).invert(),
      aligned: correction.multiply(t.getWorldQuaternion(new THREE.Quaternion())),
      parent: -1,
      parentRest: t.parent ? t.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion(),
    });
    byTarget.set(t, pairs.length - 1);
  }
  for (const pair of pairs) pair.parent = pair.target.parent ? (byTarget.get(pair.target.parent) ?? -1) : -1;
  if (pairs.length === 0) return result;

  // Hips: translation scaled by hip height, measured above the feet.
  const sourceHips = pairs[0]!.source;
  const targetHips = pairs[0]!.target;
  const sourceHipsRest = sourceHips.getWorldPosition(new THREE.Vector3());
  const targetHipsRestLocal = targetHips.position.clone();
  const sourceFoot = source.getObjectByName('LeftFoot');
  const targetFoot = humanoid.getNormalizedBoneNode('leftFoot');
  const sourceHeight = sourceFoot ? sourceHipsRest.y - sourceFoot.getWorldPosition(_a).y : 1;
  const targetHeight = targetFoot
    ? targetHips.getWorldPosition(_a).y - targetFoot.getWorldPosition(_b).y
    : sourceHeight;
  const scale = sourceHeight > 1e-4 ? targetHeight / sourceHeight : 1;
  const targetHipsParentInverse = targetHips.parent
    ? targetHips.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
    : new THREE.Quaternion();

  // Feet, for finding take-off and touchdown in jumps.
  const feet = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']
    .map((name) => source.getObjectByName(name))
    .filter((o): o is THREE.Object3D => !!o);
  const feetRest = feet.map((foot) => foot.getWorldPosition(_a).y);
  const targetFeet = (['leftFoot', 'rightFoot'] as const)
    .map((name) => humanoid.getNormalizedBoneNode(name))
    .filter((o): o is THREE.Object3D => !!o);

  const fps = options.fps ?? 30;
  const sampler = new THREE.AnimationMixer(source);
  const world = new THREE.Quaternion();
  const delta = new THREE.Quaternion();
  const offset = new THREE.Vector3();

  for (const clip of clips) {
    const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(frames);
    const rotations = pairs.map(() => new Float32Array(frames * 4));
    const hips = new Float32Array(frames * 3);
    const globals = pairs.map(() => new THREE.Quaternion());
    const previous = pairs.map(() => new THREE.Quaternion());
    const airborne = options.airborne?.has(clip.name) ?? false;
    const lift = new Float32Array(frames);

    sampler.stopAllAction();
    const action = sampler.clipAction(clip);
    // Sample the last frame as the last frame, not wrapped round to the first.
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    for (let f = 0; f < frames; f++) {
      const t = Math.min(clip.duration, f / fps);
      times[f] = t;
      sampler.setTime(t);
      source.updateWorldMatrix(true, true);

      pairs.forEach((pair, i) => {
        pair.source.getWorldQuaternion(world);
        delta.multiplyQuaternions(world, pair.sourceRestInverse);
        globals[i]!.multiplyQuaternions(delta, pair.aligned);
      });
      pairs.forEach((pair, i) => {
        const parentWorld = pair.parent >= 0 ? globals[pair.parent]! : pair.parentRest;
        const local = delta.copy(parentWorld).invert().multiply(globals[i]!);
        // Keep each track on one hemisphere, or interpolation spins the long way.
        if (f > 0 && local.dot(previous[i]!) < 0) local.set(-local.x, -local.y, -local.z, -local.w);
        previous[i]!.copy(local);
        local.toArray(rotations[i]!, f * 4);
      });

      sourceHips.getWorldPosition(offset).sub(sourceHipsRest).multiplyScalar(scale);
      offset.applyQuaternion(targetHipsParentInverse).add(targetHipsRestLocal);
      offset.toArray(hips, f * 3);

      if (airborne && feet.length > 0) {
        lift[f] = Math.min(...feet.map((foot, i) => foot.getWorldPosition(_a).y - feetRest[i]!));
      }
    }
    action.stop();
    sampler.uncacheClip(clip);

    const tracks: THREE.KeyframeTrack[] = pairs.map(
      (pair, i) => new THREE.QuaternionKeyframeTrack(`${pair.target.name}.quaternion`, times, rotations[i]!),
    );
    const hipsTrack = new THREE.VectorKeyframeTrack(`${targetHips.name}.position`, times, hips);
    tracks.push(hipsTrack);
    const retargeted = new THREE.AnimationClip(clip.name, clip.duration, tracks);
    prepareClip(retargeted, targetHips.name, airborne);

    // Measured on her own legs, playing the retargeted clip: the same angles
    // on legs of different proportions cover different ground, so scaling the
    // source's figure by hip height left the feet sliding by about 5%.
    const groundSpeed = options.gaits?.has(clip.name) ? stanceSpeed(vrm.scene, retargeted, targetFeet, pairs, fps) : 0;
    const flight = airborne && feet.length > 0 ? flightOf(times, lift) : undefined;
    result.set(clip.name, flight ? { clip: retargeted, groundSpeed, flight } : { clip: retargeted, groundSpeed });
  }

  sampler.stopAllAction();
  sampler.setTime(0);
  source.updateWorldMatrix(true, true);
  return result;
}

/**
 * Take-off and touchdown of a captured jump, from how high its lowest foot is
 * above where it stands. Undefined if the feet never really leave the ground.
 */
export function flightOf(times: ArrayLike<number>, lift: ArrayLike<number>): RetargetedClip['flight'] {
  const count = Math.min(times.length, lift.length);
  if (count < 3) return undefined;
  let apex = 0;
  for (let f = 1; f < count; f++) if (lift[f]! > lift[apex]!) apex = f;
  if (lift[apex]! < MIN_JUMP) return undefined;
  let up = apex;
  while (up > 0 && lift[up - 1]! > CONTACT) up--;
  let down = apex;
  while (down < count - 1 && lift[down]! > CONTACT) down++;
  return { takeoff: times[Math.max(0, up - 1)]!, touchdown: times[down]! };
}

/**
 * Ground speed of an in-place gait, from the planted foot (see the note on
 * `MeshCharacter.measureStance`), in world units. Plays `clip` on `root` and
 * puts the paired bones back at rest afterwards.
 */
function stanceSpeed(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  feet: THREE.Object3D[],
  pairs: Pair[],
  fps: number,
): number {
  if (feet.length < 2) return 0;
  const rest = pairs.map((pair) => [pair.target.quaternion.clone(), pair.target.position.clone()] as const);
  const sampler = new THREE.AnimationMixer(root);
  sampler.clipAction(clip).play();
  const frames = Math.max(8, Math.round(clip.duration * fps));
  const track = feet.map(() => [] as THREE.Vector3[]);
  for (let f = 0; f <= frames; f++) {
    sampler.setTime((clip.duration * f) / frames);
    root.updateWorldMatrix(true, true);
    feet.forEach((foot, i) => track[i]!.push(foot.getWorldPosition(new THREE.Vector3())));
  }
  sampler.stopAllAction();
  sampler.uncacheRoot(root);
  pairs.forEach((pair, i) => {
    pair.target.quaternion.copy(rest[i]![0]);
    pair.target.position.copy(rest[i]![1]);
  });
  root.updateWorldMatrix(true, true);

  const dt = clip.duration / frames;
  let sum = 0;
  let count = 0;
  for (const points of track) {
    const low = Math.min(...points.map((p) => p.y));
    const high = Math.max(...points.map((p) => p.y));
    const planted = low + (high - low) * 0.15;
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1]!;
      const q = points[i]!;
      if (p.y > planted || q.y > planted) continue;
      sum += Math.hypot(q.x - p.x, q.z - p.z) / dt;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}
