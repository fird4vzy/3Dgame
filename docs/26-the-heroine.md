# 26 — The heroine, from her character sheet

> **Superseded in part by [docs/27](27-aria-in-motion.md).** The generated
> mesh read as plastic and stood hunched, so the player is the VRoid model
> again, dressed from the sheet. The clips described here play on her through
> a retarget. This model is now only the fallback if the VRM fails to load.

The player character was a VRoid model (Aria) walked by a procedural gait.
Two reports drove the change: she should look like the character sheet the
user drew from — dark hair to the waist, black glasses, a white shirt with
lavender pinstripes, light wide jeans, white sneakers — and running "looked
unnatural", which after four rebuilds of `entities/gait.ts` (docs/20) was a
fair verdict on formulas trying to be motion.

## The pipeline

```bash
node tools/meshy.mjs character tools/concepts/heroine-front.png heroine \
  243,1,14,466,552,44,290,415 <texture prompt>
```

1. **Image → 3D in an A-pose.** The sheet's figure holds a camera up and
   makes a peace sign; auto-rigging that would give a skeleton whose rest
   pose is the gesture. `pose_mode: a-pose` re-posed her (and put the camera
   away). 24.6k triangles.
2. **Auto-rig**: 24 joints, Mixamo-style names (`Hips`, `RightHand`, …),
   centimetres under an `Armature` scaled 0.01.
3. **Library animations**, captured from performers, merged into one GLB on
   that skeleton: `Idle_3`, `Walking_Woman`, `Run_02`, `Regular_Jump`,
   `Happy_jump_f`, `Wave_One_Hand`, `Happy_Sway_Standing`, and
   `Carry_Water_Bucket_Walk`, which turned out to be mostly standing still
   with the bucket and is not used.

59 credits. The texture went to 1024 WebP: 2.9 MB for the character,
against 16.5 MB for the VRM, which stays only as a fallback.

## Making captured clips behave

`engine/character/CharacterFactory` (`MeshCharacter`) gained what sampled
clips need on a moving body:

- **In place.** A clip that travels has its hips' horizontal drift removed
  linearly — the travel goes, the sway stays. The jump's own rise above
  standing height is clipped off, so it does not stack on the controller's
  real jump; the crouch before and the absorption after survive.
- **Speed from the planted foot.** Each walk/run clip is sampled once at
  load, and a foot's horizontal speed during its lowest frames is the
  clip's ground speed (1.26 m/s walk, 3.85 m/s run). Playback rate follows
  the body's actual speed, so the feet do not slide. The hips' drift is no
  guide: the run's half-centimetre of wobble per loop first read as its
  speed and played it flat out.
- **One-shots hold.** Jump, celebration and wave play once and hold their
  last pose; the scene keeps locomotion from cutting a celebration short
  while she stands still. After each delivery she jumps for joy.
- **The lantern** hangs from `RightHand` through the manifest's sockets.

## What changed for the look

She is physically shaded like the rest of the world, so the sky's light,
the atmosphere's sun glow and the grade all reach her — the MToon VRM could
see none of the environment light (docs/24) and needed an AgX tone curve to
stay legible.

## Wiring

`src/data/characters/heroine.character.json` maps canonical clips and
sockets; `main.ts › attachCharacter` loads it first, then the VRM, then the
procedural rig. `tools/concepts/` keeps the concept and Meshy's preview;
task ids are in the manifest's notes, so the model can be re-rigged or given
more clips (`node tools/meshy.mjs animate <rigTaskId> …`) without
regenerating it.
