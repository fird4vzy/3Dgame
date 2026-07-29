# 23 — The frozen shard, and making Ren look like the sheet

Three questions off a play session. One was a bug, one was a bug I had not
noticed, and one was a design decision of mine that turned out to be wrong.

## 1. The collected shard that sat there

**Report:** "why are they standing still when I collect them?"

`ShardSystem.update()` hid a collected shard with `object.visible = false` and
removed it from the spatial hash. Correct, as far as it went.

Then `PlanetScene.lateUpdate()` ran `cullBelowHorizon()`, which did this for
every registered cullable — shards included:

```ts
object.visible = !isBeyondHorizon(object.position, viewer, PLANET_RADIUS);
```

The player is standing on top of the shard they just collected, so it is well
inside the horizon, so `visible` went straight back to `true` — on the same
frame. And because `update()` skips collected shards, it also stopped spinning
and bobbing.

So the shard did not vanish. It **froze**, exactly as described. The counter
went up, the sound played, and the object stayed there motionless, which reads
as "the pickup did nothing".

The bug is a category error: the culler was answering "is this round the curve
of the planet" but *writing* to a field that also means "does this still exist".
Two owners, one variable, last writer wins.

Fixed by giving gameplay the authority and culling the subordinate role:

```ts
export function shouldBeVisible(object: Cullable, viewer: V3, radius: number): boolean {
  if (object.userData.hidden === true) return false;
  return !isBeyondHorizon(object.position, viewer, radius);
}
```

`ShardSystem` sets `userData.hidden` through one `setHidden()` helper, so
collect, restore and reset cannot drift apart.

**On the regression test.** The rule now lives in `core/math/spherical.ts` as a
pure function, and the test drives the real `ShardSystem` through the real
`shouldBeVisible`. That shape is deliberate. The last time I "verified" a fix by
writing the check inline in the test, the check contained the same handedness
error as the code and confirmed a broken build (see `docs/19`). A test that
re-implements the thing it is testing proves nothing.

## 2. Collecting a shard had no moment

Not reported, but obvious once the shard actually disappeared: it vanished in
one frame with no event attached to it. `shard:collected` now carries the
shard's own position — not the player's, since the bob has moved them apart —
and `PlanetScene` bursts 18 motes in the shard's colour there.

## 3. Ren did not look like the concept sheet

**Report:** "he doesn't look the same as the picture I sent."

Correct, and the largest cause was a decision I made and documented in
`docs/20`: the sheet's palette is near-black charcoal-green, which merges into a
dusk sky, so I raised every swatch. Eleven hand-picked hex values later, his
jacket was a mid sage grey — a different character. Worse, the lift was baked
into the values, so there was no way to ask "how far from the art are we?" or to
undo it.

The palette is now the sheet's real swatches plus **one** knob:

```ts
export const PALETTE_LIFT = 0.14;
```

At 0 he is exactly the drawing. The lift is applied in sRGB bytes, not through
`THREE.Color.lerp` — three converts hex to linear on construction, and a
linear-space blend toward a light colour raises dark swatches far more than the
number implies (0.14 there lands *lighter* than the palette it replaced).

Beyond colour, the sheet is a person and the rig was a mannequin:

| Sheet | Was | Now |
|---|---|---|
| Full face | no eyes, nose or mouth at all | eyes, brows, nose, mouth, ears, jaw mass |
| Round tinted glasses over visible eyes | two emissive bars on a blank head | torus rims, translucent lens, temple arms, eyes reading through |
| Big messy swept hair | 6 tufts hugging the skull | 10 two-tone tufts with real volume, parted fringe, sideburns |
| Quilted puffer, tall collar, green piping | one plain box | seam lines front and back, lapels over the tee, standing collar, shoulder piping |
| Lean build | wide shoulders, short torso | `shoulderX` 0.19 → 0.175 |

### What the test suite could not see

Both of the following shipped through a fully green run:

- **The collar ate the face.** Sized on its own terms, its top edge landed above
  the chin and buried the jaw, mouth and nose in a grey box. The collar is now
  positioned *from* `CHIN_Y`, which is a named constant for exactly this reason.
- **The shoulder piping never rendered.** Placed at `z = 0.02`, which is inside
  the jacket shell. It was there, invisible, in every frame.

Structural assertions — feet at y=0, joints parented, lenses apart — cannot
catch either. `tools/character-preview.html` plus `npm run shoot:character`
renders a four-angle turnaround and a head crop to PNG. Both bugs were obvious
in the first image. Look at the character.

### The trade-off, stated plainly

`PALETTE_LIFT = 0.14` is the smallest lift where the silhouette still reads
against a night sky at distance. Lower it for a look truer to the sheet and
accept that he gets harder to pick out in an unlit district. It is one number,
in one place, and changing it needs no other edit.

## Still placeholder

The villagers are the original Phase 3 capsules. Standing next to a rigged Ren
they now look like what they are. They are the obvious next thing.
