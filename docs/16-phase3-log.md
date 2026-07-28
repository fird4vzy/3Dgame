# 16 — Build Log: Phase 3

The game is playable end to end. Five contracts, five districts, and the
illumination loop that the whole design rests on.

## What runs

**The loop.** Walk to Postmaster Odd → accept a contract → the parcel attaches
and starts cooling → carry it across the planet → hand it over → **the district
ignites**: lamps catch in a 40 ms cascade, the ambient warms, a music stem fades
in over 2.5 s, and the next contract unlocks. Repeat five times and the Route
Report appears.

**Systems built.** `QuestSystem` (prerequisite graph, no failure state),
`DeliverySystem` (the only place that knows the *order* of a delivery),
`WarmthSystem` (ratings that never block completion), `InteractionSystem`
(spatial hash + look-weighted focus), `DialogueSystem`, `IlluminationSystem`,
`ShardSystem`, `GlideComponent` with thermals, plus `SpatialHash` and
`DistrictRegistry`.

**Content.** Five districts spread around the sphere, six named NPCs, five
contracts with dialogue at both ends, 25 lumen shards, five thermal columns —
all in `src/data/content.ts`. Adding a sixth district is a data edit; no system
knows how many there are.

**UI.** Compass ribbon (direction only, never a map), contract card, interaction
prompt, warmth-tinted parcel indicator, district banner, typewriter dialogue
card, and the Route Report win screen.

## Verification

92 unit tests, plus two browser suites: the movement smoke test (15 assertions)
and a **full playthrough** that accepts a contract, steers the character across
the terrain, hands the parcel over, and asserts the district ignited, the lamps
reached full brightness, the chain advanced and progress persisted. 410 kB
gzipped against a 6 MB budget.

## Four things the build corrected

### 1. You can run straight past an NPC

The interaction radius is 2.4 m. At run speed with `groundFriction 14`, releasing
the key leaves roughly **0.75 m of skid** — so stopping "at" an NPC can put you
outside the radius before the prompt registers.

The playthrough test now walks the last few metres, which is what a player does
naturally. Worth watching in playtesting: if it bites, the fix is a wider radius
while moving fast, not a smaller one.

### 2. Sprites are unlit, so the character floated above the world

`BillboardCharacter` uses an unlit material by necessity. In a dusk-lit world
that made Ren fully bright against a dim planet — he read as pasted on top of
the scene rather than standing in it.

Added `setTint()`, driven from the district's illumination level. The character
now darkens in dormant districts and warms as they light, which turns a bug into
something that serves the core hook.

### 3. Dormant districts were too dark to read

Base ambient at 0.55 made NPCs near-black silhouettes. "Dim" has to stay legible
— you cannot talk to someone you cannot see. Raised to 0.95 with a cooler tint;
the contrast against a lit district still reads clearly because ignition adds
ambient *and* per-lamp point lights.

### 4. The compass only appeared after accepting a contract

Which meant the very first walk — to the postmaster — had no guidance at all,
in the one moment a new player most needs it. It now follows whatever the
current objective is.

## Known gaps

- **Locomotion does not cycle.** The supplied sheet has one drawing per action,
  so walking holds a pose. 6–8 frame cycles or a rigged glTF fixes this; the
  pipeline already handles both.
- **No audio assets.** The engine, buses and stem director are built and wired,
  but there are no stems to play, so ignition is currently silent. Dropping
  six same-length loops into the manifest turns it on.
- **The hand-off has no particle burst.** `celebrate()` is a stub; the pooled
  emitter is Phase 4.
- **Glide is implemented but under-exercised.** Thermals are placed one per
  district; the ring that lets a skilled player circumnavigate without landing
  needs tuning against real playtesting.
- **No main menu.** The game boots straight into a run. Scene manager and
  transitions exist to support it; the screen itself is Phase 5.
- **Frame rates from CI are meaningless** — SwiftShader software rendering.
