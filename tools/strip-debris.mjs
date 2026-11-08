/**
 * Strip generator debris from a GLB, in place.
 *
 * Image-to-3D models arrive with passengers: a dead tree fused to the side
 * of a farmhouse, a lump of something hanging under the floor. The lump is
 * the dangerous one — `groundLevel` anchors a model on its lowest slab with
 * real vertices in it, so forty triangles under the floor lift a whole
 * house half a metre into the air. That was the floating minka.
 *
 * This splits the first mesh into connected pieces (welding by position, so
 * UV seams do not count as cuts) and removes two kinds:
 *
 *  - pieces lying entirely below the main piece's floor, and
 *  - detached pieces that stick out of the main piece's footprint by more
 *    than `--reach` of its width (a tree standing beside the house).
 *
 * Pieces *inside* the footprint are kept: on other models those are the
 * lanterns, potted plants and stones that make a building lived-in. Run it
 * on a model you have looked at, read the report, then look again with
 * tools/shoot-model.mjs. `--dry` reports without writing.
 *
 * Usage:  node tools/strip-debris.mjs <file.glb> [--reach 0.08] [--dry]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const dry = args.includes('--dry');
const reachArg = args.indexOf('--reach');
const REACH = reachArg >= 0 ? Number(args[reachArg + 1]) : 0.08;
if (!file) {
  console.error('usage: node tools/strip-debris.mjs <file.glb> [--reach 0.08] [--dry]');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
const primitive = doc.getRoot().listMeshes()[0]?.listPrimitives()[0];
if (!primitive || !primitive.getIndices()) {
  console.error('expected an indexed mesh');
  process.exit(1);
}

const position = primitive.getAttribute('POSITION').getArray();
const indexAccessor = primitive.getIndices();
const index = indexAccessor.getArray();
const vertexCount = position.length / 3;

// Weld by position for connectivity only.
const canonical = new Map();
const rep = new Int32Array(vertexCount);
for (let i = 0; i < vertexCount; i++) {
  const key = `${Math.round(position[3 * i] * 1e4)},${Math.round(position[3 * i + 1] * 1e4)},${Math.round(position[3 * i + 2] * 1e4)}`;
  if (!canonical.has(key)) canonical.set(key, i);
  rep[i] = canonical.get(key);
}
const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
const find = (i) => {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
};
for (let t = 0; t < index.length; t += 3) {
  const a = find(rep[index[t]]);
  const b = find(rep[index[t + 1]]);
  const c = find(rep[index[t + 2]]);
  parent[a] = b;
  parent[find(c)] = find(b);
}

const pieces = new Map();
for (let t = 0; t < index.length; t += 3) {
  const root = find(rep[index[t]]);
  let piece = pieces.get(root);
  if (!piece) {
    piece = { root, triangles: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    pieces.set(root, piece);
  }
  piece.triangles.push(t);
  for (let k = 0; k < 3; k++) {
    const v = index[t + k];
    for (let a = 0; a < 3; a++) {
      piece.min[a] = Math.min(piece.min[a], position[3 * v + a]);
      piece.max[a] = Math.max(piece.max[a], position[3 * v + a]);
    }
  }
}

const sorted = [...pieces.values()].sort((a, b) => b.triangles.length - a.triangles.length);
const main = sorted[0];
const width = Math.max(main.max[0] - main.min[0], main.max[2] - main.min[2]);
const height = main.max[1] - main.min[1];
const fmt = (v) => v.map((x) => x.toFixed(2)).join(',');

const removed = new Set();
for (const piece of sorted.slice(1)) {
  const below = piece.max[1] <= main.min[1] + height * 0.01;
  const reach = REACH * width;
  const outside =
    piece.min[0] < main.min[0] - reach ||
    piece.max[0] > main.max[0] + reach ||
    piece.min[2] < main.min[2] - reach ||
    piece.max[2] > main.max[2] + reach;
  const verdict = below ? 'REMOVE (under the floor)' : outside ? 'REMOVE (outside the footprint)' : 'keep';
  if (verdict !== 'keep') removed.add(piece.root);
  console.log(`${String(piece.triangles.length).padStart(5)} tris  min ${fmt(piece.min)}  max ${fmt(piece.max)}  ${verdict}`);
}
console.log(`main: ${main.triangles.length} tris, min ${fmt(main.min)} max ${fmt(main.max)}`);

if (removed.size === 0) {
  console.log('nothing to strip');
  process.exit(0);
}
if (dry) {
  console.log(`--dry: would remove ${removed.size} piece(s)`);
  process.exit(0);
}

const kept = [];
for (let t = 0; t < index.length; t += 3) {
  if (removed.has(find(rep[index[t]]))) continue;
  kept.push(index[t], index[t + 1], index[t + 2]);
}
const Typed = index.constructor;
indexAccessor.setArray(new Typed(kept));
await doc.transform(prune());
await io.write(file, doc);
console.log(`wrote ${file}: ${index.length / 3} -> ${kept.length / 3} triangles`);
