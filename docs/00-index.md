# LUMENPOST — Design Documentation Index

Design phase. **No implementation code has been written** — this set is for
review and approval before Phase 0 begins.

| # | Document | Deliverable |
|---|---|---|
| [01](01-reference-analysis.md) | Reference analysis — *Messenger* (abeto.co) | Gameplay analysis |
| [02](02-game-design-document.md) | Game Design Document | 1 |
| [03](03-gameplay-specification.md) | Gameplay specification (all tuning values) | 2 |
| [04](04-technical-architecture.md) | Technical architecture + framework rationale | 3 |
| [05](05-folder-structure.md) | Folder structure | 4 |
| [06](06-asset-specification.md) | Asset specification + **character asset contract** | 5 |
| [07](07-asset-checklist.md) | Asset checklist + pipeline + budgets | 6 |
| [08](08-state-machine.md) | State machines (global, player, delivery) | 7 |
| [09](09-scene-flow.md) | Scene flow + lifecycle | 8 |
| [10](10-ui-flow.md) | UI architecture + flow + responsive | 9 |
| [11](11-class-diagram.md) | Class diagrams | 10 |
| [12](12-event-flow.md) | Event flow + frame ordering | 11 |
| [13](13-roadmap.md) | Development roadmap + risks | 12 |

## The short version

**Reference** — *Messenger* by Abeto: a cozy 15–30 minute browser game where a
young mail carrier delivers letters on a tiny sphere you can walk around in 95
seconds. Three.js/WebGL, 5.7 MB initial load, no fail state, emoji-only
multiplayer. Its genius is restraint plus craft, and a download budget treated
as a product feature.

**Our original game — LUMENPOST** — *"A tiny planet. A bag full of light.
Everyone's waiting."* You are a courier on the dimming planet of Fennwick, and
every parcel is bottled light. Each delivery visibly relights a district: lamps
ignite, colour floods back, and a new music stem joins the score. Three original
systems give it a commercial spine the reference lacks — **illumination
progression** (the world *is* the progress bar), **glide traversal** (skill
expression, never required), and **freshness ratings** (an opt-in mastery layer
that can never punish).

**Stack** — Three.js + TypeScript + Vite. Not Phaser or Pixi: both are 2D
renderers and cannot draw a walkable sphere. Full reasoning in
[04 §4.1](04-technical-architecture.md#41-framework-choice--and-why-not-phaser-or-pixi).

**Your assets** — every character is described by a JSON manifest that maps our
clip and socket names to whatever you deliver (glTF preferred; FBX, per-clip
glTF, sprite sheets and Spine all supported). A placeholder rig ships with the
repo so every system is built and tested before your art arrives. Swapping in
the real character is a one-file edit. See
[06 §6.2](06-asset-specification.md#62-character-asset-contract--read-this-before-exporting-characters).

**Timeline** — ~11 weeks to a ship candidate, with a playable vertical slice at
week 3 and the full loop playable at week 6.
