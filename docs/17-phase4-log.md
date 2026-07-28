# 17 — Build Log: Phase 4 (art & audio)

The three gaps named at the end of Phase 3 are closed: **ignition has sound**,
**the hand-off has a particle burst**, and the world has a coherent visual
direction. All of it without new supplied assets.

## Audio

`tools/generate-audio.mjs` synthesises the whole soundtrack — six music stems
and fifteen SFX — and encodes them to Opus/WebM plus AAC/MP4 via ffmpeg.

The stems are **musically additive by construction**: one tempo (96 BPM), one
progression (Am–F–C–G), one length (20 s), each part written to work alone and
in every combination, because the player decides what order districts light in.
That constraint is the whole reason the stem system exists, and it could not be
verified against silence.

| Stem | Part | District |
|---|---|---|
| `base` | Soft triangle pad, roots and fifths | always on |
| `bass` | Root notes plus a soft heartbeat | The Landing |
| `guitar` | Plucked arpeggio, one per beat | Bramblewood |
| `arp` | Eighth-note square figure | The Coil |
| `strings` | Sustained detuned saw stack | Tidebreak |
| `choir` | High airy sines, wide | The Spire |

Verified in-browser: six stems registered, started together and sample-locked,
only `base` audible at boot, all six enabled after the five districts light.

**SFX** cover footsteps on five surfaces, jump, soft/hard landing, parcel pickup
and hand-off, shard collect, UI, and the 3.5 s **ignition swell** — rising
filtered noise resolving into an A-minor bloom, timed to land with the lamp
cascade.

`SoundBoard` turns events into sound. Nothing calls the audio engine directly,
and every buffer is optional: with no audio bundle at all the game runs silently
rather than breaking. Audio loads **after** boot on purpose — 1.25 MB must never
stand between a click and being able to walk.

## Particles

`ParticleSystem` is pooled and instanced: a fixed array, one `InstancedMesh`,
one draw call for every emitter, and zero allocation after construction. At
capacity it recycles the oldest particle rather than dropping the emit — a burst
that visibly fails to appear is worse than one that quietly steals a fading mote.

Wired to: the hand-off burst, per-lamp motes during district ignition, footstep
puffs, and landing dust scaled by impact speed.

## Look

- **Cel shading** via `MeshToonMaterial` with a generated stepped gradient map,
  rather than a hand-written shader — going through the standard material keeps
  shadows, fog and instancing working for free.
- **Inverted-hull outline** helper, art-directable per object. Screen-space edge
  detection would outline everything indiscriminately and cost more.
- **District silhouettes**: round canopies for Bramblewood, vertical pipes for
  The Coil, low decks for Tidebreak, huts for The Landing, and an **11 m
  lighthouse** at The Spire — tall enough to crest a 13.5 m horizon from outside
  its own district, which is what makes the final delivery navigable.
- **The sky tracks illumination.** Background, fog distance and star brightness
  all follow total light, so progress is visible even while standing somewhere
  still dark. The whole world is coming back, not just your block.

## Three things the build corrected

### 1. `MeshToonMaterial` has no `flatShading`

Which threatened the low-poly look. It turned out not to matter: the terrain is
a non-indexed `IcosahedronGeometry`, so `computeVertexNormals()` already yields
per-face normals and the facets read flat without the flag. The original
`flatShading: true` had been redundant all along.

### 2. Additive quads render as hard squares

Obvious in the first screenshot: every particle was a bright square. Added a
procedurally generated 64×64 radial falloff — no asset round-trip, and particles
look right before any art exists.

### 3. Toasts showed raw district ids

`bramblewood is awake` rather than `Bramblewood is awake`. The bus carries ids
because that is what systems key on; the UI has to map them to display names.

## Budget

| | gzipped |
|---|---|
| JavaScript | 200 kB |
| Audio (one format) | 1,251 kB |
| **Total** | **1,668 kB** against a 6 MB budget |

## Still outstanding

- **Locomotion does not cycle** — unchanged, and still the biggest visible gap.
  It needs 6–8 frame cycles or a rigged glTF; the pipeline handles both.
- **The music is placeholder.** It is correct in structure, tempo and key, and
  it proves the system — but it is synthesised, not composed. Replacing it means
  dropping six same-length loops with the same filenames into
  `public/assets/audio/music/`.
- **No ambience beds** per district, and no bloom post-process. Bloom would make
  lamps and lumens genuinely glow rather than merely brighten; it needs the
  `postprocessing` package and a pass over the render path.
- **No main menu** — the game still boots straight into a run. Phase 5.
- **Frame rates here remain meaningless** (SwiftShader software rendering).
