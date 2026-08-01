# 20 — The sky, and what art would actually help

Answering two questions: would a picture of the sky improve things, and what
does "better sprites" mean now that Ren is a 3D mesh rather than a sprite.

## What just changed

The sky was a flat `scene.background` colour lerped between two values. It is
now a **shader dome** (`src/game/world/Skydome.ts`) with a two-stop gradient, a
warm horizon band, and a starfield of varied brightness that fades as the planet
lights.

The detail that matters, and the reason it is a dome rather than a background:
**the gradient axis follows the player's local up.** On a planet you can walk
right around, a sky whose horizon is fixed to world +Y is correct in exactly one
place — walk to the pole and you would see the horizon glow directly overhead.
The dome recomputes from `normalize(playerPosition)` every frame, so the horizon
is always where the player's horizon actually is.

Fog now samples its colour from the same horizon ramp, so the terrain edge no
longer cuts against the sky.

## Would a picture of the sky help?

**Depends entirely on which kind.** Three cases:

| What you find | Usable? | How |
|---|---|---|
| A photo or painting of a sky (any normal image) | **As reference only** | I sample it and derive the gradient stops — zenith, horizon, glow, star tint. Genuinely useful for art direction; it just does not go into the build |
| A **360° equirectangular panorama** (2:1 aspect, e.g. 4096×2048 PNG/JPG) | **Yes, directly** | Becomes a real skybox texture behind the gradient |
| An **HDR panorama** (`.hdr` / `.exr`, equirectangular) | **Best** | Skybox *and* image-based lighting — it would light the props and character too, which is a much bigger visual jump than the backdrop alone |

The one constraint any image has to live with: **the sky must change.** The
premise is light returning to a dark world, so the sky goes from dusk to warm
evening as districts wake. A fixed image cannot do that on its own. The plan
either way is to keep the procedural gradient for the horizon glow and the
dusk→lit shift, and put your panorama *behind* it for the deep-sky detail
(stars, nebulae, cloud bands). They compose well — the gradient handles the
part that animates, the image handles the part that has detail.

So: worth finding, but get a **panorama**, not a photo. A photo is a mood board.

## "Better sprites" — Ren is not a sprite any more

Worth being precise, because the answer changed. Ren was a sprite atlas cut from
your concept sheet. He is now procedural 3D geometry (`RenCharacter.ts`) — boxes
and capsules with flat vertex colours, no textures, no material variation. That
is why he reads as a tan mannequin rather than the cyberpunk AR scout on the
sheet: dark tactical gear, green HUD glasses, the scarf, the satchel.

In order of impact, what would change that:

### 1. A rigged glTF — by far the biggest win

One `.glb` file. The pipeline already supports it end to end and has since
Phase 2: `CharacterFactory` has the glTF branch, `ClipResolver` maps clip names,
sockets are declared in the manifest. Dropping one in is a JSON edit, not an
integration.

What it needs:

- **Format**: glTF 2.0 binary (`.glb`), Y-up, metres, character 1.6–1.8 m tall,
  **feet at the origin**, facing **+Z**
- **Rig**: humanoid, ≤ 64 bones, ≤ 4 influences per vertex, one skeleton
- **Root motion baked out** — code drives translation, clips are in-place
- **Clips**, 30 fps, seamless loops: `idle`, `walk`, `run`, `jump_start`,
  `fall`, `land`, plus `carry_idle` / `carry_walk` / `carry_run` and `handoff`.
  Anything missing degrades through the manifest's `fallback` chain rather than
  breaking
- **Budget**: ≤ 12 k triangles, one 1024² texture
- **Sockets** as named bones: `hand_R` (the parcel), `back` (satchel), `head`

Sources that fit: Mixamo (free, auto-rigs and gives the whole clip set), a
VRoid/Blender export, or a commissioned model. Mixamo's naming is already in the
manifest as an example.

### 2. Failing that — textures for the current geometry

`RenCharacter` builds real geometry; it just has no maps. A 1024² albedo plus a
simple emissive mask for the glasses and gear trim would lift it a long way for
a fraction of the effort. This is the cheap option if a rigged model is not
available.

### 3. What will *not* fix it

More procedural geometry. The current model is already at the point where adding
boxes makes it busier, not better. The gap is materials and animation, not
polygon count.

## Honest ranking

If you can only find one thing:

1. **A rigged `.glb` of Ren** — transforms the thing players look at 100% of
   the time, and unblocks the animation gap that has been open since Phase 3.
2. **An HDR equirectangular panorama** — lights the whole scene, not just the
   backdrop.
3. A regular sky photo — useful, but it is a colour reference, not an asset.
