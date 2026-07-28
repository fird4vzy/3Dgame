# 03 — Gameplay Specification

**Deliverable 2 of 12.** Exact, implementable numbers. Every value here lives in
`src/config/tuning.ts` and is hot-reloadable in dev via the debug panel.

## 3.1 Units and world constants

1 world unit = **1 metre**. Character height 1.6 m.

| Constant | Value | Notes |
|---|---|---|
| `PLANET_RADIUS` | 60 m | Sea level. Circumference ≈ 377 m |
| `TERRAIN_AMPLITUDE` | ±6 m | Hills/valleys displaced from sea level |
| `GRAVITY` | 18 m/s² | Higher than real — snappier arcs, shorter falls |
| Horizon distance | ≈ 13.5 m | `sqrt(2·R·h + h²)` at eye height 1.5 m — curvature is *visible* |
| Walk lap time | ≈ 95 s | Full circumference at run speed |
| `SEA_LEVEL_RADIUS` | 58.5 m | Below this is water |

The 60 m radius puts the horizon ~13.5 m out — about eight paces. Curvature is
not subtle at this scale; landmarks crest into view as you approach them, which
is exactly the effect the reference gets and the reason no map screen is needed.
This is the game's most important tuning value, and it is verified by a unit
test (`tests/unit/spherical.test.ts`) so it cannot drift unnoticed.

If playtesting shows 13.5 m is claustrophobic, the lever is `PLANET_RADIUS`:
the horizon grows with its square root, so a 90 m planet gives ~16.5 m of
sightline at the cost of a 566 m circumference (a ~123 s lap instead of ~82 s).

## 3.2 Spherical locomotion — the core technical mechanic

Everything on the surface uses a **local frame** rebuilt every tick:

```
up      = normalize(position - PLANET_CENTER)
right   = normalize(cross(up, cameraForward))
forward = cross(right, up)
```

Per fixed tick (60 Hz), the `SphericalCharacterController` runs:

1. Rebuild the local frame from the current position.
2. Map input `(x, y)` into the tangent plane: `wish = right·x + forward·y`.
3. Accelerate horizontal velocity toward `wish · targetSpeed`
   (`ACCEL` grounded / `AIR_ACCEL` airborne), apply friction when input is zero.
4. Apply gravity along `-up`; clamp to `MAX_FALL`.
5. Integrate position, then **resolve collision**: capsule vs. the terrain +
   collider BVH, up to 4 depenetration iterations, sliding along contact planes.
6. **Ground snap**: raycast from `position + up·0.3` along `-up` for 0.5 m. On
   hit within tolerance, snap to the surface and adopt the hit normal as the
   ground normal (prevents launching off convex hilltops).
7. **Orient**: build the target quaternion from (ground normal as local +Y,
   velocity direction as local +Z); `slerp` at `ORIENT_LERP` per second.
8. Feed planar speed into the animation blend tree.

### Movement tuning

| Parameter | Value |
|---|---|
| Walk speed | 2.2 m/s |
| Run speed | 4.6 m/s (hold Shift / push stick past 0.7 / mobile: auto above joystick 0.7) |
| Ground acceleration | 26 m/s² |
| Ground friction | 14 m/s² |
| Air acceleration | 6 m/s² |
| Jump impulse | 6.6 m/s (apex ≈ 1.2 m) |
| Max fall speed | 32 m/s |
| Coyote time | 120 ms |
| Jump buffer | 140 ms |
| Orientation slerp | 12 /s |
| Max walkable slope | 52° |
| Step height | 0.35 m |
| Carry speed multiplier | ×0.94 (heavy parcels ×0.86) |

Coyote time and jump buffering are not optional polish — without them
spherical traversal feels slippery on convex terrain.

### Glide

Deploy: press Jump again while airborne and falling, above 1.5 m of clearance.

| Parameter | Value |
|---|---|
| Terminal descent | 2.4 m/s (vs 32 m/s free fall) |
| Forward speed | 7.5 m/s, up to 11 m/s in a thermal |
| Turn rate | 90°/s |
| Pitch authority | ±20°, trades altitude for speed |
| Thermal columns | 6 fixed sites, radius 8 m, lift +4 m/s |
| Deploy / stow | 0.25 s / 0.15 s blends |
| Camera | FOV 55° → 68° over 0.4 s, arm 4.5 m → 6.5 m |

Thermals are placed so a skilled player can circumnavigate the planet without
touching the ground — the mastery route, and the reason speedrunners will care.

## 3.3 Delivery system

A contract is pure data (`src/data/contracts/*.json`):

```jsonc
{
  "id": "c02_bramblewood_letter",
  "title": "A letter for someone who can't read it",
  "parcel": { "model": "parcel_letter", "weight": "light", "warmthSeconds": 210 },
  "giver": "npc_odd",
  "recipient": "npc_wren",
  "district": "bramblewood",
  "unlocks": ["district_light:bramblewood", "stem:guitar"],
  "dialogue": { "onAccept": "dlg.c02.accept", "onDeliver": "dlg.c02.deliver" },
  "prerequisites": ["c01_landing_intro"]
}
```

**Carry.** The parcel parents to the `hand_R` socket, the carry animation layer
enables, and the parcel bobs on a sine (0.02 m, 1.6 Hz) with a rim glow whose
colour is driven by warmth.

**Warmth.** Starts at 1.0, decays linearly over `warmthSeconds` (180–240 s
typical). Thresholds → rating: `> 0.66` **Bright**, `> 0.25` **Warm**,
otherwise **Cool**. Never blocks completion. Shown *only* as the parcel's glow
colour (amber → dim blue), never as a HUD bar — Pillar 2.

**Hand-off.** Enter the recipient's 2.2 m radius → prompt scale-pops → confirm →
camera eases to a two-shot, both actors play their beat, parcel transfers, 24
pooled lumen particles burst, then the district ignition fires.

**Navigation.** A **compass ribbon** at the top of the screen shows the
recipient's bearing as a soft chevron, plus a distance band (Near / A short
walk / Across the world). Direction only. A vertical **light beam** marks the
recipient once within 25 m. No map screen, ever (Pillar 3).

## 3.4 Camera specification

Spring-arm third-person rig. Its subtlety is that the "up" axis changes as you
walk, so yaw cannot be stored as an Euler angle against a fixed world axis.

**Solution:** the rig stores orientation as a quaternion and **parallel-
transports** it each tick — when the local up rotates by `q = fromTo(upPrev,
up)`, the camera's yaw basis is pre-multiplied by the same `q`. Pitch is then
applied in the transported frame. This removes the roll-snap and gimbal pop
that a naive `lookAt(player, worldUp)` produces on a sphere. Getting this right
is the difference between "charming little planet" and "motion sickness."

| Parameter | Value |
|---|---|
| Arm length | 4.5 m (6.5 m gliding, 3.2 m in dialogue) |
| Height offset | 1.5 m above feet |
| Position damping | Critically damped spring, ω = 9 |
| Rotation damping | slerp 14 /s |
| Pitch clamp | −35° … +55° |
| Mouse sensitivity | 0.0022 rad/px (user 0.25×–3×) |
| Touch sensitivity | 0.004 rad/px |
| FOV | 55° default, 68° gliding, 42° dialogue |
| Occlusion | Sphere-cast player→camera, r = 0.25 m; pull in to hit, restore at 6 m/s |
| Shake | Trauma model, `offset = trauma² · maxOffset`, max 2 px, decay 1.8 /s |

Contextual cameras register as a stack — `CameraDirector` blends the top entry
in over its own duration, so a dialogue camera can interrupt a glide camera and
restore cleanly.

## 3.5 Interaction

Interactables register with a spatial hash (8 m cells, planet-surface indexed).
Each tick the player queries its cell + neighbours; the best candidate wins on
`distance` weighted by `dot(playerForward, toTarget)` so the thing you are
*looking at* beats the thing you are marginally closer to.

| Type | Radius | Prompt |
|---|---|---|
| NPC dialogue | 2.4 m | "Talk" |
| Delivery recipient | 2.2 m | "Deliver" |
| Parcel pickup | 1.6 m | "Pick up" |
| Lamp / prop | 1.8 m | Contextual |
| Secret (Lumen Shard) | 1.2 m | Auto-collect |

## 3.6 Collectibles and secrets

**24 Lumen Shards** hidden across the planet — under boardwalks, on rooftops,
inside the tree canopy, reachable mostly by glide. Purely optional; they feed
the Route Report and unlock cosmetic satchel skins. They exist to reward the
exploration the tiny-planet design invites, and to give the glide verb a reason
beyond speed.

## 3.7 Difficulty and pacing curve

| Beat | Time | Purpose |
|---|---|---|
| Wake, walk 20 m to the post office | 0–2 min | Teach movement; curvature is the first thing you see |
| Contract 1 — The Landing | 2–6 min | Teach carry + hand-off. Recipient is deliberately close |
| First district ignition | ~6 min | **The hook.** Show the world changing before asking for commitment |
| Contract 2 — Bramblewood | 6–13 min | Teach vertical space; first glide opportunity, taught by geography not text |
| Contract 3 — The Coil | 13–20 min | Longest traversal; thermals become obviously useful |
| Contract 4 — Tidebreak | 20–27 min | Emotional peak; slowest pace, most dialogue |
| Contract 5 — The Spire | 27–33 min | Climb the lighthouse, full score, finale |
| Route Report + free roam | 33 min+ | Score, shards, replay invitation |

No tutorial text boxes. Movement is taught by placing the first objective
somewhere you can only reach by doing the thing.

## 3.8 Controls

| Action | Keyboard / Mouse | Gamepad | Touch |
|---|---|---|---|
| Move | WASD / arrows | Left stick | Left virtual joystick (floating origin) |
| Camera | Mouse (drag or pointer-lock) | Right stick | Right-half drag |
| Run | Shift | Stick > 0.7 | Joystick > 0.7 |
| Jump / Glide | Space | A / ✕ | Right button |
| Interact | E / F / Click prompt | A / ✕ | Tap prompt |
| Emote wheel | Q (hold) | D-pad ↑ | Emote button |
| Pause | Esc | Start | Pause button |
| Photo mode | P | Right stick click | Menu item |
| Skip dialogue | Space / Esc | B / ○ | Tap |

Touch joystick uses a floating origin (appears where the thumb lands) and dead
zone 0.12. All buttons sit inside `env(safe-area-inset-*)` with 48 px minimum
hit targets.
