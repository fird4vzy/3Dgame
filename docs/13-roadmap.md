# 13 — Development Roadmap

**Deliverable 12 of 12.** Estimates assume one full-time engineer with art and
audio arriving as scheduled. The ordering is chosen so the riskiest unknown —
does spherical traversal actually *feel* good — is answered in week 3, not
week 9.

## Phase 0 — Foundation · ~1 week

Repo scaffolding (Vite, TS strict, ESLint with layer-boundary rules, Prettier,
Vitest, Playwright, CI); `core/` complete (EventBus, Store, FSM, DI, math,
pooling, logger); engine skeleton (GameLoop with fixed timestep, RendererService,
ScalingService, platform services); debug overlay and `lil-gui` tuning panel;
`size-limit` budget gate wired into CI.

**Exit:** a black canvas rendering at 60 FPS with stats, hot reload, green CI.

## Phase 1 — Planet & Player · ~1.5 weeks · ⚠️ highest-risk phase

Procedural sphere terrain with displacement and district vertex masks; BVH world
build via `three-mesh-bvh`; `SphericalCharacterController` (tangent-space
movement, capsule collision, ground snap, surface orientation); `CameraDirector`
+ `FollowRig` with **parallel-transported yaw** (see `03 §3.4` — this is the
part that will take three attempts); `InputManager` with keyboard/mouse and
gamepad; placeholder capsule character with the full clip set.

**Exit — the vertical slice gate.** You can walk and run around the whole
planet, the horizon reads correctly, the camera never rolls or snaps, and it
holds 60 FPS on desktop. *If this does not feel good, stop and re-tune before
building anything on top of it.*

## Phase 2 — Engine systems · ~1.5 weeks

`AssetManager` (manifest, bundles, ref-counting, GLTF/KTX2/Meshopt/audio
loaders, progress); `SceneManager` + transitions; `AudioManager` with buses,
positional SFX and the stem-based `MusicDirector`; touch input backend and
on-screen controls; `SaveManager` with versioned migrations; `SettingsManager`;
`UIManager` shell with the screen stack; `i18n` scaffolding; `ObjectPool` and
`ParticleSystem`.

**Exit:** Boot → Preload → Menu → Planet → Pause → Menu all work, with save and
settings persisting, on a phone.

## Phase 3 — Gameplay · ~2 weeks

`QuestSystem` (data-driven contracts), `DeliverySystem`, `WarmthSystem`,
`InteractionSystem` with spatial hash, `DialogueSystem`, carry mechanics with
socket attachment, `GlideComponent` and thermals, `IlluminationSystem` with the
full ignition sequence, `ShardSystem`, `ScoreSystem` and the Route Report.

**Exit:** all five contracts completable end-to-end with placeholder art. **The
game is playable and the loop can be judged.** Playtest here, not later.

## Phase 4 — Art & content · ~2.5 weeks (parallel with art delivery)

Cel-shaded material and inverted-hull outline; post-processing stack (bloom,
LUT grade, vignette, optional SSAO); five districts built and dressed; NPC
placement and idle schedules; **integration of your character assets** through
the manifest contract; water shader; sky; VFX passes; music stems and full SFX
set; ambience.

**Exit:** the game looks like the screenshots you would ship.

## Phase 5 — UI & polish · ~1.5 weeks

All screens built and styled; transitions; the full juice pass (footsteps,
camera shake, particles, prompt pops, counter animations); accessibility
(keyboard/gamepad nav, screen-reader labels, reduced motion, colour-blind
markers, subtitle options); English locale extracted; photo mode; wardrobe.

**Exit:** WCAG AA, fully navigable without a mouse, no unstyled state anywhere.

## Phase 6 — Optimisation & QA · ~1 week

LODs and instancing pass; texture atlas consolidation; horizon culling; dynamic
resolution scaling; quality-tier auto-detection tuning; bundle splitting to hit
the ≤ 5.8 MB time-to-play budget; memory-leak audit on scene cycling; device
matrix testing (iPhone SE/13/15, Pixel 6a, mid Android, Safari/Chrome/Firefox,
Steam Deck); context-loss recovery; final loudness pass.

**Exit:** every budget in `04 §4.7` met on real hardware. Ship candidate.

## Phase 7 — Post-launch (optional, scoped later)

Multiplayer presence over WebSocket (position sync at 10 Hz with interpolation,
emoji-only communication — the reference's best social idea and its moderation
model); leaderboards for Route Report times; cosmetics store behind the existing
`CosmeticsService` seam; **Storm Run** challenge mode with a real fail state and
the already-built lose screen; districts 6–7 as a content drop; additional
locales.

---

## Timeline

```
Week   1    2    3    4    5    6    7    8    9   10   11
      ├─P0─┼──P1────┼──P2────┼────P3─────┼──────P4──────┼─P5──┼P6┤
                    ▲                    ▲                       ▲
             VERTICAL SLICE       PLAYABLE LOOP              SHIP CANDIDATE
             (does it feel      (is it fun? playtest)
              good? go/no-go)
```

**~11 weeks to a commercially polished release**, with two hard decision gates.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Spherical camera feels wrong (roll, gimbal, motion sickness) | **High** — it is the whole game | Solved first, in Phase 1; parallel-transport approach specified up front; budget three tuning passes and test on real users early |
| Character assets arrive late or in an unexpected format | Medium | The manifest contract + placeholder rig means every system is built and tested without them; integration is a JSON edit |
| Mobile performance below 30 FPS on low-end Android | Medium | Quality tiers and dynamic resolution from Phase 2, not bolted on; test on a real low-end device weekly from Phase 3 |
| Download budget creeps past 6 MB | Medium | `size-limit` fails CI on regression from day one |
| Scope creep in content (districts, NPCs) | Medium | Content is data-driven; districts 6+ are explicitly Phase 7 |
| Cozy game with no retention | Medium (commercial) | Freshness ratings, shards and Route Report are in scope from Phase 3, not deferred |
| WebGL context loss on mobile | Low–Medium | Recovery path built in Phase 2 and tested in CI |

## Definition of done (ship criteria)

- [ ] All five contracts completable; no soft-locks in 20 consecutive runs
- [ ] 60 FPS desktop / ≥ 30 FPS on the mobile floor device
- [ ] Time-to-play ≤ 5 s on 4G mobile; boot+core+world ≤ 5.8 MB
- [ ] Save survives a schema version bump (migration test in CI)
- [ ] Playable start-to-finish with keyboard only, gamepad only, and touch only
- [ ] WCAG AA; `prefers-reduced-motion` fully honoured
- [ ] Zero console errors; no WebGL resource leak across 20 scene cycles
- [ ] Character assets swappable by editing one manifest file — verified by
      swapping the placeholder for a second test rig
