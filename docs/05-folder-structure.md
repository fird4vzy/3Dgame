# 05 — Folder Structure

**Deliverable 4 of 12.**

```
3Dgame/
├── docs/                              # this design set (01–13)
├── public/                            # served verbatim, not bundled
│   ├── assets/
│   │   ├── manifest.json              # bundle → asset graph (AssetManager reads this)
│   │   ├── models/
│   │   │   ├── characters/            # pip.glb, npc_*.glb  (your assets land here)
│   │   │   ├── environment/           # terrain.glb, district props
│   │   │   └── props/                 # parcels, lamps, collectibles
│   │   ├── textures/
│   │   │   ├── atlas/                 # *.ktx2 district atlases
│   │   │   ├── ui/                    # ui-sprites.png + .json
│   │   │   ├── particles/             # soft_dot.png, spark.png, smoke.png
│   │   │   └── lut/                   # grade_dusk.png, grade_lit.png
│   │   ├── audio/
│   │   │   ├── music/                 # stems: stem_bass, stem_guitar, …
│   │   │   ├── sfx/                   # footsteps, ui, gameplay
│   │   │   └── ambience/              # per-district loops
│   │   ├── fonts/                     # *.woff2 (subset)
│   │   └── icons/                     # *.svg
│   ├── favicon.svg
│   └── og-image.png
├── src/
│   ├── main.ts                        # entry: builds container, starts Game
│   ├── app/
│   │   ├── Game.ts                    # composition root / bootstrap
│   │   ├── container.ts               # typed service registrations
│   │   └── bootstrapErrors.ts         # WebGL-unsupported / fatal fallback UI
│   ├── config/
│   │   ├── brand.ts                   # title, colours, links (rebrand = 1 file)
│   │   ├── tuning.ts                  # ALL gameplay numbers (hot-reloadable)
│   │   ├── quality.ts                 # tier definitions + detection
│   │   └── constants.ts               # PLANET_RADIUS, GRAVITY, layers, tags
│   ├── core/                          # zero game knowledge, zero Three.js
│   │   ├── di/                        # ServiceContainer, tokens
│   │   ├── events/                    # EventBus.ts, EventMap.ts (typed contract)
│   │   ├── state/                     # Store.ts, computed, subscribe
│   │   ├── fsm/                       # StateMachine.ts, State.ts
│   │   ├── math/                      # spherical.ts, springs.ts, easing.ts, rng.ts
│   │   ├── pool/                      # ObjectPool.ts, Poolable.ts
│   │   ├── result/                    # Result<T,E>, invariant()
│   │   └── log/                       # Logger.ts, levels, dev sinks
│   ├── engine/                        # game-agnostic, reusable across projects
│   │   ├── loop/                      # GameLoop.ts, Time.ts
│   │   ├── render/                    # RendererService, PostFX, CelMaterial,
│   │   │                              #   OutlinePass, HorizonCuller
│   │   ├── scene/                     # SceneManager.ts, IScene.ts, Transition
│   │   ├── assets/                    # AssetManager, loaders/, Manifest, RefCount
│   │   ├── audio/                     # AudioManager, Bus, MusicDirector(stems)
│   │   ├── input/                     # InputManager, ActionMap, backends/
│   │   ├── physics/                   # BVHWorld, CapsuleController, SpatialHash,
│   │   │                              #   Triggers, IPhysicsBackend
│   │   ├── anim/                      # AnimationManager, AnimationController,
│   │   │                              #   BlendTree, ClipResolver
│   │   ├── entity/                    # Entity.ts, Component.ts, World.ts
│   │   ├── save/                      # SaveManager, schema.ts, migrations/
│   │   ├── settings/                  # SettingsManager, defaults
│   │   ├── i18n/                      # Localization.ts, locales/
│   │   ├── vfx/                       # ParticleSystem, InstancedEmitter, Decals
│   │   └── platform/                  # Viewport, DeviceDetect, Fullscreen,
│   │                                  #   Visibility, ContextLossGuard
│   ├── game/                          # everything LUMENPOST-specific
│   │   ├── scenes/                    # BootScene, PreloadScene, MainMenuScene,
│   │   │                              #   PlanetScene, EndingScene
│   │   ├── entities/                  # PlayerEntity, NpcEntity, ParcelEntity,
│   │   │                              #   LampEntity, ShardEntity
│   │   ├── components/                # SphericalCharacterController, CarryComponent,
│   │   │                              #   GlideComponent, InteractableComponent,
│   │   │                              #   NpcBrain, FootstepComponent
│   │   ├── camera/                    # CameraDirector, FollowRig, DialogueCam,
│   │   │                              #   GlideCam, CinematicCam
│   │   ├── systems/                   # QuestSystem, DialogueSystem, DeliverySystem,
│   │   │                              #   IlluminationSystem, InteractionSystem,
│   │   │                              #   WarmthSystem, ShardSystem, ScoreSystem
│   │   ├── world/                     # Planet.ts, PlanetTerrain, DistrictRegistry,
│   │   │                              #   Thermals, WaterVolume, SpawnPlacer
│   │   └── state/                     # GameStateManager, ProgressStore, RunStats
│   ├── ui/
│   │   ├── UIManager.ts               # screen stack, focus, safe areas
│   │   ├── screens/                   # Loading, MainMenu, Pause, Settings,
│   │   │                              #   Wardrobe, RouteReport, Credits
│   │   ├── hud/                       # CompassRibbon, ContractCard, PromptChip,
│   │   │                              #   EmoteWheel, TouchControls, Toast
│   │   ├── components/                # ui-button, ui-slider, ui-toggle, ui-modal,
│   │   │                              #   ui-dialogue-card, ui-progress
│   │   ├── theme/                     # tokens.css, typography.css, motion.css
│   │   └── glyphs/                    # per-device input glyph mapping
│   ├── data/                          # pure content — designers edit these
│   │   ├── contracts/                 # c01…c05.json
│   │   ├── dialogue/                  # *.json node graphs
│   │   ├── districts/                 # bramblewood.json … (lighting, stems, bounds)
│   │   ├── characters/                # pip.character.json, npc_*.character.json
│   │   ├── placements/                # props/NPCs as { lat, lon, alt, yaw }
│   │   └── cosmetics/                 # outfit definitions
│   └── shaders/                       # *.vert, *.frag, *.glsl (vite-plugin-glsl)
├── tools/
│   ├── asset-pipeline/                # gltf → meshopt, png → ktx2, atlas packer
│   ├── audio-pipeline/                # wav → opus/aac, loudness normalise
│   └── validate-manifest.ts           # CI: manifest ↔ disk ↔ budget check
├── tests/
│   ├── unit/                          # Vitest
│   └── e2e/                           # Playwright
├── .github/workflows/ci.yml
├── index.html
├── vite.config.ts
├── tsconfig.json
├── .eslintrc.cjs                      # includes layer-boundary import rules
├── package.json
└── README.md
```

## Rules that keep this clean

1. **`core/` knows nothing.** No Three.js import, no game concepts. Pure TS,
   100% unit-testable.
2. **`engine/` is portable.** It could ship as a package and power a different
   game. It must never import from `game/` or `ui/`.
3. **`game/` owns the rules.** It may use `engine/` and `core/`.
4. **`ui/` never mutates game state.** It reads a projection of `GameState` and
   emits intents on the `EventBus`.
5. **`data/` is content, not code.** Adding a contract, district, NPC or outfit
   must require *zero* code changes. This is the test for whether the
   architecture actually delivered on "easy to expand."
6. **`config/tuning.ts` holds every magic number.** If a numeric literal
   controls feel and lives outside this file, that is a review comment.

Enforced in `.eslintrc.cjs`:

```js
'no-restricted-imports': ['error', { patterns: [
  { group: ['**/game/**', '**/ui/**'], message: 'engine/ and core/ must not depend on game/ or ui/' },
]}]
```
