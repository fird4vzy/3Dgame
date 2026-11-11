# 30 — Drawn, not rendered: movement, sky, the mountain, a journal

One pass over the whole game against a list of complaints: movement that did
not feel smooth, a sky that slid when the player walked, blurred houses, a
strange Fuji, too little to do, and an interface that did not belong to the
world. Each was traced to a cause and measured before anything was changed.

## What was actually wrong

| Complaint | Cause | Measured before | After |
|---|---|---|---|
| Movement jitters | The camera followed an interpolated position; the body was drawn at the raw 60 Hz step. At any frame rate that is not 60 the two slide against each other. | body vs camera: 5.9 cm peak jitter per frame, up to 9 cm apart | 0.07 cm rms, 0.00 cm apart |
| Camera feels late | The spring was on the camera's *position*, so mouse look went through it too, and at a run the camera fell behind | arm 5.1–5.3 m for a 4.5 m setting | rotation is unsmoothed; only the pivot follows on a spring |
| Vertical look backwards | Pushing the mouse away looked down; the "invert" setting was wired to nothing | — | away looks up; the setting works |
| Sky moves when she walks | Clouds and sun were laid out against a compass (world +Y projected); the camera heading is parallel-transported. They disagree by `tan(lat)/R` per metre east–west | −13.3° in 3 s of running east; the mountain 0° | 0.00° (`skyFrame.carryTangent`) |
| Houses blurred | 512² map per building, anisotropy 1, frame drawn at 1382×777 and stretched, heavy haze, nothing drawing the edges | — | anisotropy 8, ink contour at screen resolution, sharpening, haze cut to a third |
| Fuji strange | Summit 7° over the planet's *rim* — which is 13° below eye level — so the whole mountain was below the horizon; no layers in front of it; lit like an object | — | painted in the sky's shader, summit 12.5° above eye level, two ridges and mist in front |
| Frame rate | Every house in a district drawn whether in view or not, and again into the shadow map; seven punctual lights in every physically shaded fragment; the sky shaded under everything and then painted over | 50–52 fps, resolution already scaled down to as low as 1075×604; ~1.0–1.2 M triangles | ~60 fps at the full 1536×864 budget; 0.67–0.74 M triangles |
| Dead controls | Look sensitivity, invert Y, camera shake and subtitles did nothing; the pause screen's statistics were literals; shards were never saved | — | wired, or removed |
| Unplayable on a phone | Touch moved and looked, but nothing was drawn and there was no way to jump, talk or pause | — | `ui/hud/TouchControls` |
| Jump dead below ~7 fps | Found on the way: a press was aged by the whole frame before any fixed step read it | — | a press does not age in the frame it arrives in |

Measurements are from Playwright's Chrome on the development laptop (Intel
integrated graphics, medium tier, 1600×900 window), both versions back to
back on mains power. On battery the same machine throttles the GPU to roughly
half and nothing measured there is comparable.

## The look

The world is cel-shaded again (`engine/render/WorldMaterial`): a lit tone, a
half-tone and a shadow tone from one shared ramp, with the hemisphere light
as the shadow colour. On top, `InkEffect` draws a contour from the depth
buffer alone — the second difference of perspective depth is zero on any flat
surface and non-zero where surfaces meet — adds paper grain, and sharpens the
upscaled frame. Grass and leaves write zero alpha (`NO_INK`) and are left
without a contour. Tone mapping is neutral rather than AgX, so colours arrive
as chosen.

The sky (`world/Skydome`) is painted like a background plate: cumulus in two
flat tones, standing along the horizon and scattered overhead, and behind the
planet a far country — a wooded ridge, a paler one, mist between them, and
Fuji (`world/Fuji`, as plain functions so the silhouette is tested). It is
drawn *after* the world with a depth test, so pixels the world covers are
never shaded.

## Things to do

`data/activities.ts` holds all of it; `systems/JournalSystem` keeps score;
`world/Activities` builds the places.

- **Stamps** — six stands at places worth having been to.
- **Keepsakes** — eight mislaid souvenirs, each with a hint in the journal.
- **Postcards** — a camera (C): six subjects, checked by what is actually in
  frame and not hidden by the ground. The picture is kept in the album.
- **The Lamplighter's Round** — ring a bell, light seven lanterns in order
  against the clock. Medals, no failure.
- **Small talk** — every resident has something to say when there is no
  parcel between you, and something else once their district is lit.
- **Standing** — every entry, delivery and medal is a point. Five points earn
  the Lumen Compass (shards and keepsakes on the dial); twelve earn the Wind
  Sandals (12% faster).
- **The festival** — the frame for all of it. The last delivery starts
  fireworks over the mountain, and they go on for as long as the planet is lit.

## What tests could not see

- The backwards vertical look: nothing asserted a direction.
- The jump dying at low frame rates only showed in the smoke suite, which
  runs on a software rasteriser at four frames a second — and at first looked
  like the suite's own flakiness.
- A real click on a button that takes the pointer lock hangs the test driver;
  the suites click such buttons through the DOM.

## Still open

- The houses are still 512² Meshy bakes. The contour and filtering make them
  read as drawn; real detail needs new models (see the asset list in the
  hand-over notes).
- Shadows still shimmer slightly at the edge of the shadow box as she walks:
  the sun is carried with her, so the light's frame turns a degree a metre.
- Frustum-culled props are missing from the water's mirror when they are
  outside the main view.
- The Bramblewood view is the heaviest: 43–50 fps on the test laptop.
- No gamepad was available: stick look rates are computed, not felt.
