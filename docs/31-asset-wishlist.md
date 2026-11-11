# 31 — Assets still to make

What the game needs drawn or recorded, in the order it would show most. The
code side of each is already in place: dropping the file in is the work.

Naming follows what is there: `public/assets/models/<name>.glb`, then
`node tools/optimise-glb.mjs <file> 2048` and
`node tools/shoot-model.mjs <name> <heightM> out.png` to check it.

| Asset | Why | Format | Size | AI generation |
|---|---|---|---|---|
| Houses: machiya, noren shop, shrine | The last of the blur: they are 512² bakes | GLB, one material | 8–12k triangles, 2048² colour map, no baked shadows | Yes: concept on white, then image-to-3D |
| Post office, tea house, bath house | Variety in the village | GLB | as above | Yes |
| Child residents at true proportion | Borrowing the adult builds now | GLB, rigged if possible | 4–6k, 1024² | Partly |
| 8 keepsakes (daruma, beckoning cat, kokeshi, wind chime, charm, fan, top, fox mask) | Built from primitives in `world/Activities.ts` | GLB | under 1.5k, 512² | Yes |
| Stamp stand, course bell, course lantern | Same | GLB | under 2k, 512² | Yes |
| HUD icons: camera, journal, jump, seal | Touch buttons carry words | SVG, one colour | 24×24 | Better by hand |
| 3 intro panels | Simple SVG now (`ui/screens/IntroScreen.ts`) | WebP or SVG | 800×1040 | Yes, manga style |
| A display face with Cyrillic and kana | Fredoka is Latin only | WOFF2 | — | No; OFL licence |
| Music, 6 stems | Synthesised by `tools/generate-audio.mjs` | OGG and M4A | 96 BPM, A minor, exactly 20 s each | With care |
| Sounds: shutter, stamp, bell, firework | The new actions are silent | OGG and M4A | mono, under 2 s | Yes |

Concept images should be one object, three-quarter view from slightly above,
plain white background, no ground and no shadow — the white is what the 3D
step segments on (see `public/assets/models/README.md`).
