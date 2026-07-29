# 20 — Ren as a real 3D character

The player was a flat billboard of the concept sheet. In a game whose camera
orbits a sphere that was always wrong, and it is fixed.

## Why a billboard was never going to work

A sprite has no back. The camera in this game circles the character freely, and
on a small planet the player crosses the terrain's curvature constantly — so the
one thing a billboard cannot do (turn) is the thing that happens every few
seconds. It also cannot cast a meaningful shadow, which is what plants a
character on the ground.

The directional turnaround bought some of that back, but only for idle, and only
in five discrete steps.

## What replaced it

`RenCharacter.buildRen()` assembles a low-poly humanoid from primitives, reading
the concept sheet as a **specification** rather than as art: 180 cm proportions,
the layered-jacket silhouette, cargo pockets, heavy boots, the satchel, and the
palette chart.

The rig is a plain `Object3D` hierarchy, not a skinned mesh. For a character
whose limbs are rigid segments the visual result is identical, it costs no
skinning, and — the reason that actually decides it — the joints can be posed
procedurally.

## Which is what finally fixed the walk cycle

`RenAnimator` generates locomotion from a single phase value: legs swing on a
sine, arms counter-swing, knees bend only on the backswing so the foot clears
the ground, hips bob at *twice* the stride rate (one dip per footfall, not per
cycle), and the torso leans into speed.

No keyframes, no art, and it cycles — the gap that stood open for four phases.
Poses blend rather than snap, so walk→run reads as acceleration.

Small idle behaviours sit on top: a slow look-around and a periodic blink done
by squashing the lenses. Minor, but a perfectly still figure reads as broken
rather than as calm.

## Three things the build got wrong

### 1. His feet were 16 cm underground

`hipY` was hard-coded at 0.92 while the leg chain below it measured 1.08, so the
soles sat at −0.16 and he waded through the terrain. It was invisible in
screenshots and obvious in a bounding box.

Hip height is now **derived** from the leg chain (`HIP_DROP + thigh + shin +
footDrop`), so the soles land on y=0 by construction and no future proportion
tweak can silently move them. A test asserts it.

### 2. The tint turned him into a silhouette

`setTint` was carried over from the sprite, where it multiplied the base colour
by the tint. Two values below 1 multiplied together go very dark — fine on an
unlit billboard that needed forcing down, catastrophic on a toon material that
is already lit by the scene. It is now a gentle 16% lerp.

### 3. The glasses read as a solid visor

Pushed to 2.2 emissive the two lenses bled into one bar across his face, which
is a different character. Dropped to 0.85, given dark frames, and separated
enough that a test can assert the gap exceeds a lens width.

## Cost

- **60 FPS locked** on real hardware — the first meaningful frame-rate figure in
  the project, since every previous number came from software rendering.
- ~30 meshes, all sharing three toon materials.
- Zero bytes of downloaded art.

## What this does not replace

The sprite path stays. `BillboardCharacter`, the atlas and the slicer are still
the right tool for background NPCs, and the character manifest still accepts a
rigged glTF — which remains the better answer if real modelled art arrives.
Ren is now the default because a procedural rig beats a flat one, not because
the pipeline shrank.
