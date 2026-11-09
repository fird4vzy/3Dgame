# 29 — Twenty frames to fifty, Fuji on the horizon, the lantern in her hand

Four reports after docs/28, from screenshots taken on the player's laptop
(Intel Core 5 210H with its integrated graphics, a 2880×1800 panel):

1. "Things lag a little behind": running, the lantern hung at her hip while
   her hand was forward.
2. The game lagged badly on that laptop. The debug panel read 22–24 fps.
3. Fuji was enormous: from some places its flank filled half the sky. It
   should sit in the background, like the mountain behind a shop front in a
   photograph.
4. At the end of the run, "Keep exploring" did nothing.

## 2. The frame rate

It was not the resolution. Playwright's Chrome on that machine draws on the
real GPU, so the tools measure what the player sees. With the render scale
forced down to 800×450 it still ran at 23 fps, and the CPU was busy for 8 ms
of a 43 ms frame. There were three causes, worst first.

**Every copy of every prop, everywhere.** Props are instanced across the
whole planet. An InstancedMesh draws all of its instances, and one that spans
a sphere can never be frustum-culled. The horizon is 13.5 m away, so most of
them are round the curve at any moment. Yet they were drawn three times a
frame: for the picture, the shadow map and the water's mirror. That came to
1.7 million triangles per pass. Bamboo alone was 432k (115 copies of 3.8k).

`engine/render/HorizonInstances` now compacts each static instanced mesh
every frame. The instances that crest the horizon are written to the front of
the buffer, and `count` stops after them. An instance can be seen while its
angle round the planet from the camera is under a reach. The reach adds the
camera's tangent to the horizon, the tangent from the instance's own top (a
tall thing crests from further away), its width, and a small slack. The
occluding sphere is sea level less half a metre, because hills only ever hide
more. The buffer is rewritten only when the visible set changes. Meshes opt in
with `userData.horizonCull`: `addImportedProp`, `plantTrees`, the district
props' `instanced()` and the ground cover's `scatter()`.

Nothing else depended on the full buffer. The obstacle BVH snapshots the
instances when a prop is added, before any culling. Camera-occluder raycasts
read the compacted set, with its bounds reset after each compaction. The cats
write their own matrices every frame, so `Cats.update` packs each visible
cat into the mesh for its expression. Hiding a cat used to mean giving it
zero scale, and a zero-scale instance still sends every vertex through the
vertex shader. In the Landing this took the frame from 23 to 56 fps at the
same scale. 6 bamboo stands are drawn instead of 115, and 3 cats instead of 30.

**The light count changed as you walked.** Each street lamp carried its own
PointLight, and the lamp groups are culled at the horizon. three compiles the
number of lights into every lit shader, so each lamp that came over the
horizon or went behind it recompiled every material on the planet. Measured:
over eight seconds of running the program count climbed 69 → 97 → 124, with
frames of 1.26 s. The carried lantern's SpotLight did the same, created with
each parcel and removed with it.

`engine/render/LightPool` holds a fixed set of lights: 4, or 2 on the low tier
and 6 on high. Each frame they are lent to the nearest lit lamps. The last one
fades out over 3 m as the next lamp comes as close, so a light changing hands
never pops. The lamps' own lights are never drawn, and the illumination system
sets their colour and brightness exactly as before. The lantern's glow is now
a single SpotLight for the whole game. The program count stays at 69 in every
district. The cost: on the medium tier only the four nearest lamps light the
ground. The rest still glow.

**The wrong tier.** `detectTier` read only cores and memory. With 12 threads
and 16 GB the laptop came out as high: a device pixel ratio of 2 and 4× MSAA,
which on that panel is 5 Mpx a frame. Graphics built into the CPU now cap the
tier at medium. That means Intel (not Arc), AMD's "Radeon Graphics" APUs and
phone GPUs (`isIntegratedGpu`). Each tier also has a pixel budget for the
drawing buffer: 0.9 Mpx on low, 1.3 on medium, 3.7 on high. `?quality=low`,
`medium` or `high` in the address overrides the guess. So does a saved
`qualityTier`, which boot had never read.

Adaptive resolution made things worse. It judged every frame and recovered
only above 58 fps, which a 60 Hz display rarely reports. One slow patch at load
sent it to the floor of 0.5, where it stayed: a blurred picture for no frames
gained. It now judges twice a second, steps down below 40 fps and up above 52,
and stops at 0.6.

Measured on that laptop with its panel emulated (1440×900 CSS at 2×), golden
hour, every district lit:

| | before | medium (default) | `?quality=low` |
|---|---|---|---|
| Landing, standing | 23 fps | 50 | 75 |
| Landing, running | frames over a second while shaders recompiled | 43 | 60 |
| Bramblewood | | 35–38 | 45–60 |
| Tidebreak | | 47 | 70–77 |
| Coil | | 45–50 | 76–80 |

Tried and dropped: simplifying the shrine and the noren house. At 11.5k and
10.6k triangles they carry two and a half times the rest of the catalogue,
and the village has ten of each. But their UVs give nearly every triangle its
own island, and meshoptimizer, even unconstrained, only reached 10k and 8.3k.

## 1. The lantern

The lantern follows the hand on a spring. The old one (stiffness 140, damping
13) rang at about 1.9 Hz, close to a running arm's swing of about 1.4 Hz, so it
resonated. Its step was also clamped to 1/30 s, which ran it in slow motion
below 30 fps. Against a ±25 cm swing at 1.4 Hz it trailed by up to 25 cm at
any frame rate. That is the whole swing, and it is what the screenshot shows.
Now it is stiffness 900 and damping 33 (about 4.8 Hz, ζ ≈ 0.55), sub-stepped at
120 Hz: it trails by 5–9 cm at worst, a sway rather than a lag.

## 3. Fuji as a backdrop

docs/28 stood the mountain 460 m out in the world, with a foot 350 m in
radius. That looked right from the village and wrong elsewhere. A few dozen
steps round a 60 m planet is a large part of the way to it, and from the far
side of the hill its flank filled the sky.

It now travels with the camera, like the sky. It stands 380 m off toward one
fixed world direction (the village's west-south-west, as before), upright on
the local up. Its foot is tucked 4° under the visible horizon, which dips
`acos(R / r)` below level and further from higher up. Its summit is 7° above
the horizon. It is the same size from anywhere and cannot be approached. A
direction projected onto the ground vanishes at two points on a sphere, so
near those it fades into the haze rather than spinning. Checked from the
Landing, from the spot in the screenshot, and from the far side of the world.

## 4. "Keep exploring"

There were two faults, and either was enough. The run never left `playing`:
the `complete` state existed, but nothing sent `finalDelivery`. So input
stayed live behind the report. She could walk around behind it, and pressing
the mouse on the button took the pointer lock for mouse look (docs/28), so
the click went to the canvas. The button also asked to resume, and the pause
flow resumes only from `paused`.

Now the report sends `finalDelivery` and pauses the scene, which turns input
off and releases the pointer. `complete → resume → playing` is a new
transition, and the pause flow's resume closes the report like the pause
menu. The final district's ignition waits behind the report and finishes
once it closes.

## What the tests could not see

All of it. The unit suites passed throughout, and the browser suites run on
SwiftShader at the low tier. The recompiles cost nothing that a test asserts:
they show only as frame time on a real GPU. The number to watch is
`renderer.info.programs.length`, and it should not climb while walking. New:
horizon-culling tests (compaction, colours, walking round, tall versus short),
Fuji on the horizon from two altitudes and fading where its bearing points
into the ground, integrated-GPU detection, and the `complete` state
round-trip.
