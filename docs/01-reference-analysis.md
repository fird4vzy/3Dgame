# 01 — Reference Analysis: *Messenger* (abeto.co)

> **Scope note.** This environment's network policy blocked direct access to
> `messenger.abeto.co` (proxy returned `403` on CONNECT), so this analysis is
> reconstructed from published coverage, the developers' own technical notes as
> reported in the press, and gameplay descriptions — not from a hands-on
> playthrough. Items I could not verify are marked **[unverified]**. Nothing in
> this repository derives from the reference's code or assets; the analysis
> exists only to extract *design lessons*.

## 1.1 What the reference is

| Attribute | Detail |
|---|---|
| Title / studio | *Messenger*, published by Abeto (Vicente Lucendo, Michael Sungaila), 2025 |
| Platform | Browser, desktop + mobile, free, no ads, no install |
| Genre | Cozy 3D exploration / errand-running ("wholesome walking sim") |
| Session length | 15–30 minutes, single sitting, completable |
| Core fantasy | A teenage mail carrier delivering letters and parcels on a tiny planet |
| Tech | Three.js + WebGL, `three-mesh-bvh`; models in Houdini/Blender; textures in Substance; WebSocket multiplayer on Node — hand-rolled rather than Unity/Godot |
| Payload | ~5.7 MB initial load, ~17.5 MB total |
| Art | Cel-shaded low-poly, soft saturated palette, anime-adjacent, heavy environmental storytelling |

## 1.2 Gameplay loop

The loop is deliberately shallow and legible:

```
Receive parcel  →  Read the "who / where" hint  →  Traverse the planet
      ↑                                                    ↓
  Next parcel  ←  Small story beat / reaction  ←  Find recipient, hand off
```

Roughly **five deliveries** carry the whole game. Each is a self-contained
vignette rather than a mechanical challenge: a worker mails a furious letter to
his boss (who finds it funny); a balding man receives a letter from his younger
self telling him to look after his hair. The *reward for play is narrative and
visual discovery*, not power or score.

## 1.3 The planet — the single most important design decision

The world is a small sphere. Curvature is visible **metres** in front of the
player; the whole planet is roughly the footprint of one city block in a
conventional game. Districts observed in coverage: a **power plant**, a
**forest**, and a **city**.

Why this works, and what to steal (as a *technique*, not as content):

- **No map screen is needed.** The horizon is close, so the next landmark
  crests into view as you walk. Navigation is diegetic; UI stays almost empty.
- **Walking in one direction returns you home.** There are no dead ends, no
  invisible walls, no "you are leaving the play area." Exploration cannot fail.
- **Density beats size.** Because the surface is small, every square metre can
  be hand-decorated. The player is rewarded for looking, constantly.
- **Cheap to render.** A small world means one scene, no streaming, and a tiny
  download — which is what makes an instant-play browser title viable.

## 1.4 Interaction mechanics

- Free movement across the sphere surface; gravity always points to the core.
- Proximity-based interaction with NPCs — walk up, prompt appears, engage.
- Third-person follow camera orbiting a player who is himself re-oriented to
  the local surface normal. **[unverified in detail]**
- **Character customisation**: four slots — hair, top, bottom, shoes — behind a
  shirt icon in the bottom-right.
- **Emote wheel**: an icon in the bottom-right opens ~10 emotes, which spawn as
  floating 3D emoji around the character.
- **Multiplayer presence**: other real players are visible on the planet and
  communicate *only* through emoji. No text chat.

That last point is a quietly excellent design choice: emoji-only presence gives
social warmth with zero moderation surface, zero localisation cost, and zero
risk of harassment derailing a cozy tone.

## 1.5 Progression, win and lose conditions

- **Progression** is narrative and spatial: the delivery list shortens, and the
  player's mental map of the planet fills in. There is no XP, no currency, no
  unlock tree, no stat growth.
- **Win condition**: complete the delivery set; the story resolves.
- **Lose condition**: *there is none.* No death, no timer, no fail state. This
  is the defining genre convention of cozy games — the tension comes from
  curiosity, not risk.

For a commercial product this is both the reference's greatest strength (total
accessibility) and its greatest weakness (**no reason to replay, no mastery
ceiling, no retention hook**). Section 2.3 of the GDD addresses this directly.

## 1.6 Animation, camera, transitions, feedback

| Layer | Observed / inferred behaviour |
|---|---|
| Character | Skeletal locomotion set — idle, walk, run, plus carry and hand-off poses; smooth blends **[unverified]** |
| Orientation | Character continuously re-aligned to the surface normal as the sphere curves beneath them |
| Camera | Third-person spring-follow, orbit control, kept upright relative to *local* up rather than world up |
| NPCs | Idle loops and reaction beats — the "story" is delivered through animation and staging more than text |
| Transitions | Fast, minimal — instant-play means the loading screen is the first impression and must be short |
| Feedback | Environmental: reactive props, particles, ambient audio; a soothing soundtrack sustains tone |

## 1.7 Game feel — the thing actually worth copying

The reference's quality is not in its mechanics; it is in **restraint plus
craft**:

1. **Instant play.** Click a link, be walking within seconds. No account, no
   install, no ads. 5.7 MB initial is an extraordinary discipline and it is the
   real product feature.
2. **Legible world.** One glance tells you where you are and where you might go.
3. **Softness everywhere.** Rounded silhouettes, gentle palette, no sharp audio
   transients, no punitive systems.
4. **Detail as the reward loop.** Curiosity is repaid every few metres.
5. **Short and finished.** It respects the player's time and ends deliberately.

**Design lessons carried into our game:** the tiny sphere as a navigation
solution; emoji-only social presence; a hard download budget treated as a
first-class design constraint; no-fail traversal; environmental storytelling
over text dumps.

**Where we deliberately diverge** (see `02-game-design-document.md`): we add a
*visible world-state transformation* as the progression fantasy, an optional
skill-expression traversal verb (gliding), and an opt-in mastery layer — so the
game has a reason to be replayed and a shape that supports post-launch content.
