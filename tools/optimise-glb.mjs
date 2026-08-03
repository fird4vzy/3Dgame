/**
 * Shrink a generated GLB to something a browser should be asked to download.
 *
 * Meshy returns 2048-square textures on a 4k-triangle mesh — about 3 MB a
 * model. Thirty props at that size is 90 MB of assets for a game whose entire
 * JavaScript bundle is under one, and the detail is bought for nothing: this is
 * a cel-shaded world behind a screen-space outline, where a 2048 map and a 512
 * map are indistinguishable past about two metres.
 *
 * Four passes, in the order that matters:
 *
 *  1. `dedup` — generated meshes routinely carry the same texture twice.
 *  2. `resample`/`prune` — drop anything nothing references.
 *  3. **texture resize**, which is the one that actually moves the number.
 *  4. WebP re-encode, because PNG is the wrong container for photographic
 *     texture data and Meshy ships PNG.
 *
 * Runs on the file in place unless given an output path.
 *
 * Usage:
 *   node tools/optimise-glb.mjs <in.glb> [out.glb] [maxTextureSize]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { statSync } from 'node:fs';

const [input, outputArg, sizeArg] = process.argv.slice(2);
if (!input) {
  console.error('usage: node tools/optimise-glb.mjs <in.glb> [out.glb] [maxTextureSize]');
  process.exit(1);
}

const output = outputArg && !/^\d+$/.test(outputArg) ? outputArg : input;
const maxSize = Number(sizeArg ?? (/^\d+$/.test(outputArg ?? '') ? outputArg : 512));

const before = statSync(input).size;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
// Async in current gltf-transform: without the await, transform() is called
// on a Promise and fails with a bewildering "not a function".
const document = await io.read(input);

await document.transform(
  dedup(),
  prune(),
  // `resize` keeps aspect ratio and only ever shrinks, so a model that already
  // ships a sensible map passes through untouched.
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    resize: [maxSize, maxSize],
    quality: 85,
  }),
);

await io.write(output, document);

const after = statSync(output).size;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(
  `${output}  ${kb(before)} -> ${kb(after)}  (${Math.round((1 - after / before) * 100)}% smaller, textures capped at ${maxSize})`,
);
