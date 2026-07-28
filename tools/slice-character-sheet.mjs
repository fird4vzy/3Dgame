#!/usr/bin/env node
/**
 * Slice a flattened character contact sheet into a game-ready sprite atlas.
 *
 * Concept sheets arrive as one opaque PNG: the "transparency" checkerboard is
 * painted pixels, and every pose sits on a flat backdrop. This tool turns that
 * into real cut-out sprites.
 *
 * The important technique is **edge-connected flood fill** rather than a global
 * colour key. Our character wears grey-green tactical gear on a grey backdrop;
 * a global key would punch holes straight through the jacket. Filling only from
 * the region border removes background that is actually *connected* to the
 * outside, so enclosed grey (clothing, shadows between limbs) survives.
 *
 * Usage:
 *   node tools/slice-character-sheet.mjs <sheet.png> <regions.json> <outDir>
 *
 * Writes:  <outDir>/<atlasName>.png   packed atlas, real alpha
 *          <outDir>/<atlasName>.json  frame rectangles + pivots
 *          <outDir>/frames/*.png      individual sprites (for inspection)
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Squared RGB distance — cheap and good enough for a flat backdrop. */
function colourDistanceSq(data, i, r, g, b) {
  const dr = data[i] - r;
  const dg = data[i + 1] - g;
  const db = data[i + 2] - b;
  return dr * dr + dg * dg + db * db;
}

/**
 * Mark every pixel reachable from the region border whose colour is within
 * `tolerance` of the sampled background. Iterative stack, not recursion —
 * a 500x250 region would blow the call stack.
 */
function floodFillBackground(data, width, height, bg, tolerance) {
  const isBackground = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const tolSq = tolerance * tolerance;
  const stack = [];

  const consider = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (visited[p]) return;
    visited[p] = 1;
    if (colourDistanceSq(data, p * 4, bg.r, bg.g, bg.b) <= tolSq) {
      isBackground[p] = 1;
      stack.push(x, y);
    }
  };

  for (let x = 0; x < width; x++) {
    consider(x, 0);
    consider(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    consider(0, y);
    consider(width - 1, y);
  }

  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    consider(x + 1, y);
    consider(x - 1, y);
    consider(x, y + 1);
    consider(x, y - 1);
  }

  return isBackground;
}

/** Most common colour around the border ring — the backdrop, by definition. */
function sampleBackground(data, width, height) {
  const counts = new Map();
  const sample = (x, y) => {
    const i = (y * width + x) * 4;
    // Quantise to 8 levels per channel so anti-aliasing noise clusters.
    const key = `${data[i] >> 5},${data[i + 1] >> 5},${data[i + 2] >> 5}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let x = 0; x < width; x++) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    sample(0, y);
    sample(width - 1, y);
  }

  let best = null;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = key;
    }
  }
  const [r, g, b] = best.split(',').map((v) => (Number(v) << 5) + 16);
  return { r, g, b };
}

/**
 * Split a region into cells by projecting the foreground mask onto each axis
 * and cutting at runs of empty columns/rows. More robust than hard-coded grid
 * maths, which drifts if the sheet is re-exported at a different size.
 */
function segment(mask, width, height, minGap, minSize) {
  const columnHas = new Uint8Array(width);
  const rowHas = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) {
        columnHas[x] = 1;
        rowHas[y] = 1;
      }
    }
  }

  const runs = (has, length) => {
    const spans = [];
    let start = -1;
    let gap = 0;
    for (let i = 0; i < length; i++) {
      if (has[i]) {
        if (start < 0) start = i;
        gap = 0;
      } else if (start >= 0) {
        gap++;
        if (gap >= minGap) {
          const end = i - gap;
          if (end - start + 1 >= minSize) spans.push([start, end]);
          start = -1;
          gap = 0;
        }
      }
    }
    if (start >= 0 && length - start >= minSize) spans.push([start, length - 1]);
    return spans;
  };

  return { columns: runs(columnHas, width), rows: runs(rowHas, height) };
}

async function extractRegion(sheetPath, region) {
  const { data, info } = await sharp(sheetPath)
    .extract({ left: region.x, top: region.y, width: region.w, height: region.h })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const bg = region.background ?? sampleBackground(data, width, height);
  const tolerance = region.tolerance ?? 42;
  const mask = floodFillBackground(data, width, height, bg, tolerance);

  // Punch the background out.
  for (let p = 0; p < width * height; p++) {
    if (mask[p]) data[p * 4 + 3] = 0;
  }

  // The pixels right on the silhouette are anti-aliased: their RGB is a blend
  // of character and backdrop. Left alone they read as a pale halo once the
  // background behind them is gone. Erode that ring, then bleed character
  // colour outward so bilinear filtering never samples the old backdrop.
  erodeEdge(data, width, height, region.edgeErode ?? 1);
  bleedColour(data, width, height, region.colourBleed ?? 4);

  const { columns, rows } = segment(mask, width, height, region.minGap ?? 4, region.minSize ?? 12);
  return { data, width, height, columns, rows };
}

/** Remove `passes` rings of opaque pixels that touch transparency. */
function erodeEdge(data, width, height, passes) {
  for (let pass = 0; pass < passes; pass++) {
    const doomed = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (data[p * 4 + 3] === 0) continue;
        const transparentNeighbour =
          (x > 0 && data[(p - 1) * 4 + 3] === 0) ||
          (x < width - 1 && data[(p + 1) * 4 + 3] === 0) ||
          (y > 0 && data[(p - width) * 4 + 3] === 0) ||
          (y < height - 1 && data[(p + width) * 4 + 3] === 0);
        if (transparentNeighbour) doomed.push(p);
      }
    }
    for (const p of doomed) data[p * 4 + 3] = 0;
  }
}

/**
 * Copy colour from opaque pixels into neighbouring transparent ones, leaving
 * alpha at zero. Invisible on its own, but it is what stops mipmapping and
 * bilinear filtering from dragging backdrop colour into the silhouette.
 */
function bleedColour(data, width, height, passes) {
  for (let pass = 0; pass < passes; pass++) {
    const writes = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (data[p * 4 + 3] !== 0) continue;

        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = (ny * width + nx) * 4;
          // Only sample pixels that already carry real colour.
          if (data[q + 3] === 0 && !(data[q] || data[q + 1] || data[q + 2])) continue;
          r += data[q];
          g += data[q + 1];
          b += data[q + 2];
          n++;
        }
        if (n > 0) writes.push([p, (r / n) | 0, (g / n) | 0, (b / n) | 0]);
      }
    }
    for (const [p, r, g, b] of writes) {
      data[p * 4] = r;
      data[p * 4 + 1] = g;
      data[p * 4 + 2] = b;
    }
  }
}

/**
 * Erase everything not connected to the largest opaque blob in the cell.
 *
 * Contact sheets carry divider lines, drop shadows and stray marks that survive
 * the background key and then inflate the sprite's bounding box. The character
 * is always the largest connected mass, so keeping only that component removes
 * the debris without touching the art.
 */
function keepLargestComponent(data, width, cell, minRatio = 0.06) {
  const w = cell.x1 - cell.x0 + 1;
  const h = cell.y1 - cell.y0 + 1;
  const label = new Int32Array(w * h).fill(-1);
  const components = [];

  const opaque = (lx, ly) => data[((cell.y0 + ly) * width + cell.x0 + lx) * 4 + 3] > 8;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (label[p] !== -1 || !opaque(x, y)) continue;

      const id = components.length;
      let size = 0;
      const stack = [x, y];
      label[p] = id;
      while (stack.length) {
        const cy = stack.pop();
        const cx = stack.pop();
        size++;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const np = ny * w + nx;
          if (label[np] !== -1 || !opaque(nx, ny)) continue;
          label[np] = id;
          stack.push(nx, ny);
        }
      }
      components.push(size);
    }
  }

  if (components.length <= 1) return;
  const largest = Math.max(...components);
  const threshold = largest * minRatio;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = label[y * w + x];
      if (id === -1) continue;
      // Keep the main mass and any substantial secondary piece (a held prop),
      // but drop hairline debris.
      if (components[id] < threshold) {
        data[((cell.y0 + y) * width + cell.x0 + x) * 4 + 3] = 0;
      }
    }
  }
}

/** Tight bounding box of non-transparent pixels inside a cell. */
function trim(data, width, cell) {
  let minX = cell.x1;
  let maxX = cell.x0;
  let minY = cell.y1;
  let maxY = cell.y0;
  let found = false;
  for (let y = cell.y0; y <= cell.y1; y++) {
    for (let x = cell.x0; x <= cell.x1; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return found ? { x0: minX, y0: minY, x1: maxX, y1: maxY } : null;
}

async function main() {
  const [sheetPath, regionsPath, outDir] = process.argv.slice(2);
  if (!sheetPath || !regionsPath || !outDir) {
    console.error('usage: slice-character-sheet.mjs <sheet.png> <regions.json> <outDir>');
    process.exit(1);
  }

  const spec = JSON.parse(await (await import('node:fs/promises')).readFile(regionsPath, 'utf8'));
  await mkdir(join(outDir, 'frames'), { recursive: true });

  const sprites = [];

  for (const region of spec.regions) {
    const { data, width, columns, rows } = await extractRegion(sheetPath, region);
    console.log(
      `${region.name}: ${columns.length} column(s) x ${rows.length} row(s) detected`,
    );

    let index = 0;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < columns.length; c++) {
        const cell = {
          x0: columns[c][0],
          x1: columns[c][1],
          y0: rows[r][0],
          y1: rows[r][1],
        };
        if (region.keepLargestComponent !== false) {
          keepLargestComponent(data, width, cell, region.componentMinRatio ?? 0.06);
        }
        const box = trim(data, width, cell);
        if (!box) continue;

        const w = box.x1 - box.x0 + 1;
        const h = box.y1 - box.y0 + 1;
        if (w < (region.minSize ?? 12) || h < (region.minSize ?? 12)) continue;

        // Copy the cell out of the region buffer.
        const out = Buffer.alloc(w * h * 4);
        for (let y = 0; y < h; y++) {
          const src = ((box.y0 + y) * width + box.x0) * 4;
          data.copy(out, y * w * 4, src, src + w * 4);
        }

        const name = region.names?.[index] ?? `${region.name}_${index}`;
        sprites.push({ name, w, h, buffer: out, region: region.name });
        index++;
      }
    }
  }

  if (sprites.length === 0) {
    console.error('No sprites found — check the region coordinates.');
    process.exit(1);
  }

  // Write individual frames for eyeballing.
  for (const sprite of sprites) {
    await sharp(sprite.buffer, { raw: { width: sprite.w, height: sprite.h, channels: 4 } })
      .png()
      .toFile(join(outDir, 'frames', `${sprite.name}.png`));
  }

  // Pack into a shelf-packed atlas: sort by height, fill rows left to right.
  const PAD = 2;
  const maxWidth = spec.atlasWidth ?? 1024;
  const ordered = [...sprites].sort((a, b) => b.h - a.h);

  let penX = PAD;
  let penY = PAD;
  let shelfHeight = 0;
  const placements = [];
  for (const sprite of ordered) {
    if (penX + sprite.w + PAD > maxWidth) {
      penX = PAD;
      penY += shelfHeight + PAD;
      shelfHeight = 0;
    }
    placements.push({ sprite, x: penX, y: penY });
    penX += sprite.w + PAD;
    shelfHeight = Math.max(shelfHeight, sprite.h);
  }
  const atlasHeight = penY + shelfHeight + PAD;

  const atlas = sharp({
    create: {
      width: maxWidth,
      height: atlasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(
    placements.map((p) => ({
      input: p.sprite.buffer,
      raw: { width: p.sprite.w, height: p.sprite.h, channels: 4 },
      left: p.x,
      top: p.y,
    })),
  );

  const atlasName = spec.atlasName ?? 'character_atlas';
  await atlas.png({ compressionLevel: 9 }).toFile(join(outDir, `${atlasName}.png`));

  const frames = {};
  for (const p of placements) {
    frames[p.sprite.name] = {
      x: p.x,
      y: p.y,
      w: p.sprite.w,
      h: p.sprite.h,
      // Characters pivot at the feet so they stand on the ground.
      pivot: { x: 0.5, y: 1 },
    };
  }

  await writeFile(
    join(outDir, `${atlasName}.json`),
    `${JSON.stringify({ atlas: `${atlasName}.png`, size: { w: maxWidth, h: atlasHeight }, frames }, null, 2)}\n`,
  );

  console.log(
    `\npacked ${sprites.length} sprites into ${atlasName}.png (${maxWidth}x${atlasHeight})`,
  );
  const tallest = Math.max(...sprites.map((s) => s.h));
  console.log(`tallest sprite: ${tallest}px`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
