# Imported models

Drop Meshy exports here as .glb, then check them before wiring anything up:

    npm run dev
    http://localhost:5173/tools/model-preview.html?model=/assets/models/YOURS.glb&height=3

Four views against a metre grid, with a 1.65 m post beside them for human
scale — the two things that go wrong with a bought asset are scale and origin,
and neither is visible without something known next to it.

The readout underneath is the part that decides whether an asset ships as-is:
triangle count, material count and texture size. Eyeballing a model tells you
nothing about any of them.

Budget for this world: under ~5k triangles for a prop, one material, 512 or
1024 texture. Anything bigger is not "higher quality" here, it is a draw call
and a memory cost buying detail that a cel shader throws away.

## Hero buildings: concept first, then image-to-3D

Text-to-3D was fine for a lantern and hopeless for a house: the shop came back
as a smear, the "shrine" as a Chinese pavilion, the gate with a beam growing
out of one leg at ground level. A generator working from words invents the
look; one working from a picture reproduces it.

So anything the player stands next to is made in two steps:

1. A concept image — one object, three-quarter view from slightly above, plain
   white background, no ground, no shadow, "stylised anime / Studio Ghibli
   look". The white background matters: it is what the 3D step segments on.
2. `image_to_3d` from that concept (Meshy, via either API), textured,
   8–12k triangles, then `tools/optimise-glb.mjs <file> 1024`.

Hero buildings are allowed 12k triangles and a 1024 map — they are the thing
you look at. Torii, shrine and the tea house came through this pipeline; the
concepts are worth keeping, because a re-run from the same picture gives a
model in the same family rather than a new guess.

Check every result with `node tools/shoot-model.mjs <name> <height> out.png`
before it goes in: the report catches scale and budget, the picture catches
everything else.
