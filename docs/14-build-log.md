# 14 — Build Log: Phases 0 and 1

What was actually built, what the design got wrong, and what changed as a result.

## Delivered

**Phase 0 — Foundation.** Vite 6 + TypeScript 5 (strict, `noUncheckedIndexedAccess`),
ESLint with the architecture-boundary rules from `05-folder-structure.md`
actually enforced, Vitest, CI with a bundle-size gate. `core/` complete:
`EventBus`, `Store`, `StateMachine`, `ServiceContainer`, spherical maths,
deterministic noise, `ObjectPool`. Fixed-timestep `GameLoop` with accumulator
and interpolation.

**Phase 1 — Planet and player.** Displaced icosphere terrain with a
`three-mesh-bvh` BVH, `SphericalCharacterController`, `FollowRig` with parallel
transport, device-agnostic `InputManager` (keyboard/mouse, gamepad, touch),
`RendererService` with adaptive resolution and FOV-based aspect handling,
placeholder character, debug overlay.

**Verification.** 32 unit tests, 15 end-to-end assertions driving the real game
in Chromium: spawn, walk at 2.2 m/s, run at 4.6 m/s, grounded ≥ 95% of frames,
jump and land, traverse the surface, portrait viewport, zero console errors.

## Four things the design got wrong

### 1. The horizon distance was wrong by 2×

`03-gameplay-specification.md` claimed a ~27 m horizon at eye height on a 60 m
planet. The correct figure is **13.5 m** — `sqrt(2·60·1.5 + 1.5²)`. The spec
doubled it.

This matters: 13.5 m is about eight paces, and it is what landmark spacing and
district sizing must be designed around. The corrected number is now pinned by a
unit test so it cannot drift, and the doc records `PLANET_RADIUS` as the lever if
playtesting finds it claustrophobic.

### 2. Capsule depenetration by averaging does not converge

The first implementation summed each triangle's push-out, averaged over the
contact count, and repeated for four iterations. The result: the player floated
**0.556 m above the terrain**, permanently airborne, grounded on only 11% of
frames, with `landing` re-firing continuously.

Summing double-counts overlaps shared between adjacent triangles and launches
the capsule; averaging under-corrects in corners. The version that converges
corrects the capsule segment **inside** the shapecast callback, so each triangle
is tested against the already-resolved pose. After the fix the gap is 0.015 m and
grounding is 100% while walking and running.

This is the single most important correction in the phase — everything above the
controller was untestable until it landed.

### 3. The shadow camera silently kept its default frustum

`PlanetScene` set `left/right/top/bottom/near/far` on the directional light's
shadow camera but never called `updateProjectionMatrix()`. Three.js kept the
default ±5 ortho box, so terrain more than a few metres out rendered as fully
shadowed — a hard black rectangle across most of the frame.

### 4. A canvas with `inset: 0` does not stretch

`#game { position: fixed; inset: 0 }` looks like it fills the viewport. It does
not: a canvas is a *replaced element*, so `width: auto` resolves to its intrinsic
drawing-buffer size even with all four insets at zero. The moment adaptive
resolution scaled the buffer to 0.65, the game drew into the top-left 65% of the
window and left the rest black.

This would have hit every device with `devicePixelRatio ≠ 1` — i.e. every phone.
Fixed with an explicit `width: 100%; height: 100%`.

## Design decisions confirmed in code

- **Parallel transport works.** The camera holds its heading through arbitrary
  traversal with no roll or gimbal pop. The e2e test drives 30 mouse-drag steps
  mid-run and the player stays on the surface.
- **No physics engine was needed.** Kinematic capsule + BVH raycasts cover
  movement, ground snapping and camera occlusion. Total shipped JS is 149 kB
  gzipped against a 6 MB budget.
- **The analytic height function pays off.** `PlanetTerrain.heightAt()` is the
  single source of truth for terrain: the mesh is built from it and spawn
  placement queries it directly, with no raycasting and no risk of two
  implementations drifting.

## Known gaps

- FPS readings from the container are meaningless — Chromium runs under
  SwiftShader software rendering here. Real frame-rate validation needs actual
  hardware (Phase 6).
- Horizon culling is implemented and unit-tested but registers no objects yet,
  because there are no props to cull.
- `Component.fixedUpdate` is called on the controller directly rather than
  through an animation layer; `AnimationController` arrives with real character
  assets in Phase 4.
- No audio, UI screens, save system or scene manager yet — Phase 2.
