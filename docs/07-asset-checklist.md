# 07 — Asset Checklist & Pipeline

**Deliverable 6 of 12.** Every asset needed to ship, with export settings.
Legend: **α** = transparency required · **Frames** = animation frames ·
**Src** = author-time source format · **Ship** = runtime format.

## 7.1 Characters

| # | Filename | Purpose | Src | Ship | Resolution / Budget | Frames | α | Pivot | Export settings |
|---|---|---|---|---|---|---|---|---|---|
| C1 | `char_placeholder.glb` | Dev stand-in, full clip set | Blender | glTF+Meshopt | ≤ 4 k tris | all clips | ✅ (atlas) | Feet, origin | Y-up, metres, +Z fwd, in-place |
| C2 | `char_pip.glb` | **Player** | Blender/Maya | glTF+Meshopt | ≤ 12 k tris, 1×1024 KTX2 | 24 clips (see 06 §6.2) | ✅ | Feet, origin | Root motion baked out, 30 fps, ≤ 64 bones, 4 influences |
| C3 | `char_npc_odd.glb` | Postmaster | " | " | ≤ 6 k tris | idle, talk, wave, react, sit | ✅ | Feet | Shared NPC atlas |
| C4–C8 | `char_npc_wren/finn/mara/sol/bea.glb` | Story recipients (5) | " | " | ≤ 6 k tris each | idle, talk, react, unique beat | ✅ | Feet | Shared atlas |
| C9 | `char_npc_villager_a/b/c.glb` | Background residents (3 variants × colour tints) | " | " | ≤ 2.5 k tris | idle, walk, sit, wave | ✅ | Feet | Shared atlas; tint via vertex colour |
| C10 | `char_pip_cosmetics.glb` | Hair × 6, tops × 6, bottoms × 6, shoes × 4 | " | " | ≤ 800 tris/part | — | ✅ | Skinned to Pip's skeleton | Separate named meshes, lazy bundle |

## 7.2 Environment

| # | Filename | Purpose | Ship | Budget | α | Pivot | Notes |
|---|---|---|---|---|---|---|---|
| E1 | `env_terrain.glb` | Planet surface, 5 district sub-meshes | glTF+Meshopt | ≤ 120 k tris | ❌ | Planet centre | Vertex-coloured district mask; feeds the BVH |
| E2 | `env_skydome.glb` | Sky shell | glTF | 960 tris | ❌ | Centre | Shader-driven gradient |
| E3 | `prop_tree_a/b/c.glb` | Bramblewood canopy | glTF | ≤ 1.2 k, 3 LODs | ✅ (leaf cards) | Trunk base | `InstancedMesh` |
| E4 | `prop_rock_a/b/c.glb` | Scatter | glTF | ≤ 300 | ❌ | Base | Instanced |
| E5 | `prop_house_a/b/c.glb` | Landing + Tidebreak | glTF | ≤ 2.5 k, 2 LODs | ❌ | Base centre | — |
| E6 | `prop_lamp_street.glb` | **Ignition hero prop** | glTF | ≤ 600 | ❌ | Base | Emissive slot driven by `IlluminationSystem` |
| E7 | `prop_pipe_kit.glb` | The Coil modular set | glTF | ≤ 3 k total | ❌ | Connector | Modular snapping |
| E8 | `prop_boardwalk_kit.glb` | Tidebreak | glTF | ≤ 1.5 k | ❌ | Corner | Modular |
| E9 | `prop_lighthouse.glb` | The Spire finale | glTF | ≤ 6 k, 2 LODs | ❌ | Base | Interior stair volume |
| E10 | `prop_mailbox.glb` | Contract pickup points | glTF | ≤ 500 | ❌ | Base | Interactable |
| E11 | `prop_parcel_letter/box/fuelcell/bloom.glb` | 4 carried parcels | glTF | ≤ 400 each | ❌ | Carry point (hand) | Emissive rim = warmth |
| E12 | `prop_shard_lumen.glb` | Collectible × 24 | glTF | ≤ 200 | ✅ | Centre | Instanced, rotates |

## 7.3 Textures

| # | Filename | Purpose | Ship | Resolution | α | Colour space | Export |
|---|---|---|---|---|---|---|---|
| T1–T5 | `tex_<district>_atlas.ktx2` | Per-district albedo atlas ×5 | KTX2/Basis | 2048² (1024² low tier) | ✅ | sRGB | UASTC hero / ETC1S mobile, mips on |
| T6 | `tex_characters_atlas.ktx2` | Shared NPC albedo | KTX2 | 1024² | ✅ | sRGB | ETC1S |
| T7 | `tex_pip_albedo.ktx2` | Player | KTX2 | 1024² | ✅ | sRGB | UASTC |
| T8 | `tex_*_orm.ktx2` | Packed AO/Rough/Metal (R/G/B) | KTX2 | 1024² | ❌ | **Linear** | ETC1S |
| T9 | `tex_*_normal.ktx2` | Normals (hero surfaces only) | KTX2 | 1024² | ❌ | **Linear** | UASTC, +Y green |
| T10 | `tex_stars.ktx2` | Sky | KTX2 | 1024² | ❌ | Linear | ETC1S |
| T11 | `fx_particles_atlas.png` | 8-cell particle atlas | PNG | 512² | ✅ premultiplied | sRGB | PNG-8 where possible |
| T12 | `lut_grade_dusk.png` / `lut_grade_lit.png` | Colour grade LUTs | PNG | 256×16 strip | ❌ | **Linear, no compression** | Lossless PNG only |
| T13 | `ui_sprites.png` + `.json` | UI raster bits | PNG | 1024² | ✅ | sRGB | TexturePacker, trimmed |

## 7.4 UI / icons / fonts

| # | Filename | Purpose | Format | Size | α | Notes |
|---|---|---|---|---|---|---|
| U1 | `ui_icon_*.svg` × ~26 | play, pause, settings, audio on/off, music, sfx, back, close, check, arrow, compass, parcel, shard, wardrobe, emote, camera, fullscreen, gamepad, keyboard, touch, restart, share, info, lock, star, chevron | SVG | 24×24 vb | ✅ | 2 px stroke, `currentColor`, no embedded fills |
| U2 | `ui_emote_*.svg` × 10 | Emote wheel | SVG | 48×48 vb | ✅ | Flat, 3-colour max |
| U3 | `ui_glyphs_<kb\|xbox\|ps\|touch>.svg` | Input prompts | SVG sprite | 32×32 cells | ✅ | Swapped by active device |
| U4 | `ui_logo.svg` (+ `ui_logo_512.png`) | Brand | SVG/PNG | — / 512² | ✅ | — |
| U5 | `og-image.png` | Social card | PNG | 1200×630 | ❌ | Opaque, ≤ 200 KB |
| U6 | `favicon.svg` + `apple-touch-icon.png` | Tab / homescreen | SVG/PNG | — / 180² | ✅/❌ | — |
| U7 | `font_display.woff2` | Titles | WOFF2 | ≤ 40 KB | — | Subset Latin+ext, variable weight, preload |
| U8 | `font_body.woff2` | UI/dialogue | WOFF2 | ≤ 35 KB | — | Subset, variable, preload |

## 7.5 Audio

| # | Filename | Purpose | Ship | Length | Loop | Bus | Notes |
|---|---|---|---|---|---|---|---|
| A1 | `mus_stem_base.webm/.m4a` | Pad — always on | Opus 96 / AAC 128 | 2:40 | ✅ | music | All stems identical length |
| A2–A6 | `mus_stem_{bass,guitar,arp,strings,choir}` | One per district | " | 2:40 | ✅ | music | Must work solo *and* in any combination |
| A7 | `mus_menu.webm/.m4a` | Main menu | Opus 96 | 1:30 | ✅ | music | — |
| A8 | `mus_finale.webm/.m4a` | Ending | Opus 128 | 1:10 | ❌ | music | — |
| A9–A13 | `amb_{landing,bramblewood,coil,tidebreak,spire}_loop` | District ambience | Opus 80 | 30–60 s | ✅ | ambience | Stereo, crossfaded by district |
| A14 | `sfx_footstep_<grass\|stone\|wood\|sand\|metal>_01..04` | 5 surfaces × 4 variants = 20 | Opus 64 | ≤ 400 ms | ❌ | sfx | Mono, positional, surface from terrain vertex colour |
| A15 | `sfx_jump`, `sfx_land_soft/hard` | Movement | Opus 64 | ≤ 600 ms | ❌ | sfx | Mono |
| A16 | `sfx_glide_open/loop/close` | Glide | Opus 80 | 0.3 / 4 s / 0.3 | loop ✅ | sfx | Wind layer, pitch by speed |
| A17 | `sfx_parcel_pickup/handoff/drop` | Delivery | Opus 64 | ≤ 900 ms | ❌ | sfx | — |
| A18 | `sfx_district_ignite` | **The payoff sound** | Opus 96 | 3.5 s | ❌ | sfx | Swell; syncs with the 2.5 s stem ramp |
| A19 | `sfx_shard_collect` | Collectible | Opus 64 | 700 ms | ❌ | sfx | Pitch rises with count |
| A20 | `sfx_ui_{hover,click,back,toggle,error}` | UI | Opus 64 | ≤ 250 ms | ❌ | ui | Soft, no harsh transients |
| A21 | `sfx_emote_*` × 10 | Emote stingers | Opus 64 | ≤ 800 ms | ❌ | sfx | — |
| A22 | `vo_npc_blip_a/b/c` | Dialogue text blips (3 pitched voices) | Opus 64 | ≤ 120 ms | ❌ | voice | Animal-Crossing style, no recorded speech → no localisation cost |

## 7.6 Data files (authored, not exported)

`manifest.json` · `contracts/c01–c05.json` · `dialogue/*.json` ·
`districts/*.json` · `characters/*.character.json` · `placements/*.json`
(lat/lon/alt/yaw) · `cosmetics/*.json` · `locales/en.json`

## 7.7 Asset pipeline

```
 SOURCE (git-lfs or external DAM)          BUILD (tools/)                  RUNTIME (public/assets)
 ─────────────────────────────────         ──────────────────────          ───────────────────────
 .blend / .fbx / .ma        ──► export ──► gltf-transform:                 char_pip.glb
                                            prune → dedup → resample  ──►  (Meshopt + KTX2 embedded)
                                            → meshopt → textureCompress
 .psd / .png / .exr         ──► atlas  ──►  toktx (UASTC|ETC1S) + mips ──►  tex_*.ktx2
 .svg                       ──► svgo   ──►  optimised, currentColor    ──►  ui_icon_*.svg
 .wav (48k/24bit)           ──► ffmpeg ──►  libopus + AAC + loudnorm   ──►  *.webm / *.m4a
 .ttf / .otf                ──► fonttools subset + woff2               ──►  *.woff2
                                            ▼
                                    validate-manifest.ts
                            (manifest ↔ disk ↔ naming ↔ SIZE BUDGET)
                                            ▼
                                    CI fails on budget regression
```

Reference commands (wired up as npm scripts in `tools/`):

```bash
# Models
gltf-transform optimize in.glb out.glb \
  --compress meshopt --texture-compress ktx2 --simplify false

# Textures
toktx --t2 --encode uastc --uastc_quality 2 --zcmp 18 --genmipmap out.ktx2 in.png   # hero
toktx --t2 --encode etc1s --clevel 4 --qlevel 200 --genmipmap out.ktx2 in.png       # mobile

# Audio
ffmpeg -i in.wav -af loudnorm=I=-16:TP=-1:LRA=11 -c:a libopus -b:a 96k out.webm
ffmpeg -i in.wav -af loudnorm=I=-16:TP=-1:LRA=11 -c:a aac    -b:a 128k out.m4a

# Icons / fonts
svgo --multipass -f src/icons -o public/assets/icons
pyftsubset in.ttf --unicodes="U+0000-00FF,U+2018-201F" --flavor=woff2
```

## 7.8 Download budget allocation

| Bundle | Contents | Budget (gz/compressed) |
|---|---|---|
| `boot` | HTML, JS core, fonts, UI SVG, loading screen | 0.9 MB |
| `core` | Player + placeholder, terrain, shaders, core SFX | 2.6 MB |
| `world` | District props, NPCs, atlases | 2.3 MB |
| **Time-to-play total** | | **≤ 5.8 MB** |
| `audio_music` | 6 stems (streamed, starts after first input) | 5.5 MB |
| `audio_amb` | Ambience loops | 1.8 MB |
| `cosmetics` | Wardrobe (on first open) | 1.4 MB |
| `emotes` | Emote assets (on first use) | 0.6 MB |
| **Grand total** | | **≤ 15.1 MB** |

Under the reference's 17.5 MB, with the same instant-play first impression.
`size-limit` enforces the `boot`/`core`/`world` sum in CI.

## 7.9 Acceptance checks (per asset, before merge)

- [ ] Naming matches the convention exactly
- [ ] Correct scale (metres), orientation (+Y up, +Z fwd), pivot at contact point
- [ ] Tri budget met; LODs present where required
- [ ] Textures KTX2, correct colour space, mips generated, power-of-two
- [ ] No unused materials, no duplicate meshes, no ngons on deforming geometry
- [ ] Animations 30 fps, in-place, loops seamless, events tagged
- [ ] Listed in `manifest.json` in the correct bundle
- [ ] `validate-manifest.ts` passes
- [ ] Loads clean in the dev asset viewer at Low, Medium and High tiers
