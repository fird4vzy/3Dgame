---
name: lumenpost-look
description: Visually verify LUMENPOST in a real browser — screenshots of the world, a model, the character, ground-gap probing, the full playthrough. Use after any change to art, layout, terrain, sky, lighting, character or camera, and whenever the user says "посмотри", "покажи", "скриншот", "проверь как выглядит", "floating/buried", "check visually".
---

# Look at it

Unit tests in this repo have repeatedly passed while the frame was obviously wrong (a collar burying the face, piping inside the jacket, a white sky, floating houses). **A visual change is not verified until you have opened the PNG with the Read tool and looked at it.**

## Dev server first

All tools hit `http://localhost:5173` (override with `LUMENPOST_PORT`). Start it in the background and wait until it answers:

```bash
npm run dev            # run_in_background: true
curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/   # expect 200
```

Debug hook available in the page: `window.__lumenpost` (`.scene`, `.scene.isMenuMode`, …).

Write shots to the scratchpad directory, not the repo (only `playthrough.png` is committed).

## Pick the tool

| Question | Command |
|---|---|
| Any lighting / sky / atmosphere / material change | `node tools/shoot-moods.mjs <outDir> [dormant,awake,golden]` — 6 views × 3 moods, into and away from the sun, prints ms per frame. Judge against **all three moods**: a tweak that flatters one ruins another |
| Water, reflections | `node tools/shoot-lagoon.mjs <outDir>` — Tidebreak lagoon through the sea torii, 3 moods |
| How does the world look? (districts, menu) | `node tools/shoot-world.mjs <outDir>` — menu shot + fixed viewpoints, comparable between runs |
| Does a new/changed .glb look right, right scale? | `node tools/shoot-model.mjs <name> <heightM> <out.png>` — 4 views + 1.65 m human post + tri/material/texture report |
| Do buildings sit on the ground? | `node tools/probe-grounding.mjs` — worst gap / burial per footprint in metres. Last known good: worst wall gap 0.16 m on the Landing |
| Player character | `npm run shoot:character` (turnaround + head crop) |
| Gait / hands / icons | `tools/gait-preview.html`, `tools/hand-preview.html`, `tools/icon-preview.html` via the dev server; `node tools/shoot-gait.mjs` |
| Movement still works | `npm run test:e2e` |
| Whole game still completes | `npm run test:play` → writes `playthrough.png` (set `LUMENPOST_SHOT=<path>` to write elsewhere) |

## Gotchas

- The first page load after starting Vite can take 40+ s (dependency pre-bundling); a timeout on the very first run is not a bug. Retry once.
- `test:e2e` runs on SwiftShader (CPU). The game detects software GL and drops to the low tier — if e2e suddenly crawls, check that detection (`isSoftwareRenderer` in `engine/platform/Viewport`).
- shoot-moods hides the HUD; with the HUD visible frames cost ~1.3 ms more.
- The project lives in OneDrive: if files fail to read with `UNKNOWN: unknown error, read` / "cloud file provider is not running", OneDrive is not running and files are cloud-only placeholders. Ask the user before starting it.

## Then

1. Read every PNG you produced. Describe what you see, concretely, before claiming success.
2. If comparing before/after, shoot both with the same tool and viewpoint.
3. Update the committed `playthrough.png` only when the change is meant to ship.
4. Stop the background dev server when finished.
