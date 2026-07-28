# 06 — Asset Specification

**Deliverable 5 of 12.** You said character assets will arrive later. §6.2 is
the contract that makes them a drop-in regardless of what form they take.

## 6.1 Global conventions

**Naming.** `snake_case`, category-prefixed, no spaces, no capitals:

```
<category>_<name>[_<variant>][_<lod>].<ext>

char_pip.glb            tex_bramblewood_atlas.ktx2      sfx_footstep_grass_01.webm
char_npc_wren.glb       tex_parcel_letter_albedo.ktx2   mus_stem_guitar.webm
env_terrain.glb         ui_icon_settings.svg            amb_bramblewood_loop.webm
prop_lamp_street.glb    fx_particle_soft_dot.png        ui_btn_primary.svg
prop_parcel_letter.glb  lut_grade_lit.png               font_display.woff2
```

Animation clips: `<state>[_<variant>]` → `idle`, `idle_look`, `walk`, `run`,
`carry_idle`, `emote_wave`. Blend shapes: `blend_<name>`. Sockets:
`socket_<name>`. LODs: `_lod0` … `_lod2`.

**Space and scale.** 1 unit = 1 metre. **+Y up, +Z forward, right-handed**
(glTF standard). Characters: feet at origin, centred on X/Z. Props: pivot at the
natural contact/attach point (a lamp's pivot is its base, a parcel's is its
carry point). Never leave a pivot at the mesh centroid by accident — it is the
most common cause of props floating or spinning wrong.

**Colour.** Albedo/base-colour textures are **sRGB**; normal, roughness,
metalness, AO, masks are **linear**. Getting this backwards is the second most
common asset bug.

**Budgets.**

| Asset class | Tris | Textures | Materials |
|---|---|---|---|
| Player character | ≤ 12,000 | 1 × 1024 atlas | 1–2 |
| Named NPC | ≤ 6,000 | shared 1024 atlas | 1 |
| Background NPC | ≤ 2,500 | shared atlas | 1 |
| Hero prop | ≤ 3,000 | shared district atlas | 1 |
| Small prop | ≤ 500 | shared | 1 |
| Terrain (per district) | ≤ 25,000 | 1 × 2048 atlas | 1 |
| Full scene, on screen | ≤ 300 k desktop / 120 k mobile | — | — |

## 6.2 Character asset contract ← **read this before exporting characters**

The game never references a mesh, bone or clip by hard-coded name. Every
character is described by a **character manifest** in
`src/data/characters/<id>.character.json`. Supply assets in any supported form,
write (or let us write) the manifest, and the character works.

```jsonc
{
  "id": "pip",
  "displayName": "Pip",
  "source": {
    "kind": "gltf",                       // "gltf" | "fbx" | "spritesheet" | "spine"
    "url": "assets/models/characters/char_pip.glb",
    "scale": 1.0,                          // corrective, if not exported in metres
    "forwardAxis": "+Z",                   // corrective, if not exported +Z
    "yOffset": 0.0
  },
  "height": 1.6,
  "clips": {                               // OUR name → THEIR clip name
    "idle":        "Idle",
    "idle_look":   "IdleLook",
    "walk":        "Walk_Fwd",
    "run":         "Run_Fwd",
    "jump_start":  "Jump",
    "fall":        "Falling",
    "land":        "Landing",
    "glide_in":    "GlideStart",
    "glide":       "GlideLoop",
    "glide_out":   "GlideEnd",
    "carry_idle":  "CarryIdle",
    "carry_walk":  "CarryWalk",
    "carry_run":   "CarryRun",
    "handoff":     "GiveItem",
    "sit":         "Sit",
    "celebrate":   "Cheer",
    "emote_wave":  "Wave"
  },
  "sockets": {                             // OUR socket → THEIR bone/node
    "hand_R": "mixamorig:RightHand",
    "hand_L": "mixamorig:LeftHand",
    "back":   "mixamorig:Spine2",
    "head":   "mixamorig:Head"
  },
  "cosmeticSlots": { "hair": "mesh_hair", "top": "mesh_top",
                     "bottom": "mesh_bottom", "shoes": "mesh_shoes" },
  "materials": { "outline": true, "celBands": 3, "rimStrength": 0.35 },
  "fallback": { "clips": { "carry_walk": "walk", "glide": "fall" } }
}
```

`ClipResolver` reads this at load. **`fallback` means a partial character still
runs** — hand us a rig with only idle/walk/run and the game degrades gracefully
instead of throwing. Missing clip + no fallback = one console warning in dev, a
silent no-op in prod.

### Preferred delivery format, in order

1. **glTF 2.0 binary (`.glb`)** — skinned mesh + all clips in one file.
   **Strongly preferred.** Meshopt-compressed, KTX2 textures, Y-up, metres.
2. **FBX** — accepted; we convert to glB in the pipeline. Bake to a single
   skeleton, one clip per take, no scene scale ≠ 1.
3. **Individual glTF per clip** — acceptable; list each URL in `clips`.
4. **Sprite sheet / Aseprite / GIF (2D fallback)** — supported through a
   `BillboardCharacter` adapter that renders an axis-aligned camera-facing quad.
   Viable for background NPCs; **not recommended for the player**, since the
   character must orient to the surface normal in 3D.
5. **Spine / DragonBones** — supported for 2D UI mascots and portraits only, not
   for on-planet characters.

### If you have no assets yet

The repo ships a `char_placeholder.glb` — a correctly scaled, rigged, socketed
capsule-with-satchel carrying the complete clip set. Every system is built and
tested against it, so swapping in your real character is a manifest edit.

### Rig requirements (for 3D characters)

- Humanoid, ≤ 64 bones, ≤ 4 influences/vertex, single skeleton root.
- Root motion **baked out** — code drives translation. In-place clips only.
- Clips at 30 fps, looping clips seamless (frame 0 == last frame).
- Sockets present as bones or empties, named consistently.
- Cosmetic parts as **separate named meshes** on the shared skeleton, so
  outfit swapping is `mesh.visible` toggling, not re-skinning.

### Required animation clips

| Clip | Frames @30fps | Loop | Purpose |
|---|---|---|---|
| `idle` | 60–90 | ✅ | Standing |
| `idle_look` | 90 | — | Occasional idle break |
| `walk` | 32 | ✅ | 2.2 m/s |
| `run` | 24 | ✅ | 4.6 m/s |
| `jump_start` | 12 | — | Takeoff |
| `fall` | 30 | ✅ | Airborne |
| `land` | 16 | — | Impact |
| `glide_in` / `glide` / `glide_out` | 8 / 60 / 6 | —/✅/— | Wing deploy, ride, stow |
| `carry_idle` / `carry_walk` / `carry_run` | 60 / 32 / 24 | ✅ | Parcel in hand |
| `handoff` | 40 | — | Give parcel (event at frame 22) |
| `sit`, `celebrate` | 60, 48 | ✅ / — | Rest, finale |
| `emote_*` × 10 | 30–48 | — | Wave, cheer, laugh, sad, love, think, dance, sleep, shrug, thumbs-up |

**Animation events** are declared in the manifest by frame number: footsteps in
`walk`/`run`, the parcel-release moment in `handoff`, the dust puff in `land`.

## 6.3 Environment

| Asset | Format | Detail |
|---|---|---|
| `env_terrain.glb` | glTF, Meshopt | Sphere r=60 m, displaced ±6 m, vertex-coloured district masks, ≤ 120 k tris total, split into 5 district sub-meshes for culling |
| District props | glTF, instanced | Trees, rocks, houses, pipes, boardwalks. 3 LODs on anything > 1,500 tris |
| `prop_lamp_street.glb` | glTF | The ignition hero prop. Emissive material driven by `IlluminationSystem` |
| Water | Shader on a sphere shell r=58.5 | No texture; procedural normals + depth-based colour ramp |
| Skydome | Gradient shader + `tex_stars.ktx2` (1024², linear) | Colour ramp animates with total illumination |

Textures: **KTX2/Basis**, ETC1S for albedo and packed ORM (mobile), UASTC for
hero surfaces. One 2048² atlas per district, mip-mapped, `+Y`-up green channel
on normals (glTF convention).

## 6.4 UI

| Asset | Format | Spec |
|---|---|---|
| Icons | **SVG**, 24×24 viewBox, 2 px stroke, `currentColor` | Inlined and tinted by CSS — no PNG icons, no icon font |
| Buttons | CSS + SVG | Rendered by Lit components; no bitmap button art |
| Logo | SVG + 512² PNG fallback | Transparent |
| Emote icons | SVG, 48×48 | 10 emotes |
| Input glyphs | SVG sprite sheet | Keyboard / Xbox / PlayStation / touch sets |
| Loading art | SVG | Animates via CSS, so it renders before any WebGL asset loads |
| `og-image.png` | PNG, 1200×630, opaque | Social sharing |
| Favicon | SVG + 180² PNG (apple-touch) | — |

## 6.5 Fonts

| Font | Format | Use |
|---|---|---|
| `font_display.woff2` | WOFF2, subset Latin + punctuation | Titles, ≤ 40 KB |
| `font_body.woff2` | WOFF2, subset | UI and dialogue, ≤ 35 KB |

Variable fonts preferred (one file, all weights). `font-display: swap`, both
preloaded in `index.html`. Extended glyph sets load only with their locale.

## 6.6 Audio

| Category | Format | Spec |
|---|---|---|
| Music stems | `.webm`(Opus 96 kbps) + `.m4a`(AAC 128) | 48 kHz stereo, **identical length, sample-accurate loop points**, mixed to sum correctly at unity gain |
| SFX | Opus 64–96 kbps + AAC | Mono for positional, stereo for UI. Trimmed, zero-latency starts |
| Ambience | Opus 80 kbps | Stereo loops, 30–60 s, per district |
| UI | Opus 64 kbps | ≤ 300 ms, soft transients only |

Loudness: music −16 LUFS, SFX −18 LUFS, ambience −24 LUFS, true peak ≤ −1 dBTP.
Source masters delivered as **48 kHz/24-bit WAV**; the pipeline encodes.

Music is **5 stems + 1 base pad**, all the same length, all started together.
Stems must be *musically additive* — each has to work alone and in every
combination, because the player determines the order districts light in.

## 6.7 Particles

Single 512×512 RGBA atlas, `fx_particles_atlas.png`, premultiplied alpha, 8
cells: soft dot, spark, smoke puff, leaf, dust, ring, star, splash. Additive
blending for lumen effects, alpha for dust. Colour comes from vertex colour, not
the texture — so one atlas serves every emitter.

## 6.8 Localisation

All player-visible strings live in `src/engine/i18n/locales/<lang>.json`. **No
string literals in components.** Ship `en` first; the architecture supports the
rest without code changes. Reserve ~35% width expansion for German in UI
layouts.
