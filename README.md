# LUMENPOST

> *A tiny planet. A bag full of light. Everyone's waiting.*

A cozy 3D browser game: you are a courier on the dimming planet of Fennwick,
and every parcel you deliver relights a piece of the world.

**Status: playable start to finish — five deliveries, a festival, and a
journal of things to find — drawn as an anime background is painted: cel
shading, an ink line, paper, and Fuji over the valley
([`docs/30`](docs/30-drawn-not-rendered.md)).**

```bash
npm install
npm run dev          # http://localhost:5173
npm run test         # unit tests (Vitest)
npm run test:e2e     # movement smoke test (needs `npm run dev` running)
npm run test:play    # full delivery playthrough in a browser
npm run test:all     # typecheck + lint + unit + build
```

Controls: **WASD** to move (she runs; hold **Shift** to walk — or turn that
round in Settings), **Space** to jump (tap for a hop), **E** to talk and pick
up, **C** for the postcard camera, **Tab** for the journal, mouse to look (the
game takes the pointer when you start or click it; **Esc** pauses and gives it
back). Gamepad works, and so does touch: a stick appears under the left thumb,
the right thumb looks, and Jump, Talk, Photo, Journal and Pause have buttons.
Add `?debug` to the address in a dev build for the overlay with frame rate,
locomotion state and your position in the (lat, lon, alt) coordinates level
data is authored in.

## What runs today

- Deterministic displaced-icosphere planet (60 m radius, ±6 m terrain) with a
  BVH built over it for collision and every raycast
- `SphericalCharacterController` — tangent-space movement, capsule
  depenetration, ground snapping, surface-normal orientation, coyote time and
  jump buffering
- `FollowRig` — third-person spring arm using **parallel transport**, so the
  camera never rolls or gimbals as local up rotates underneath you
- Fixed-timestep loop (60 Hz) with interpolated rendering
- Device-agnostic input, adaptive resolution, FOV-based responsive scaling,
  WebGL context-loss recovery
- Asset manager with manifest-driven bundles and reference counting
- Scene manager (a stack, so overlays keep the world loaded behind them)
- Web Audio engine with buses and sample-locked **stem-layered music**
- Versioned save with a migration chain, plus live settings
- DOM-overlay UI with a screen stack, focus management and design tokens
- **Character pipeline**: any character is a JSON manifest — rigged glTF or
  sprite atlas — with directional turnaround support for sprites
- **The delivery loop**: quests with a prerequisite graph, carry and hand-off,
  parcel warmth and ratings, dialogue, and the **illumination system** — every
  delivery lights a district, fades in a music stem and wakes its lamps
- Glide traversal with thermal columns; 25 collectible lumen shards
- Sparse HUD (compass, contract card, prompt, warmth-tinted parcel) and the
  Route Report win screen
- **Audio**: six sample-locked music stems that layer in as districts light,
  plus a full SFX set — all synthesised by `tools/generate-audio.mjs`
- **Particles**: pooled and instanced, one draw call — hand-off bursts, ignition
  motes, footstep puffs, landing dust
- **The look** ([`docs/24`](docs/24-cinematic-look.md)): physically based
  materials lit by the sky as an environment map; height mist, aerial haze and
  sun-glow scattering in every material; three lighting moods (overcast →
  afternoon → golden hour) blended by progress; ~190k instanced grass clumps
  with wind; procedural cherry, maple and cedar crowns; mirror-reflecting
  water; MSAA, bloom, AgX and a film grade
- Authored Japanese village (Meshy image-to-3D); collision with every house,
  trunk, gate post and lantern ([`docs/25`](docs/25-solid-world.md))
- The courier: the VRoid model (Aria), dressed in the burgundy and brown she
  likes, moving with captured animation (walk, run, a jump timed to the real arc, a
  jump for joy after each delivery) retargeted onto her rig at load
  ([`docs/27`](docs/27-aria-in-motion.md)). The Meshy model generated from
  the sheet ([`docs/26`](docs/26-the-heroine.md)) is the fallback
- Mount Fuji on the horizon: a backdrop that travels with the camera, the
  same size from anywhere ([`docs/29`](docs/29-frame-rate-fuji-on-the-horizon.md))
- Steady on integrated graphics: every static prop is culled per instance at
  the horizon, street lamps share a fixed pool of lights so no shader ever
  recompiles mid-game, and the quality tier is read from the GPU (override
  with `?quality=low|medium|high`) ([`docs/29`](docs/29-frame-rate-fuji-on-the-horizon.md))
- **A journal** ([`docs/30`](docs/30-drawn-not-rendered.md)): six stamps, eight
  keepsakes, six postcards taken with a camera that checks what is in frame,
  a timed round of lanterns, small talk with every resident — all data in
  [`src/data/activities.ts`](src/data/activities.ts) — and a standing that
  earns two things that change how the game plays
- **The festival**: the last delivery starts fireworks over the mountain
- 277 unit tests, two browser suites including a scripted playthrough

Payload today: 0.3 MB gzipped JS, 6.6 MB of models, 16.5 MB for the VRM plus
0.5 MB of captured clips, 2.2 MB of audio. Grass, trees, leaf textures, sky
and water are all generated at load. The 2.9 MB Meshy heroine is only
fetched if the VRM fails to load.

Not yet built: composed music, day/night and weather.
Phase 5 in [`docs/13-roadmap.md`](docs/13-roadmap.md).

## Looking at it

Lighting is judged in pictures, not numbers (dev server running):

```bash
node tools/shoot-moods.mjs out/     # 6 views × 3 moods, with frame times
node tools/shoot-lagoon.mjs out/    # the water and its reflections
node tools/shoot-world.mjs out/     # the original fixed viewpoints
node tools/shoot-player.mjs out/    # the courier in the game: back, front, three moods, walk, run, lantern
node tools/shoot-motion.mjs out/m   # her clips as a contact sheet, with foot slide measured
```

## Regenerating the audio

```bash
node tools/generate-audio.mjs        # writes public/assets/audio/{music,sfx}
```

Stems are 96 BPM, A minor, 20 s, and must stay identical in length — the
illumination hook depends on them being sample-locked. Replacing them with
composed music means dropping in files with the same names.

## Content

Districts, NPCs, contracts and dialogue all live in
[`src/data/content.ts`](src/data/content.ts). Adding a sixth district or
delivery is a data edit — no system knows how many there are.

## Character assets

See [`docs/15-character-pipeline.md`](docs/15-character-pipeline.md). To slice a
concept sheet into a game-ready atlas:

```bash
node tools/slice-character-sheet.mjs sheet.png tools/ren-cypher-regions.json out/
```

## Documentation

Start at **[`docs/00-index.md`](docs/00-index.md)**.

The full set covers the reference analysis, game design document, gameplay
specification, technical architecture, folder structure, asset specification and
checklist, state machines, scene flow, UI flow, class diagrams, event flow and
the development roadmap.

## Planned stack

| | |
|---|---|
| Renderer | Three.js (WebGL2) |
| Language | TypeScript 5 (strict) |
| Build | Vite 6 |
| Collision | `three-mesh-bvh` (no full physics engine) |
| Post FX | `postprocessing` (pmndrs) |
| UI | Lit 3 web components, DOM overlay |
| Audio | Web Audio API, stem-layered music |
| Test | Vitest + Playwright |

Three.js rather than Phaser 3 or PixiJS because the core mechanic — walking on
the outside of a sphere with a third-person orbit camera — requires a 3D
renderer. See [`docs/04-technical-architecture.md`](docs/04-technical-architecture.md).

## Targets

- 60 FPS desktop, 30 FPS floor on mobile
- ≤ 5.8 MB to first play, ≤ 15 MB total
- Desktop, tablet and phone; keyboard, gamepad and touch
- WCAG AA

## Attribution

Inspired by the *gameplay style and user experience* of
[Messenger](https://messenger.abeto.co/) by Abeto. No assets, code or content
are derived from it — this is an original implementation with original
mechanics, world, characters and art direction.
