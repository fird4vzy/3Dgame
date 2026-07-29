# 21 — Bloom, character polish, and two camera bugs

## Bloom

`PostFX` adds bloom + vignette + tone mapping through pmndrs `postprocessing`,
which merges every effect into a **single fragment shader** — one full-screen
pass rather than one per effect. Bypassed entirely on the low quality tier.

This is not decoration. The premise is light returning to a dark planet, and
without bloom lamps, lumens and Ren's glasses merely get *brighter* rather than
appearing to emit. A district igniting lands far harder with it on.

### The ordering that matters

The first attempt washed the whole image out. Cause: three tone-maps as it
writes into the composer's buffer, so the values bloom then read were already
compressed to display range — bloom added on top of that and everything bleached.

The fix is to render **linear** (`renderer.toneMapping = NoToneMapping`) and put
an `ToneMappingEffect` at the *end* of the effect chain. HDR → bloom → tone map
is the only ordering that keeps contrast. A half-float buffer is what gives
emissives room to exceed 1.0 in the first place; on an 8-bit target everything
clips to white before the threshold can separate anything.

## Character polish

- **Arms lengthened** (upper 0.28 → 0.31, fore 0.25 → 0.29). Stubby arms were
  the most obvious flaw in the first rig; a test now asserts the hand falls
  between the knee and mid-thigh.
- **Hands** are no longer a single block: dark cuff, dark palm, bare fingers and
  a thumb — the sheet's fingerless gloves, in four primitives.
- **Elbow and knee pads**, which break the straight tube of each limb so the
  joints read as joints at full swing.
- **Hair** rebuilt as six weighted tufts plus a fringe, biased up and to one
  side. That asymmetry is most of what makes the sheet's swept shape legible at
  low poly; the symmetric cluster read as a helmet.

## Two camera bugs, both found by looking at a screenshot

### 1. Scenery did not block the camera

The BVH contains only the terrain, so the occlusion raycast could never hit a
rock, hut or tree. A boulder between the camera and the player filled the entire
frame and the camera happily sat inside it.

`FollowRig` now takes a list of occluders and raycasts them alongside the
terrain, taking the nearest hit. Instanced props raycast correctly, so one call
covers every instance of a prop type.

### 2. Movement direction collapsed when the camera pulled in

Consequence of fixing the first one. Movement was derived from
`camera.getWorldDirection()`, and when occlusion pulls the arm in tight the
camera ends up close to and below its target — its forward vector is then nearly
parallel to `up`, so projecting it onto the tangent plane collapses to noise and
movement jitters or wanders.

The follow rig already maintains a **parallel-transported heading that is
tangent by construction**. The controller now prefers that, falling back to the
camera only if no rig is attached. This is strictly better than what was there
before: the heading was always the more correct reference, and the camera vector
merely happened to work while nothing ever pulled the arm in.

## Test note

The playthrough's approach heuristic was fragile and had been passing by luck.
Every steering correction costs several browser round-trips, so the character
covered about a metre between samples and could sail past a 2.4 m interaction
radius. It now closes the last stretch in short, re-aimed taps — the way a
player actually does it — and converges on *being in range* rather than on a
distance sample.

The game was never at fault here: focus engages correctly at 2.2 m and at
0.05 m, which is what the diagnostic probe showed before any test was touched.

## Verification

139 unit tests, both browser suites green, ~55–60 FPS on real hardware with the
post stack enabled.
