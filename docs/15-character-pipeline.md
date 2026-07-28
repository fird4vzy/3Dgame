# 15 — Character Pipeline: Ren 'Cypher' Kairo

How the supplied concept sheet became a working in-game character, what the
pipeline does, and — importantly — where the supplied art runs out of road.

## What was supplied

A single flattened PNG contact sheet, **1408 × 768**, containing a hero pose,
a five-view turnaround, a T-pose, a 16-cell expressions grid, a 10-cell
animation-poses grid, a modular parts breakdown, a colour palette chart, and a
spec block reading *"2048×2048 PNG, sharp edges, centered pivot"*.

## Three things about that file

**1. The transparency is painted, not real.** The alpha channel measures
`min 255, max 255` across the entire image — fully opaque. Those checkerboards
are drawn pixels. Every sprite had to be cut out by keying, not by reading an
existing alpha channel.

**2. The resolution is roughly 1/20th of what the sheet's own spec asks for.**
The brief says 2048×2048 per asset; what arrived is a 1408×768 sheet containing
~40 assets. After slicing, the tallest gameplay pose is **112 px** and the
turnaround views are **~232 px**. That is a small retro sprite, not a hero
asset — it will read fine at distance and soften noticeably up close.

**3. There is one drawing per action, not an animation cycle.** `walk` is a
single frame, not eight. So locomotion currently holds a pose rather than
cycling. This is the single biggest gap between what exists and what the game
wants.

None of this is a criticism of the art — it is a *concept sheet*, and it is
doing exactly what a concept sheet is for. It simply is not a sprite sheet.

## What the pipeline does

`tools/slice-character-sheet.mjs` turns the sheet into a real atlas:

```bash
node tools/slice-character-sheet.mjs sheet.png tools/ren-cypher-regions.json out/
```

| Step | Why it is done this way |
|---|---|
| **Sample the backdrop** from the region's border ring | The panels use different greys; hard-coding one colour breaks on the next export |
| **Edge-connected flood fill** rather than a global colour key | Ren wears grey-green tactical gear on a grey backdrop. A global key punches holes straight through the jacket; filling only from the border removes background that is genuinely *connected to the outside* |
| **Auto-segment** cells by projecting the foreground mask onto each axis | Robust to the sheet being re-exported at a different size, unlike fixed grid maths |
| **Keep the largest connected component** per cell | Contact sheets carry divider lines and stray marks that survive the key and then inflate the sprite's bounding box |
| **Erode one edge ring, then bleed colour outward** | The anti-aliased silhouette pixels are half-backdrop. Left alone they render as a pale halo; erode removes them and the colour bleed stops mipmapping dragging grey back in |
| **Trim and shelf-pack** into one atlas + frames JSON | One texture, one draw call |

Result: **15 sprites** — a 5-view turnaround and 10 gameplay poses — packed into
`char_ren_cypher.png` (512 × 439, 213 kB gzipped) with genuine alpha.

## How it plugs into the game

Nothing about the controller, camera or collision changed. The character
arrives through the manifest contract from `06-asset-specification.md §6.2`:

```
src/data/characters/ren_cypher.character.json   →  loadCharacter()
                                                        ├── SpriteCharacter  (spritesheet)
                                                        └── MeshCharacter    (glTF)
```

Gameplay code calls `character.play('run')` and never learns which one it got.

### Directional sprites

A sprite cannot turn away from the camera, but a third-person camera on a
sphere orbits freely. So `BillboardCharacter` supports a **turnaround set**: five
frames ordered front → back, selected from the angle between the character's
facing and the viewer, mirrored for the other half of the circle. The supplied
turnaround feeds this directly, so idle reads correctly from any angle.

### `upright`, not `billboard`

A classic billboard rotates to face the camera on all axes. On a sphere that
shears visibly as you crest a hill, because "toward the camera" and "away from
the planet core" stop agreeing. `upright` locks the sprite's vertical axis to
the surface normal and yaws only about it. This is the default, and it is the
mode a spherical world requires.

## Honest limitations

| Limitation | Effect | Fix |
|---|---|---|
| One frame per action | Walk and run hold a pose instead of cycling | 6–8 frames per locomotion clip |
| 112 px gameplay sprites | Soft when the camera is close | Export at the spec'd 2048² |
| Turnaround only covers idle | Walk/run are side-view only, so they look wrong when viewed head-on | A turnaround per locomotion clip, or a rigged mesh |
| No skeleton | `getSocket()` returns null, so parcels cannot be attached to a hand | Carried props must be drawn into the art, or use glTF |
| Sprites cannot cast shadows meaningfully | Character reads as slightly detached from the ground | A blob-shadow decal, or a rigged mesh |

## The art-direction question

This is the thing worth deciding before more work goes in.

Ren 'Cypher' Kairo is a **32-year-old AR scout in dark tactical gear, cyberpunk,
green HUD glasses, carrying a drone and a pistol**. The game designed and
approved in `docs/02` is **Lumenpost**: a cozy, dusk-lit courier game about
delivering bottled light to villagers on a small planet, with no combat and no
fail state.

Those are two different games. The pipeline is direction-agnostic and the code
does not care — but the *content* does. Three options:

1. **Keep Lumenpost's direction**, and treat Ren as a test asset proving the
   pipeline. Commission a courier character in the cozy palette.
2. **Pivot the game to Ren's world** — a scout delivering data across a dim
   planet. Most systems survive; the GDD's tone, palette, districts and the
   illumination fiction would need rewriting.
3. **Use Ren as an NPC** — a technician in The Coil. His silhouette fits an
   industrial district, and sprite NPCs are exactly what the billboard adapter
   is best at.

I have wired him in as the player so the pipeline is demonstrably working
end-to-end. Which of the three we pursue is a call for you, not me.

## To re-run after new art arrives

1. Drop the new sheet somewhere and update `tools/ren-cypher-regions.json`
   (panel coordinates, background colour, cell names).
2. `node tools/slice-character-sheet.mjs <sheet> <regions> <out>`
3. Copy the atlas to `public/assets/characters/` and paste the generated
   `frames` block into the character manifest.

If instead you supply a **rigged glTF**, none of the above applies: write a
manifest with `"kind": "gltf"`, map the clip and socket names, and
`loadCharacter` takes the other branch. That remains the recommended path for
the player character.
