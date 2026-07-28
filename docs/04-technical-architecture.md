# 04 — Technical Architecture

**Deliverable 3 of 12.**

## 4.1 Framework choice — and why *not* Phaser or Pixi

**Recommendation: Three.js (r17x, WebGL2) + TypeScript + Vite.**

You listed Phaser 3 and PixiJS as preferences. I want to be direct about why
neither can be used here, because it is the single most consequential decision
in this document:

**Phaser 3 and PixiJS are 2D renderers.** They have no depth buffer, no
perspective camera, no 3D scene graph, no skeletal mesh animation, no lighting
model. The reference's defining feature — *walking on the outside of a sphere
with visible curvature, gravity toward the core, and a third-person orbit
camera* — is not a thing you can approximate in a 2D renderer. Neither can the
cel-shaded lighting or the district ignition effect. Choosing Phaser here would
mean building a different, lesser game. (This is consistent with the repository
being named `3Dgame`.)

Among 3D options:

| Option | Verdict |
|---|---|
| **Three.js** | ✅ **Chosen.** ~150 KB gz core, tree-shakeable, the de-facto standard for web 3D. Best-in-class ecosystem for exactly what we need: `three-mesh-bvh` (fast collision raycasts against terrain), `postprocessing`, mature glTF/Draco/Meshopt/KTX2 loaders, `AnimationMixer`. Unopinionated about game structure, which lets us impose the clean architecture below rather than fight a framework's. It is also what the reference itself uses, which de-risks the perf targets — a 5.7 MB, 60 FPS, mobile-capable browser game on this stack is *demonstrated*, not hoped for. |
| Babylon.js | Capable and more batteries-included (built-in physics, inspector, GUI), but ~1.5 MB baseline and a heavier, more prescriptive object model. The download budget is a product feature (Pillar 4); Babylon spends it on features we would mostly disable. |
| React Three Fiber | Excellent for scene-graph-as-UI apps, wrong for this. It couples the render loop to React's reconciler and adds per-frame overhead and a mental-model tax for a canvas-first, imperative, fixed-timestep game. We use plain Three.js and reserve React/Lit for DOM UI only. |
| PlayCanvas / Unity WebGL / Godot Web | PlayCanvas is genuinely good but editor-centric and less portable as a code-first repo. Unity/Godot web exports start at 10–25 MB with long WASM warm-up — disqualified by Pillar 4 alone. |

### Supporting stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.x, `strict`, `noUncheckedIndexedAccess` | Non-negotiable for a codebase meant to grow |
| Build | Vite 6 + `vite-plugin-glsl` | Instant HMR, esbuild dev, Rollup prod, easy manual chunking |
| Collision | `three-mesh-bvh` | Capsule-vs-BVH + raycasts. **No full physics engine** — our movement is kinematic and deterministic; Rapier/Ammo would add 400 KB–1 MB of WASM for solver features we never use. A `IPhysicsBackend` interface keeps Rapier a drop-in option if ragdolls or vehicles are ever needed |
| Post-processing | `postprocessing` (pmndrs) | Merges effect passes into one shader — materially cheaper than chained `EffectComposer` passes on mobile |
| Audio | Custom `AudioManager` on Web Audio API + `THREE.AudioListener` | ~250 LOC gets us buses, stem-layered music, positional SFX and correct mobile unlock. Howler.js is the alternative but adds a dependency for less control over the stem crossfades that Pillar 1 depends on |
| DOM UI | **Lit 3** | ~5 KB, standards-based web components, scoped styles, reactive. UI is DOM-overlay, not in-canvas |
| State | Custom typed `EventBus` + `Store` | No Redux/Zustand needed; the game is not a form app |
| Tooling | ESLint + Prettier + Vitest + Playwright + `size-limit` | `size-limit` runs in CI and **fails the build** if the boot bundle exceeds budget |

### Why DOM UI instead of in-canvas UI

Crisp text at every DPI without texture atlases; real accessibility (focus
order, screen readers, `prefers-reduced-motion`); CSS handles responsive layout
and safe-area insets for free; and it costs zero draw calls. The canvas is for
the world; the DOM is for the interface. They communicate **only** through the
`EventBus` and a read-only `GameState` store — so replacing Lit with anything
else is a contained change.

## 4.2 Layered architecture

Dependencies point **downward only**. Nothing in `engine/` may import from
`game/`; this is enforced by an ESLint `no-restricted-imports` rule, not by
convention.

```
┌───────────────────────────────────────────────────────────┐
│ app/          bootstrap, DI container, config, brand      │
├───────────────────────────────────────────────────────────┤
│ ui/           Lit components, screens, HUD, theme         │
├───────────────────────────────────────────────────────────┤
│ game/         scenes, entities, components, gameplay      │
│               systems (quests, dialogue, illumination)    │
├───────────────────────────────────────────────────────────┤
│ engine/       loop, renderer, scene mgr, assets, audio,   │
│               input, collision, animation, save, pooling  │
├───────────────────────────────────────────────────────────┤
│ core/         EventBus, Store, Service locator, math,     │
│               FSM, logger, result types                   │
└───────────────────────────────────────────────────────────┘
```

**SOLID in practice here:** every manager is an interface in `engine/*/types.ts`
with one production implementation, resolved through a small typed service
container (`core/di`). That is what makes the systems testable in Vitest without
a GPU, and what makes "swap the asset pipeline" or "swap Lit for Preact" a
one-file change rather than a refactor.

## 4.3 Entity model — component-oriented, not ECS

An `Entity` wraps a `THREE.Object3D` and owns a list of `Component`s with
`onAttach / fixedUpdate / update / lateUpdate / onDetach` hooks (Unity-like).

**Why not a data-oriented ECS?** Our entity count is ~200, not ~200,000. A real
ECS would buy cache locality we do not need and cost every future contributor a
week of ramp-up. Where we *do* have high counts — particles, foliage, emotes,
audio voices — we bypass the entity model entirely and use pooled flat arrays
with `InstancedMesh`. That is the pragmatic split, and it is stated here so
nobody "upgrades" it later without a measured reason.

## 4.4 The game loop

Fixed-timestep simulation with an accumulator, variable-rate render, and state
interpolation:

```ts
const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.25;              // anti spiral-of-death clamp

function frame(now: number) {
  const frameTime = Math.min((now - last) / 1000, MAX_FRAME);
  last = now; accumulator += frameTime;

  input.beginFrame();
  while (accumulator >= FIXED_DT) {
    world.fixedUpdate(FIXED_DT);     // controller, physics, quests
    accumulator -= FIXED_DT;
  }
  const alpha = accumulator / FIXED_DT;
  world.update(frameTime);           // animation, camera, particles
  world.interpolate(alpha);          // smooth transforms for render
  world.lateUpdate(frameTime);       // camera follow after transforms settle
  renderer.render();
  input.endFrame();                  // roll edge-triggered state
  requestAnimationFrame(frame);
}
```

Fixed-step is required for the character controller: without it, collision
resolution and jump arcs vary with frame rate, and a 144 Hz monitor plays a
different game than a 30 FPS phone.

## 4.5 The engine subsystems

### SceneManager

A **stack**, not a list — so Pause can overlay Gameplay without unloading it.

```
push(scene)  → load assets → onEnter → transition in
pop()        → transition out → onExit → optional unload
replace(s)   → pop + push under one transition
```

Every `IScene` declares `assetBundles: string[]`; the manager resolves them
through `AssetManager` before `onEnter`, and releases ref-counts on unload.
Transitions are driven by a `TransitionService` (lumen iris wipe, 450 ms).

### AssetManager

Manifest-driven, bundle-scoped, reference-counted.

- `assets/manifest.json` declares bundles → assets → { url, type, priority }.
- Bundles: `boot` (logo, font, UI sprites, loading shader), `core` (player,
  terrain, shaders, UI SFX), `world` (props, NPCs, district atlases), `audio_*`,
  `cosmetics` (loaded on first wardrobe open), `emotes`.
- Loaders: GLTF (+ Meshopt + KTX2 transcoder), Texture, Audio, JSON, Font.
- Ref-counting: `acquire(bundle)` / `release(bundle)`; a bundle at zero refs is
  disposed (geometry, material, texture `.dispose()`) — this is where WebGL
  memory leaks come from, so it is centralised in exactly one place.
- Progress: aggregate byte-weighted `asset:progress` events for the loading bar.
- **Content-hashed filenames** + long cache headers, so a returning player
  re-downloads only what changed.

### AnimationManager / AnimationController

`AnimationManager` owns all `AnimationMixer`s and ticks them once per frame.
Per-entity `AnimationController` is a small FSM over a blend tree:

```
Locomotion (1D blend by planarSpeed): idle → walk → run
  ├─ Carry layer   (additive/override on upper body when carrying)
  ├─ Look-at layer (additive head/spine toward interest point)
  └─ States: jump_start · fall · land · glide_in · glide · glide_out
             · handoff · emote_* · sit · celebrate
```

Clip names are resolved through the **character manifest**
(`06-asset-specification.md §6.2`) — never hard-coded. That indirection is what
makes your future character assets a drop-in.

### AudioManager

Web Audio graph: `source → panner? → busGain → masterGain → destination`.
Buses: `music`, `sfx`, `ambience`, `ui`, `voice`.

- **Stem-layered music**: one synchronised set of loops, each on its own gain
  node, all started together and held sample-accurate; district ignition
  ramps a stem 0 → 1 over 2.5 s. This is what makes the score build as the
  planet lights up (Pillar 1) — and it only works if stems are started
  together, which is why it is an engine feature and not a gameplay hack.
- Positional SFX via `PannerNode` (HRTF off on mobile — measurable CPU cost).
- Voice pooling with a 24-voice cap and priority stealing.
- Mobile unlock on first user gesture; auto-duck on `visibilitychange`.
- Formats: `.webm/opus` primary, `.m4a/aac` fallback (Safari).

### InputManager

Device-agnostic **action map**. Gameplay code asks for actions, never keys:

```ts
input.getAxis2D('move')        // -1..1, from WASD | stick | virtual joystick
input.getAxis2D('look')
input.isDown('run')
input.wasPressed('jump')       // edge-triggered, buffered
```

Backends: Keyboard, Mouse (drag + Pointer Lock), Gamepad (standard mapping,
deadzone + response curve), Touch (floating joystick, right-half look drag,
on-screen buttons). Active device is auto-detected and published as
`input:deviceChanged`, which drives which glyphs the UI shows. Rebinding writes
to `SettingsManager`, which persists to the save file.

### CollisionSystem

- Terrain and static colliders are merged into **one BVH** (`three-mesh-bvh`)
  built once at load; ~1.5 ms build for our world, then O(log n) queries.
- Character: capsule (r 0.35, h 1.6) vs BVH via `shapecast`, iterative
  depenetration (max 4), slide along contact plane, ground snap.
- Trigger volumes: spheres/boxes with `onEnter/onExit`, tested against a
  spatial hash of 8 m cells.
- Interactables: same spatial hash; see `03 §3.5` for candidate scoring.
- Debug: BVH wireframe + capsule gizmo behind the `?debug` flag.

### GameStateManager

A hierarchical FSM (`core/fsm`) for the global game state, plus the quest graph:

`Boot → Preload → MainMenu → Playing ⇄ Paused ⇄ Dialogue ⇄ Cinematic → Complete`

Quest state is a small directed graph: contracts declare `prerequisites`, and
`QuestSystem` recomputes the available set whenever one completes. Adding a
sixth contract is a JSON file plus assets — no code.

### SaveManager

- Storage: `localStorage` (saves are < 8 KB), debounced 800 ms, plus a flush on
  `pagehide`. IndexedDB is unnecessary and slower to open.
- **Versioned schema with a migration chain** — `migrations: Record<number, (s)
  => S>` applied in order. Shipping without this guarantees a save-wipe on the
  first content patch.
- Content: progress (contracts, districts lit, shards), cosmetics, settings,
  stats, `schemaVersion`, checksum. Corrupt or unmigratable → back up under
  `lumenpost.save.corrupt.<ts>`, start fresh, tell the player.
- Autosave on every contract completion, district ignition and settings change.

### UIManager

Owns a DOM overlay above the canvas and a **screen stack** mirroring
`SceneManager`'s. Handles focus trapping, Esc-to-back, gamepad navigation
(spatial focus movement), `env(safe-area-inset-*)`, and a global UI scale
custom property. Screens are Lit components that receive a read-only view of
`GameState` and emit intents on the `EventBus` — they never mutate game state
directly.

### ScalingService (responsive)

Canvas fills the viewport; **aspect ratio is preserved by adapting FOV, not by
letterboxing**, so phones in portrait see a taller slice rather than black bars:

```ts
// Keep horizontal framing constant across aspect ratios
camera.fov = 2 * atan(tan(BASE_VFOV / 2) * (BASE_ASPECT / aspect));
camera.fov = clamp(camera.fov, 45°, 82°);
```

- DPR clamped to 2 (desktop) / 1.5 (mobile), with **dynamic resolution scaling**:
  if the 30-frame rolling average drops below 55 FPS, scale the render target by
  0.9 (floor 0.65); recover at 0.02/s when comfortably above.
- `ResizeObserver` + `visualViewport` (handles mobile URL-bar collapse
  correctly, which `window.resize` does not).
- Orientation: both supported; portrait moves the HUD to a vertical layout and
  raises the camera pitch slightly.

### Quality tiers

Detected at boot from DPR, `hardwareConcurrency`, `deviceMemory`, and a
`WEBGL_debug_renderer_info` heuristic; user-overridable in Settings.

| | Low | Medium | High |
|---|---|---|---|
| Shadows | off (baked AO only) | 1024 PCF | 2048 PCSS |
| Post FX | grade + vignette | + bloom, outline | + SSAO, DOF |
| Foliage instances | 400 | 1,600 | 4,000 |
| DPR cap | 1.0 | 1.5 | 2.0 |
| Anisotropy | 1 | 4 | 8 |
| Texture tier | 512/1024 | 1024 | 1024/2048 |

## 4.6 Rendering pipeline

1. **Shadow pass** (tiers ≥ Medium), cascade-free single directional light —
   the world is small enough for one tight ortho frustum.
2. **Opaque pass** — custom cel-shaded material: `NodeMaterial`-style ramp
   lighting (2–3 bands), rim light, and a per-district `saturation` +
   `lightLevel` uniform driven by `IlluminationSystem`.
3. **Outline** — inverted-hull on hero meshes (cheap, art-directable per object)
   rather than a full-screen normal/depth edge pass, which is more expensive and
   outlines everything indiscriminately.
4. **Transparent pass** — water, particles, glow sprites.
5. **Post** — single merged effect pass: bloom → colour grade (LUT) → vignette
   → optional film grain.

**Planet-specific optimisation:** because the world is a sphere, anything on the
far side is guaranteed invisible. Before frustum culling we run a **horizon
cull** — `dot(normalize(objPos), playerUp) < horizonThreshold` → `visible =
false`. One dot product per object removes roughly half the scene at zero cost,
which is a trick a flat world does not get to use.

## 4.7 Performance strategy

Budgets (enforced, not aspirational):

| Metric | Desktop | Mobile |
|---|---|---|
| Frame rate | 60 FPS | 60 target / 30 floor |
| Draw calls | ≤ 150 | ≤ 90 |
| Triangles on screen | ≤ 300 k | ≤ 120 k |
| Boot bundle (gz) | **≤ 6 MB** | ≤ 6 MB |
| Total download | ≤ 20 MB | ≤ 20 MB |
| JS heap | ≤ 350 MB | ≤ 250 MB |
| Time to interactive | ≤ 3 s | ≤ 5 s (4G) |

Techniques: `InstancedMesh` for all foliage and repeated props; static geometry
merged per district; KTX2/Basis textures with per-district atlases; Meshopt
compression on all glTF; object pooling for particles, emotes, floating text,
decals and audio voices; horizon + frustum + distance culling; three LODs on
hero props; lazy bundle loading; `AnimationMixer` culling for off-screen NPCs
(they tick at 15 Hz beyond 20 m); and zero per-frame allocation in hot paths —
scratch vectors are module-level singletons, which we enforce by review.

CI runs `size-limit` against the boot budget and fails the build on regression.

## 4.8 Testing, tooling, quality gates

- **Vitest** for pure logic: math, FSM, quest graph, save migrations, warmth
  decay, input action mapping, spatial hash. All GPU-free.
- **Playwright** smoke: boot → main menu → start → walk 3 s → screenshot; plus
  a WebGL context-loss recovery test.
- **Visual regression** on UI screens across three viewports.
- ESLint (strict + import-boundary rules), Prettier, `tsc --noEmit`, all in CI.
- Dev-only tooling behind `import.meta.env.DEV` (tree-shaken from prod): stats
  overlay, `lil-gui` tuning panel bound to `tuning.ts`, free-fly camera, BVH
  and collider visualisation, quest-state jump-to, illumination scrubber.

## 4.9 Deliberately out of scope for v1

Multiplayer presence, leaderboards, cosmetics store, Storm Run. Each has a
reserved seam (`NetworkManager`, `LeaderboardService`, `CosmeticsService`,
alternate `GameMode`) so Phase 7 is additive, not surgical.
