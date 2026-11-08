---
name: lumenpost-content
description: Add or change LUMENPOST game content — districts, NPCs/residents, delivery contracts, dialogue, quest order. Use for "добавь квест/доставку/персонажа/район", "измени диалог", "new contract", "new NPC".
---

# Content is data

Everything lives in `src/data/content.ts` (`DISTRICTS`, NPCs, `ContractDef`s with dialogue). The rule from `docs/05-folder-structure.md`: **adding a district, contract or NPC requires zero system changes.** If you find yourself editing a system in `src/game/systems/` to add content, stop and say why.

## Authoring rules

- Positions are `{ lat, lon }` in degrees on a 60 m planet. Use the dev debug overlay (shows lat/lon of the player) to pick spots; districts claim the nearest centre within `radius`.
- Any two districts should be ~90 s of walking apart.
- `DistrictId` is a union type — a new district means extending it, plus a `buildDistrictProps` case in `src/game/entities/districtProps.ts` (TypeScript will force the switch), a music stem name, and a layout entry in `src/game/world/layout.ts`.
- Music stems must stay sample-locked (same length, 96 BPM, A minor, 20 s). New stem = `tools/generate-audio.mjs` or a drop-in file with the same name.
- Contracts: `prerequisites` form a graph — check there's no cycle and the first contract has none. `parcel.warmthSeconds` must be achievable at walk speed; the game has no fail state, ratings never punish.
- Dialogue tone: cozy, short lines, no exposition dumps. Speaker names must match NPC `displayName`.
- Residents get a model by **role**, not at random (`PlanetScene` resident loading).

## Verify

```bash
npx vitest run                 # phase3 tests cover quest graph / delivery
npm run test:play              # scripted full playthrough — must still complete all contracts
```

The playthrough script (`tests/e2e/playthrough.mjs`) walks contracts in order — new contracts may need it updated. Then `lumenpost-ship`.
