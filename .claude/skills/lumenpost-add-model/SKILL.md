---
name: lumenpost-add-model
description: Bring a new 3D model (prop, building, resident) into LUMENPOST — generate via Meshy or take a supplied .glb, optimise it, check it, and place it on the planet. Use when the user says "добавь модель", "сгенерируй здание/дерево/NPC", "Meshy", "import glb", "replace primitive with a real model".
---

# Add a model

Pipeline rules live in `public/assets/models/README.md` — read it first; this is the operational checklist.

## 1. Get the file

- **Small prop** (lantern, rock, plant): text-to-3D is acceptable.
  `node tools/meshy.mjs text "<prompt>" <name>` (key in `.env` as `MESHY_API_KEY`; never print it, never pass it on the command line). Jobs that outlive the shell: `meshy.mjs status <taskId>` / `fetch <taskId> <name>`.
- **Anything the player stands next to** (buildings, gates, residents): image-to-3D from a concept image — one object, three-quarter view from slightly above, plain white background, no ground/shadow, "stylised anime / Studio Ghibli look". Text-to-3D produced smears and wrong architecture every time. Keep the concept image so a re-run stays in the same family.
- **User-supplied .glb**: copy into `public/assets/models/<name>.glb`.

Style: Japanese village, Ghibli afternoon. Residents at **realistic human proportion** (chibi next to the 7-head player read as wrong).
Generating via Meshy spends the user's credits — confirm before submitting jobs.

## 2. Optimise

```bash
node tools/optimise-glb.mjs public/assets/models/<name>.glb            # in place
node tools/optimise-glb.mjs public/assets/models/<name>.glb "" 1024     # hero building: 1024 map
```

Budgets: prop < ~5k tris, 1 material, 512–1024 texture. Hero building ≤ 12k tris, 1024 map.

## 3. Check (dev server running — see the `lumenpost-look` skill)

```bash
node tools/shoot-model.mjs <name> <heightM> <scratch>/<name>.png
```

Read the PNG. Reject: wrong architecture, geometry growing out of legs/walls, over budget.

Generated buildings often carry passengers — a tree fused to the side, a lump under the floor. A lump under the floor lifts the whole model off the ground (`groundLevel` anchors on it). Run `node tools/strip-debris.mjs public/assets/models/<name>.glb --dry`, read which pieces it would remove, then run it without `--dry` and shoot the model again. Per-file only: on other models the small pieces are lanterns and flower pots.

Placed props get collision automatically (`addObstacle` in PlanetScene, footprint at body height from `engine/physics/colliders.ts`); a prop added some other way needs `this.addObstacle(mesh)` or the player walks through it.

## 4. Place

- Scattered/instanced decoration → `PlanetScene.addImportedProp(name, positions, height, seed, options)` (`src/game/scenes/PlanetScene.ts`). It's one InstancedMesh, fire-and-forget, returns nothing on load failure. Pass `yaws` for anything with a facing (gates face along the path); `randomYaw` only for things without one.
- Positions come from `src/game/world/layout.ts` — layout runs **before** terrain, and buildings get a level pad cut into `heightAt`. A new building needs a footprint there or it will float on slopes.
- Single hero object or resident → `loadStylisedModel` (`src/engine/render/stylise.ts`), keep the procedural version as fallback (pattern: lighthouse, residents). A failed load must leave the old thing, never a hole.
- Instanced meshes spanning the planet: frustum culling is off by design; horizon culling is per instance. Don't re-enable `frustumCulled`.
- Colours are pulled toward the world tint by `harmonise` (default 0.08) — don't hand-tweak textures for that.
- The world is PBR-lit (docs/24): ask Meshy for PBR maps — `styliseModel` keeps normal/roughness/metalness/AO maps and they visibly help. Metalness is capped at 0.15.
- **Don't import trees.** Generated tree hulls look like faceted rock under real light; trees are procedural leaf-card crowns in `src/game/world/Trees.ts` (add a species there: a `SpeciesStyle` + a leaf painter).

## 5. Verify and ship

- `node tools/probe-grounding.mjs` for anything with a footprint.
- `node tools/shoot-world.mjs` and look.
- Watch the total model size (`du -ch public/assets/models/*.glb | tail -1`; it was ~4.7 MB at 17 assets per commit 8c38ede). Mention the new total in the commit.
- Finish with the `lumenpost-ship` skill.
