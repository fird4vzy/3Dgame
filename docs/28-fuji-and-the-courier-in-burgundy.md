# 28 — Fuji over the village, burgundy and brown, mouse look

Four requests after docs/27:

1. She likes burgundy and brown; dress her in them.
2. Turning the camera needed a held mouse button; plain mouse movement
   should turn it.
3. Mount Fuji over the village.
4. She stood crooked again (a screenshot on a hillside, leaning back).

## 4. Crooked: she leaned with the hill

The controller stood the body along the **ground normal**. On a slope she
tilted with it, which reads as leaning back facing uphill and toppling
forward facing down. In the screenshot she faced up a 22–25° flank and leaned
back by that much. Nothing in the animation was wrong.

The body now stands along local gravity, the radial up
(`SphericalCharacterController.orientToSurface`); the spec (docs/03, step 7
of the movement loop) says so too. Measured on a 22° flank: 0.01° from vertical. Her feet
meet the slope a few centimetres off, in grass that hides them. A test in
`collision.test.ts` puts her on a 22° plane and fails if the body tilts
more than 1°.

## 1. Burgundy and brown (`entities/outfit.ts`)

Same repaint as docs/27, new palette in one place (`OUTFIT`):

- **Top**: burgundy `#581624` ribbed knit. The ribs are about 8 mm apart
  and a sixth darker, so up close it reads as knitwear, and from the camera
  they melt into the colour.
- **Trousers**: mocha brown `#644e3e` from the jeans' texture. Trims (gold
  stitching, rivets, patch, red tab) keep their colours. The shadow tone
  moves from VRoid's pink to a neutral warm grey.

The colours are chosen for the game, not the swatch. The grade adds
saturation (×1.32), and the light is warm, so the first try (`#761c2c`,
`#7e5438`) rendered as bright red and orange. Dark burgundy with a mid
brown keeps the two apart under every mood.

## 2. Mouse look (`engine/input/InputManager`)

The pointer is locked to the canvas while playing, and plain movement turns
the camera. The lock follows `setEnabled`, which every non-play state
already went through:

- **Off** (menu, pause, conversation): the pointer is released, so there
  is a cursor to click with.
- **On**: the lock is taken again. The browser allows that only right after
  a click or a key press; it does after Begin, Resume, or a conversation
  closed with a key.
- **Otherwise**: the next click on the canvas takes it.

Escape releases the lock, and Chrome still delivers the key, so it pauses
as before. Dragging with a button still turns the camera wherever the lock
is refused, so nothing depends on it.

One latent bug came with it. `setPaused(false)` and `setPlayerLocked(false)`
turned input on without checking menu mode, which was harmless until input
on meant pointer locked. Leaving the pause screen for the main menu would
have locked the cursor over the menu.

## 3. Fuji (`world/Fuji.ts`)

The planet is 60 m across, so a mountain on it would be a hill. Fuji
stands 460 m out from the village's axis, past the planet's rim, its foot
below that rim. From the village it rises over the curve of the world the
way a real mountain rises over the curve of the sea. Like the sun, it sets
behind the planet as you walk round to the far side. It is hidden in the
orbital menu shot, as the sky is.

- **Profile**: height falls off as `(1 − r/R)^1.35`. That gives about 30°
  at the summit, 24° halfway down and 14° near the foot: the long concave
  sweep that makes it Fuji rather than a cone. A shallow crater flattens
  the top, and a skirt below the foot keeps the edge out of sight.
- **Size**: 150 m tall, 350 m in radius, peak 9° above the village's
  horizon, snow cap about 25° across.
- **Direction**: bearing 250° from the village centre (WSW). The village sits
  in a hollow. Toward the obvious choice, front-lit opposite the sun, the
  hill under the shrine rose over everything but the very tip; a flat red
  stand-in showed it. A terrain-horizon survey (every 15° of bearing) found
  the open side to the west. There the sun, NNW of everyone, lights the
  mountain from the side.
- **Shading**: its own shader. The atmosphere is built for things within a
  few dozen metres and would fog a mountain at 460 m out entirely. Instead it
  is lit by the same sun and fades toward the same haze, heavier at the
  foot (lost in the air) than at the snow. Snow lies above two-thirds of
  the height and runs down the ravines in streaks, from noise wrapped round
  the cone so there is no seam.

The camera's far plane went from 400 m to 650 m to reach it.

## Looking at it

`node tools/shoot-player.mjs out/` now includes `player-fuji-<mood>.png`:
the village looking toward the mountain in all three moods.

## Tests

243 unit tests (8 new):

- Fuji's profile: skirt, monotonic flanks, crater, concavity, and the
  slope at the summit.
- Its placement.
- Mouse look: lock on play, release for menus, movement without a button
  while locked, ignored when not.
- The plumb stance.

The smoke test now clicks the canvas, checks the pointer is taken, and turns
the camera with a plain mouse move (25° for 200 px), then back.

The playthrough refuses the lock. Its steering drags from the same spot for
every turn, and with the pointer locked the trip back to that spot is itself
a turn that undoes the last one. The first run with the lock walked in
circles and never reached the recipient. It now steers through the drag
fallback, as in a browser without pointer lock.

Headless at 4–8 fps, the lock taken by the Begin click often arrives after
the browser has forgotten the click: the iris transition outlasts the
activation. A click on the canvas then takes it, as in a real browser where
the lock was refused.
