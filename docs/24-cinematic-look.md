# 24 — From cel-shaded to a painted valley

The brief was a reference shot: a Japanese valley at golden hour — backlit
haze, a mirror-still river, cherry trees like pink cloud, grass catching the
sun. The game was a cel-shaded lawn with ink outlines. This is the rebuild of
the look, and what each piece is for.

## What changed, in order of how much it bought

| | Was | Now | Where |
|---|---|---|---|
| Lighting model | `MeshToonMaterial`, 3 bands, ink outline pass | `MeshStandardMaterial`, lit by the sky as an environment map | `engine/render/WorldMaterial`, `stylise`, `game/world/Environment` |
| Air | Linear depth fog | Height mist (densest at sea level) + aerial haze + forward scattering toward the sun, in every material | `engine/render/Atmosphere` |
| Sky | Gradient + clouds | Same, plus a sun disk, a scattering halo that matches the fog's, clouds lit from the sun's side | `game/world/Skydome` |
| Ground | Faceted icosphere, flat vertex colour | Smooth normals, per-pixel noise in colour and roughness | `game/world/PlanetTerrain` |
| Grass | ~200 green cones per district | ~190 000 instanced clumps, wind, parting round the player, backlit tips | `game/world/GrassField` |
| Trees | Generated hulls (faceted red "rocks on sticks") | Procedural trunks + crowns of leaf cards with spherical normals, painted textures, wind | `game/world/Trees` |
| Water | Translucent toon sphere | Glassy PBR surface, six travelling wave trains, mirror reflections | `PlanetTerrain` water + `game/world/WaterReflection` |
| Post | Outline → bloom → AgX → vignette | MSAA → bloom → ACES → grade (lifted warm blacks) → vignette | `engine/render/PostFX`, `GradeEffect` |
| Lamps, rocks | Ball on a pole; dodecahedron | Paper andon on a wooden post; mossy boulder | `entities/props`, `entities/districtProps` |

## Three moods, one object

`Environment` owns sky, sun, ambient, haze and the environment capture
together, because they are one thing: the sky colour *is* the ambient light,
the haze in front of a hill *is* the horizon behind it. It blends three moods
by total illumination:

- **Dormant** (nothing lit): overcast, misty, the sun a pale disk.
- **Awake** (four districts): warm late afternoon, sun at 26°.
- **Golden** (all five): the reward — sun at 13° straight into the haze.

`node tools/shoot-moods.mjs <dir>` shoots the same six views in all three,
into and away from the sun, with frame times. Judge every lighting change
against all three: a tweak that flatters one routinely ruins another.

## Things that are not obvious

- **The atmosphere is installed by replacing three's four fog chunks** and a
  default `onBeforeCompile` on `Material.prototype` that hands every program
  the same uniform objects. Any material with its *own* `onBeforeCompile` must
  call `applyAtmosphere(shader)` or it renders without the air.
- **IBL is captured once per mood change and rotated per frame.** The sky is
  drawn in a canonical frame (local up = +Y) into a PMREM, and
  `scene.environmentRotation` turns it to the player's frame. three samples
  `M(−rotation)·dir`, so the stored Euler is the *negated* Euler of Bᵀ.
- **The sky is centred on the camera**, not the planet. Measured from the
  centre, directions were up to 10° off — invisible on a gradient, glaring
  once a sun disk and the fog's halo have to line up.
- **The mirror plane is chosen per frame** as the tangent plane at the water
  the camera is looking at. The sea is a 58.5 m sphere: 15 m out it has dropped
  2 m and tilted 14°, so no single plane fits it. The plane eases, so turning
  your head does not make the reflection jump.
- **Leaf textures are painted into pixel buffers**, not canvases, so the tree
  code runs in tests. Distant crowns used to dissolve because mip levels
  average the gaps into the leaves; alpha is scaled back up by mip level.
- **Software GL is detected and forced to the low tier.** The e2e suite runs
  on SwiftShader, which drew the grass field at a frame every few seconds and
  timed the smoke test out. So does any GPU-less machine a player might have.
- **Grass placement comes from the terrain mesh**, not `heightAt`: random
  points on the drawn triangles, weighted by a `grass` attribute painted
  alongside the colour — none on sand, rock, tracks or building footprints.

## Cost

RTX 5060 Ti, 1600×900, high tier, HUD hidden: 3–5 ms a frame in every mood
and view (`shoot-moods`). The HUD adds ~1.3 ms. Tier scaling: grass density
6.5 / 4.2 / 1.8 clumps per m², shadow map 2048 / 1024 / off, reflection at
½ / ⅓ resolution / off, MSAA 4× / 2× / off, post on / on / off.

## Still to do

- The Meshy bamboo and buildings are base-colour-only textures; they hold up,
  but normal maps would lift them.
- Day/night and weather (the reference's other two moods) are not built.
  Night with lanterns lit would suit the dormant planet well.
- The VRM player is MToon-shaded (anime); she reads fine against the valley
  but does not receive the atmosphere's sun glow.
- 32 street-lamp point lights are evaluated in every lit fragment even when
  off. If the frame ever gets tight on mobile, that is the first place to cut.
