# 02 — Game Design Document · **LUMENPOST**

> *A tiny planet. A bag full of light. Everyone's waiting.*

**Deliverable 1 of 12.** Working title `LUMENPOST` — placeholder, easy to
rebrand (one constant in `src/config/brand.ts`).

## 2.1 One-paragraph pitch

The little planet of **Fennwick** has gone dim. Its star is guttering, the
street lamps are out, and the colour has drained out of the fields. You are the
newest courier of the Lumen Post — and every parcel you carry is a bottled
piece of light. Deliver it to the person expecting it and that corner of the
world *wakes up*: lamps ignite, grass floods back to green, a new instrument
joins the music. Walk the whole planet in ten minutes; light it back up in
thirty.

## 2.2 Design pillars

1. **The world is the progress bar.** Never show a percentage the player can
   read off the world itself. Every delivery visibly, audibly and permanently
   changes the planet. This is the single most important pillar — every feature
   is judged against it.
2. **No punishment, only pace.** There is no death and no hard fail. Skill is
   rewarded with *speed and grace*, never gated behind it.
3. **Legible at a glance.** Close horizon, strong silhouettes, one clear
   objective at a time. Never a map screen.
4. **Instant, everywhere.** Playable within 5 seconds of a click, on a
   three-year-old Android phone, on a hotel wifi.
5. **Finish-able, then replay-able.** A complete 30-minute arc, plus an opt-in
   mastery layer for players who want one.

## 2.3 How we differ from the reference — and why

The reference is a beautiful vignette with no retention shape. Three original
systems give `LUMENPOST` a commercial spine while keeping the cozy tone:

### A. Illumination progression (the core original hook)

Each completed delivery **relights a district**. This is not a cosmetic flag —
it drives four channels at once:

| Channel | Effect on delivery |
|---|---|
| Lighting | District lamp group ignites; local light probe / ambient tint lerps from desaturated dusk to warm evening over ~3 s |
| Colour | A per-district `saturation` uniform animates 0.15 → 1.0 in the grade pass |
| Audio | A music **stem** un-mutes (bass → guitar → strings → choir → bells), so the score literally builds as you play |
| Life | Dormant NPCs, fireflies and animated props enable in that district |

The player *sees* the game filling in. That is the reward loop, and it costs
almost nothing to run (uniforms + a few `visible` flags + gain nodes).

### B. Glide traversal (skill expression without risk)

The satchel doubles as a wing. Off any ridge, hold **Space / tap the glide
button** to deploy and ride the **thermal currents** that ring the planet.
Gliding is strictly optional — every destination is walkable — but it is faster,
it feels wonderful, and it turns the tiny sphere into a playground with a
skill ceiling. Falling has no damage: you simply land.

### C. Freshness — a mastery layer that cannot punish

Every parcel carries a **warmth meter** that decays slowly. Deliver it warm for
a *Bright* rating; deliver it cold and the delivery still completes, the story
still resolves, the district still lights. Warmth affects only the
end-of-run **Route Report** (a per-run score and a personal best). Cozy players
never notice it; optimisers get a chase.

**Result:** the same 30-minute first playthrough as the reference, plus a
speed/style replay loop, plus a natural content pipeline (new districts = new
stems, new lamps, new contracts).

## 2.4 Setting and characters

**Fennwick** is a hand-sized world with five districts, each a distinct
silhouette and palette, arranged around the sphere so that any two are a
90-second walk apart.

| District | Silhouette | Colour (lit) | Music stem | Delivery beat |
|---|---|---|---|---|
| **The Landing** | Post office, mailbox plaza, gentle hills | Warm amber | Bass + kick | Tutorial — deliver to the postmaster next door |
| **Bramblewood** | Dense round trees, mushroom bridges, fireflies | Deep green | Acoustic guitar | A letter that must be read aloud to someone who cannot read |
| **The Coil** | Geothermal plant, pipes, steam vents, the planet's heart | Copper / teal | Synth arp | Restart the planet's core — the delivery *is* the fuel cell |
| **Tidebreak** | Cliff village over a small sea, boardwalks, kites | Cool blue | Strings | A parcel for someone who has already left; you decide who receives it |
| **The Spire** | The old lighthouse at the pole | White / gold | Choir + bells | Finale: carry the last lumen to the top |

**Cast** (all replaceable — see `06-asset-specification.md`):

- **Pip** — the player. Silent, expressive through animation and emotes.
- **Postmaster Odd** — tutorial voice, dry, kind. Sets each contract.
- **Twenty-odd residents** — each is one animation loop plus one reaction beat.

Story is delivered through **staging, animation and 2–3 line dialogue cards** —
never a wall of text.

## 2.5 The loop, at three scales

**Moment-to-moment (seconds).** Walk / run / glide across curved ground; the
horizon reveals a landmark; a firefly drifts past; footsteps and grass rustle.

**Delivery (2–5 minutes).**
```
Accept contract → Parcel attaches to hand socket, carry pose engages
      → Compass ribbon points to recipient (direction only, never a map)
      → Traverse (walk or glide, player's choice)
      → Enter recipient's interaction radius → prompt → hand-off animation
      → Story beat (2–3 dialogue cards + NPC reaction)
      → DISTRICT LIGHTS UP: lamps, colour, music stem, life
      → Route Report tick → next contract
```

**Run (25–35 minutes).** Five contracts, five districts, five stems. The planet
goes from dusk to fully lit. Ends at The Spire with the full score playing and
the world glowing, then a **Route Report**: time, freshness ratings, districts
lit, secrets found, personal best.

## 2.6 Win and lose conditions

**Win.** Deliver all five lumens and light The Spire. The end sequence is a slow
camera pull off the surface showing the whole lit planet turning.

**Lose.** *There is no fail state in the main game.* Explicitly, by design:

- Falling: no damage. You land, dust puff, keep going.
- Water: you wade; deep water floats you back to shore.
- Dropped parcel: it stays where it fell with a light beam marker, or is
  returned to the post office Lost & Found. Recovering costs time, nothing else.
- Running out of warmth: the delivery downgrades to a *Cool* rating. It never
  blocks progress.

**The optional fail state** lives in **Storm Run** (post-launch, Phase 7): a
timed challenge mode where the wind fights you and the run *can* end. Kept
strictly separate so the base game's promise is never broken.

## 2.7 Camera, animation, transitions, feedback

- **Camera.** Third-person spring-arm orbiting the player, upright relative to
  *local* up, obstacle-aware. Contextual overrides: pull back and widen FOV
  while gliding; ease in and frame both actors during hand-off; slow orbit
  during a district lighting; cinematic pull-off at the finale. Full spec in
  `03-gameplay-specification.md §3.4`.
- **Animation.** Blend-tree locomotion (idle → walk → run, plus carry variants),
  additive look-at for NPC attention, glide set, hand-off interaction, ten
  emotes. Details in `06-asset-specification.md`.
- **Transitions.** No hard cuts. Iris/lumen wipe for scene changes (~450 ms),
  cross-faded audio, UI screens slide-and-fade on a shared 180/240 ms easing
  curve. Loading is a *single* screen shown once.
- **Visual feedback (the juice list).** Footstep puffs and surface-matched SFX;
  parcel bob and glow pulse while carried; warmth shown as the parcel's glow
  colour, not a bar; interaction prompts that scale-pop; hand-off burst of
  lumen particles; screen-space bloom bump on district ignition; camera micro-
  shake (≤ 2 px) on landing; emotes as pooled 3D billboards; subtle controller
  rumble where supported.

## 2.8 Audience, platform, accessibility

Ages 8+, all skill levels, plays in a browser tab on desktop, tablet or phone.
Portrait and landscape both supported. Ships with: remappable keys, full
gamepad support, hold-vs-toggle options, camera-shake and motion-reduction
toggles, colour-blind-safe objective markers (shape + colour), subtitle sizing,
UI scale slider, and no reliance on audio for any objective. Text is
externalised to JSON locales from day one.

## 2.9 Monetisation posture (non-committal, architecturally reserved)

Base game free and complete. If monetised later: cosmetic-only (courier
outfits, satchel skins, emote packs) behind a `CosmeticsService` seam that
already exists in the architecture. **No ads, no energy timers, no paywalls on
content** — either would violate Pillar 1 and 2. This is stated so the
architecture reserves the seam, not because it is scheduled.
