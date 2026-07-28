# LUMENPOST

> *A tiny planet. A bag full of light. Everyone's waiting.*

A cozy 3D browser game: you are a courier on the dimming planet of Fennwick,
and every parcel you deliver relights a piece of the world.

**Status: Phases 0–4 complete — playable, scored and cel-shaded.**

```bash
npm install
npm run dev          # http://localhost:5173
npm run test         # unit tests (Vitest)
npm run test:e2e     # movement smoke test (needs `npm run dev` running)
npm run test:play    # full delivery playthrough in a browser
npm run test:all     # typecheck + lint + unit + build
```

Controls: **WASD** to move, **Shift** to run, **Space** to jump, drag the mouse
to look. Gamepad and touch (floating joystick on the left half, drag to look on
the right) both work. The dev build shows a debug overlay with frame rate,
locomotion state and your position in the (lat, lon, alt) coordinates level data
is authored in.

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
- **Cel shading** with a generated gradient ramp, district silhouettes, and a
  sky that warms as the planet comes back
- 108 unit tests, two browser suites including a full scripted playthrough

Total payload: **1.67 MB gzipped** (200 kB JS + 1.25 MB audio) against a 6 MB budget.

Not yet built: composed music, bloom, ambience beds, main menu, authored art.
Phase 5 in [`docs/13-roadmap.md`](docs/13-roadmap.md).

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
