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
