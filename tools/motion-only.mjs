/**
 * Strip a rigged, animated glTF down to its skeleton and clips.
 *
 * The VRM player plays clips recorded for another skeleton, retargeted at
 * load (src/game/entities/retarget.ts). All that needs is the joints and
 * their animation; the mesh, skin and texture are dead weight (2.9 MB → 0.6 MB
 * for the Meshy heroine). Given a character manifest, only the clips its
 * `clips` table names are kept, so unused ones are not retargeted at load.
 *
 * Usage:  node tools/motion-only.mjs <in.glb> <out.glb> [manifest.json]
 *
 *   node tools/motion-only.mjs public/assets/characters/heroine.glb \
 *     public/assets/characters/heroine-motion.glb src/data/characters/heroine.character.json
 */
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const [input, output, manifestPath] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node tools/motion-only.mjs <in.glb> <out.glb> [manifest.json]');
  process.exit(1);
}

const keep = manifestPath
  ? new Set(Object.values(JSON.parse(readFileSync(manifestPath, 'utf8')).clips ?? {}))
  : null;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

for (const node of root.listNodes()) {
  node.setMesh(null);
  node.setSkin(null);
}
for (const skin of root.listSkins()) skin.dispose();
for (const mesh of root.listMeshes()) mesh.dispose();

const dropped = [];
if (keep) {
  for (const animation of root.listAnimations()) {
    if (keep.has(animation.getName())) continue;
    dropped.push(animation.getName());
    // Samplers outlive their animation and keep their keyframe accessors
    // referenced, so prune would leave the clip's data in the file.
    for (const channel of animation.listChannels()) channel.dispose();
    for (const sampler of animation.listSamplers()) sampler.dispose();
    animation.dispose();
  }
}

// Joints at the ends of chains (head_end and the like) carry no mesh and no
// keys, but the retarget aims bones at them: keep the leaves.
await doc.transform(prune({ keepLeaves: true }));
await io.write(output, doc);

const clips = root.listAnimations().map((a) => a.getName());
console.log(`${output}: ${root.listNodes().length} joints, ${clips.length} clips (${clips.join(', ')})`);
if (dropped.length) console.log(`dropped, not in the manifest: ${dropped.join(', ')}`);
