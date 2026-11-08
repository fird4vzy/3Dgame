# 25 — A world you cannot walk through

Four reports from the first play session on the new look, all real:

1. She held the light strangely.
2. Some houses hung in the air.
3. She walked through houses (and the camera followed her inside).
4. Standing still, she slid.

## 1. The lantern

The carried lumen was a 26 cm orb inside a 46 cm ring, centred on her wrist,
with a point light at the same spot. The ring read as a frying pan; the light,
centimetres from her forearm, blew the arm out to white, and bloom turned it
into a glowing streak.

Now it is a 7 cm bottle of light on a brass bail, hanging 16 cm below her
fingers. It lives in the body's space and *follows* the hand bone on a slightly
under-damped spring (ω ≈ 12 rad/s, ζ ≈ 0.55), so it hangs plumb, lags a little
and settles in a few swings. Its light is a spot pointed at the ground — a warm
pool at her feet, nothing aimed back up the arm.

## 2. The floating minka

The generator fused two dead trees and a lump of debris to the farmhouse.
`groundLevel` anchors a model on its lowest slab holding ≥ 0.5% of its
vertices, and the 40-triangle lump under the floor qualified: the whole house
stood on it, half a metre up, with a tree through the eaves.

`tools/strip-debris.mjs` splits a model into connected pieces (welded by
position, so UV seams are not cuts) and removes pieces wholly under the main
body's floor or sticking out of its footprint. It is a per-file tool, run on a
model someone has looked at: a blanket filter would also strip the stones,
lanterns and flower pots that make the other buildings lived-in. Dry-run on
every building flagged only the minka. Worst footprint gap afterwards: 0.16 m.

## 3. Collision with props

The BVH held the terrain and nothing else. Props now get colliders derived
from their own geometry (`engine/physics/colliders.ts`): the model is sampled
in a slab from knee to shoulder (0.3–1.5 m), occupied 20 cm cells are marked,
and each row's runs become boxes extruded from −0.5 to ≥ 2.4 m. A torii gives
its two posts and the way through stays open; a house gives its walls; a tree
its trunk. ~56k triangles for the planet.

They live in a second BVH that the capsule resolves against but that is never
ray-cast — grounding, gliding and the camera see terrain only, so there is no
invisible ledge to land on. Obstacle pushes are horizontal, along the face
normal (not toward the closest point, which on a box split into triangles lies
on the face's diagonal and shoved the player along every wall), and come back
separately as `wallNormal`, so leaning on a wall never reads as a slope too
steep to stand on.

The playthrough bot steered straight at its target and now meets walls; it
sidesteps when it stops making progress, as a player does. The smoke suite
measures speeds and grounding on open ground, so it lifts the obstacles for its
twelve-second run.

## 4. Idle creep

Every fixed step gravity pressed the capsule a few millimetres into the slope,
and depenetration pushed it back out along the slope's normal, which leans
downhill: about a millimetre a step, 5 cm/s. The debug panel never read
0.00 m/s at rest. Once friction has stopped her on walkable ground with no
input, her point on the surface is pinned and only her height may change.
`collision.test.ts` stands a controller on a 12° slope for five seconds:
under 2 mm of movement.

## Not fixed here

Running still looks procedural. The gait in `entities/gait.ts` has been
rebuilt four times (docs/20); the next step is motion-captured clips
retargeted onto the VRM rather than a fifth pass at the formulas.
