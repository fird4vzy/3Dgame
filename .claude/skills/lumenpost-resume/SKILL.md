---
name: lumenpost-resume
description: Figure out where LUMENPOST development stopped and what to do next. Use at the start of a session, or when the user asks "где остановились", "что дальше", "напомни статус", "what's next", "where were we".
---

# Resume LUMENPOST

Rebuild the current state from the repo itself — never from memory alone, it goes stale.

## 1. Gather (run in parallel)

```bash
git status --short && git branch -vv
git log --format='%h %ad %s' --date=short -15
git log -3 --format='--- %h %s%n%b' --stat     # bodies explain *why*; read them
git diff main --stat | tail -1                  # how far the branch is ahead of main
ls docs/                                        # numbered logs; highest number = latest written log
```

Also look at `playthrough.png` (Read tool) — it is the last screenshot from the full playthrough and shows the current look.

## 2. Health check

```bash
npm run typecheck && npx vitest run
```

Report pass/fail counts. Don't start new work on a red tree without saying so.

## 3. Know where the "plan" lives

- `docs/13-roadmap.md` — phases 0–7. Later work went past the roadmap (VRM player Aria, Japanese village art, Meshy pipeline, the painterly look).
- `docs/14..27-*.md` — per-feature build logs. `docs/24-cinematic-look.md` is the rendering rebuild (PBR, atmosphere, grass, trees, water) and its "Still to do" list; `docs/25` solid world; `docs/26`–`27` the courier. Work between 2026-08-01 and 2026-09-20 is documented only in commit messages.
- `public/assets/models/README.md` — the asset pipeline rules.
- `src/data/content.ts` — districts, NPCs, contracts.

## 4. Known open threads (verify each still applies before stating it)

- **The Spire** district is the only one still primitive-only (`buildDistrictProps` → `buildRocks`) besides the authored lighthouse.
- `villager_child.glb` is retired from the cast until a properly proportioned model exists.
- Look follow-ups in `docs/24` "Still to do": day/night + weather (the reference's other moods), normal maps for Meshy buildings.
- The player is Aria (`aria.vrm`), dressed from the character sheet at load (`entities/outfit.ts`) and moving with the Meshy heroine's captured clips retargeted onto her rig (`entities/retarget.ts`, `docs/27`). Clip mapping lives in `src/data/characters/heroine.character.json`; new clips: `tools/meshy.mjs animate <rigTaskId>` (ask before spending credits), then rebuild the clip file with `node tools/motion-only.mjs public/assets/characters/heroine.glb public/assets/characters/heroine-motion.glb src/data/characters/heroine.character.json` (joints + named clips, no mesh). The Meshy mesh `heroine.glb` is only the fallback.
- Open on the courier: the top is sleeveless (the sheet has rolled sleeves; needs new geometry), the hair is static (springbones off), the VRM is a 16.5 MB download.
- Roadmap Phase 5 (accessibility, photo mode, juice pass) and Phase 6 (optimisation, device matrix) not started as such.
- Branch `claude/browser-game-design-tm60li` has never been merged to `main`.

## 5. Report

Answer in the user's language (usually Russian). Short:
1. Last thing done (1–2 lines, from the newest commit body).
2. Health (tests/typecheck).
3. 3–5 concrete next steps, ranked, each naming the files it touches. Recommend one.
