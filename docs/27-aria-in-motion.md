# 27 — Aria, moving like the recordings

The verdict on the Meshy heroine (docs/26) was short: terrible rendering,
and she stands crooked. Both were fair. Image-to-3D gave a body with the hair
as one solid mass and a plastic finish, and auto-rigging a re-posed mesh left
her standing hunched. The same screenshots caught a minka still looking as if
it floated, with a tree through its side.

What the Meshy work did buy was good: eight clips captured from performers,
on a standard skeleton. So the player is the VRoid model again (Aria: hair
built strand by strand, a real face, the sheet's glasses), dressed as on the
sheet and moving with those clips.

## Captured clips on a VRM (`entities/retarget.ts`)

`heroine-motion.glb` is the Meshy file with only its joints and the seven
clips the manifest names: 0.5 MB, against 2.9 MB for the full model
(`node tools/motion-only.mjs <in.glb> <out.glb> <manifest>`). At load,
every clip is resampled at 30 fps onto the VRM's normalized humanoid rig.

Copying local rotations across does not work. The source rests in an
**A-pose**, the normalized rig in a **T-pose** with every local rotation at
identity, so copied rotations put every arm 45° too high. The retarget works
in world space instead:

- `D = W(t) · W_rest⁻¹` is how a source bone has turned since standing still.
- `A` turns the target bone's rest direction (toward its next joint) onto the
  source's. The target's world rotation is `G = D · A · W_target_rest`.
- Local tracks come back out as `G_parent⁻¹ · G`, kept on one hemisphere.

The hips' travel is scaled by the ratio of hip heights and removed, so the
clips play in place (`prepareClip`, docs/26). The canonical-clip map and
fallbacks are the heroine manifest's, read through the same `ClipResolver`.

**Speed is measured on her legs.** Each gait clip is played once on the
retargeted rig and the planted foot's backward speed is its ground speed.
Scaling the source's figure by hip height left the feet sliding 5%: the same
angles on legs of different proportions cover different ground.

| at the game's speed | clip speed | plays at | cadence | planted foot / body |
|---|---|---|---|---|
| walk 1.8 m/s | 1.41 m/s | ×1.27 | 158 / min | 1.00 |
| run 4.6 m/s | 4.28 m/s | ×1.07 | 184 / min | 1.01 |

**Walking is 1.8 m/s now, down from 2.2** (`config/tuning.ts`). At 2.2 the
walk had to play at ×1.56, 193 steps a minute, which reads as scurrying.
Running is unchanged.

**The jump plays around the real arc.** The controller does the jump, and
its airtime is never the clip's. The clip's take-off and touchdown are found
from its feet. It starts at take-off, not at the crouch before it, because
she is already rising. It holds the reach for the ground while she is still
up, and resumes from touchdown when she lands, so the absorb happens when
her feet actually meet the ground. Stepping off a ledge joins the same clip
on the way down.

The procedural rig keeps what no clip covers. The fingers curl (the source
skeleton has none), and the face, the blinking and the gaze stay generated.
The crouch to pet a cat now blends over whatever the body was doing,
instead of replacing it. If the clips fail to load she falls back to the
generated gait (docs/20), which is complete on its own.

## Dressed from the sheet (`entities/outfit.ts`)

The model already had the sheet's long dark hair, glasses and white
sneakers. Her navy sleeveless top and dark jeans are repainted at load from
the model's own textures, so every seam, pocket and fold the artist drew
survives:

- **Top**: white with lavender stripes, the cloth's shading kept as a gentle
  multiplier. The stripes are about 2 cm apart, bolder than the sheet's
  pinstripe. Finer ones averaged to plain white at the camera's distance,
  and under golden-hour light plain white is the colour of her skin: from
  behind she read as shirtless.
- **Jeans**: light-wash blue. Gold stitching, rivets, the leather patch and
  the red tab keep their colours. The shadow tone moves from VRoid's warm
  pink to a cool blue, which on pale denim had looked like a stain.

The repaint uses data textures, not canvas ones. A canvas stores
premultiplied colour and loses the RGB under every fully transparent texel;
the mip chain averages those into the edges of a cut-out and draws a dark
rim. Transparent texels of the top are filled with the shirt's white. Both
textures are 1024², a quarter of the top's original memory.

**The geometry is unchanged, so the top stays sleeveless**, where the sheet
has rolled sleeves.

## The bug a white shirt found

Under the white top a row of black teeth showed round her waist, and black
flecks round the armholes. They came from the top itself. Rays through the
black pixels hit the top's mesh just below the hem of its texture, where the
alpha is zero and the fragment should have been discarded.

MToon copies its alpha cutoff into the shader only in `material.update()`,
which `vrm.update()` calls. The game never calls `vrm.update()`: it would run
the springbones, which fling the hair on a rotating planet (docs/20). So
**no cut-out on her had ever worked.** The clipped parts of every
alpha-tested material were drawn in the texture's colour under the
transparency, which is black. On a navy top over dark jeans nobody could
see it.

`VrmCharacter.update` now runs each material's `update` itself.

## The lantern, on light jeans

The lantern's pool of light (docs/25) was a 65° spot cast from the bottle,
which hangs 10–15 cm from her leg. Inverse-square made that leg some twenty
times brighter than in sunlight. On dark denim this went unnoticed; light
jeans burned to white from the knee down. The spot is now cast from 20 cm
ahead of the bottle in a 36° cone (`entities/props` › `createParcel`). Her legs
are outside it, and the ground still gets a pool about a metre across. A leg
swinging forward through the pool catches the light for a moment, as it
would.

## The minka

The minka is gone from the village (`PlanetScene` › `HOUSES`). Shot from the
ground, all eight stood on it. But the model's fused dead tree and the annex
hanging off its side read as floating at a glance, and no amount of placement
fixes a model.

## Looking at it

```bash
node tools/shoot-motion.mjs out/m   # contact sheet: stand ×2, walk, run, jump, celebrate;
                                    # foot slide per gait; close-ups front, back, face
node tools/shoot-player.mjs out/p   # in the game: back and front in all three moods, walk, run
```

`tools/motion-preview.html` exposes `__motionMeasure(clip, speed)`,
`__closeUp(angle, height, distance)` and `__pick(x, y)`. The last reports
the mesh, material and UV under a pixel, and is how the black teeth were
traced to the top.

## Still to do

- **Sleeves.** Matching the sheet's shirt needs new geometry. A VRoid
  re-export with a shirt that has sleeves would fix it at the source.
- **The hair is static.** Springbones still need solving in the character's
  local frame (docs/20).
- `aria.vrm` is 16.5 MB, the largest download in the game. Its textures are
  uncompressed PNG.
- The browser suites run on SwiftShader at 4–8 fps on this machine. A
  click-through or a timed walk can then fail for timing reasons alone.
  Re-run before believing a red result.
