/**
 * Slice a generated icon sheet into individual masks.
 *
 * The sheet is generated as flat white shapes on solid black, and each icon is
 * written out as a **white shape with an alpha channel**, not as an opaque
 * picture. That is the point: an alpha mask can be used as a CSS
 * `mask-image`, which means the icon takes its colour from `background-color`
 * and therefore from the design tokens. Ship them as coloured pictures instead
 * and every theme change means regenerating art.
 *
 * Luminance becomes alpha directly, so the anti-aliased edges the generator
 * produced survive as soft alpha rather than turning into a jagged cutout.
 *
 * Each cell is auto-trimmed to its content and padded back to a square, so the
 * icons end up optically centred even though the generator never places them
 * perfectly in the grid.
 *
 * Usage:
 *   node tools/slice-icons.mjs <sheet.png> <outDir> <cols> <rows> <name,name,...>
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [sheet, outDir, colsArg, rowsArg, namesArg] = process.argv.slice(2);
if (!sheet || !outDir || !colsArg || !rowsArg || !namesArg) {
  console.error(
    'usage: node tools/slice-icons.mjs <sheet.png> <outDir> <cols> <rows> <name,name,...>',
  );
  process.exit(1);
}

const cols = Number(colsArg);
const rows = Number(rowsArg);
const names = namesArg.split(',').map((n) => n.trim());
if (names.length !== cols * rows) {
  console.error(`expected ${cols * rows} names, got ${names.length}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const source = `data:image/png;base64,${readFileSync(sheet).toString('base64')}`;

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch();
}
const page = await browser.newPage();

const cells = await page.evaluate(
  async ([src, nCols, nRows, size]) => {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = src;
    });

    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = img.width;
    sheetCanvas.height = img.height;
    const sheetCtx = sheetCanvas.getContext('2d', { willReadFrequently: true });
    sheetCtx.drawImage(img, 0, 0);

    // Find the artwork before gridding it.
    //
    // Generators do not fill the canvas with the grid they were asked for: this
    // sheet came back as three black panels in a band across the middle with
    // large white margins above and below, so dividing the *whole image* into
    // equal cells swept most of that white into every tile. Because luminance
    // becomes alpha, white is maximally opaque — every icon came out as a solid
    // block. Locating the dark region first and subdividing only that works for
    // either layout without a per-sheet flag.
    const whole = sheetCtx.getImageData(0, 0, img.width, img.height).data;
    let dMinX = img.width;
    let dMinY = img.height;
    let dMaxX = -1;
    let dMaxY = -1;
    // Step in fours: this is a coarse region hunt, not a trace.
    for (let y = 0; y < img.height; y += 4) {
      for (let x = 0; x < img.width; x += 4) {
        const i = (y * img.width + x) * 4;
        const lum = (whole[i] * 0.299 + whole[i + 1] * 0.587 + whole[i + 2] * 0.114) / 255;
        if (lum > 0.25) continue;
        if (x < dMinX) dMinX = x;
        if (y < dMinY) dMinY = y;
        if (x > dMaxX) dMaxX = x;
        if (y > dMaxY) dMaxY = y;
      }
    }

    const found = dMaxX > dMinX && dMaxY > dMinY;
    const originX = found ? dMinX : 0;
    const originY = found ? dMinY : 0;
    const regionW = found ? dMaxX - dMinX + 1 : img.width;
    const regionH = found ? dMaxY - dMinY + 1 : img.height;

    const fullW = Math.floor(regionW / nCols);
    const fullH = Math.floor(regionH / nRows);

    // Bite a margin off every cell before reading it.
    //
    // Generators lay these sheets out with pale gutters between the tiles and a
    // border around the outside. Luminance becomes alpha here, so a white
    // gutter would come through as a solid opaque frame around each icon — the
    // one thing a mask must not have. Trimming the outer 7% removes it without
    // touching artwork, which the prompt keeps well inside its cell.
    const inset = 0.07;
    const padX = Math.round(fullW * inset);
    const padY = Math.round(fullH * inset);
    const cellW = fullW - padX * 2;
    const cellH = fullH - padY * 2;
    const out = [];

    for (let row = 0; row < nRows; row++) {
      for (let col = 0; col < nCols; col++) {
        const data = sheetCtx.getImageData(
          originX + col * fullW + padX,
          originY + row * fullH + padY,
          cellW,
          cellH,
        );
        const px = data.data;

        // Luminance -> alpha, colour forced to white. Threshold low so soft
        // edges survive; anything genuinely background stays fully transparent.
        //
        // The border band is then wiped unconditionally. A plain inset is not
        // enough on its own: these sheets come back with pale gutters between
        // the tiles *and* a border round the outside, the widths are not
        // uniform, and any survivor becomes an opaque frame around the icon —
        // which on a mask is the one artefact you cannot miss. The prompt keeps
        // the artwork well inside its cell, so clearing a tenth off each edge
        // costs nothing and cannot leave a fragment behind.
        const band = Math.round(Math.min(cellW, cellH) * 0.1);

        for (let y = 0; y < cellH; y++) {
          for (let x = 0; x < cellW; x++) {
            const i = (y * cellW + x) * 4;
            const edge = x < band || y < band || x >= cellW - band || y >= cellH - band;
            const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
            const a = edge || lum < 0.06 ? 0 : Math.min(1, (lum - 0.06) / 0.5);
            px[i] = 255;
            px[i + 1] = 255;
            px[i + 2] = 255;
            px[i + 3] = Math.round(a * 255);
          }
        }

        // Content bounds, measured after the wipe so the frame cannot inflate
        // them and defeat the centring.
        let minX = cellW;
        let minY = cellH;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < cellH; y++) {
          for (let x = 0; x < cellW; x++) {
            if (px[(y * cellW + x) * 4 + 3] < 90) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }

        const cell = document.createElement('canvas');
        cell.width = cellW;
        cell.height = cellH;
        cell.getContext('2d').putImageData(data, 0, 0);

        // Trim to content, then letterbox back to a square so every icon is
        // optically centred and the same size in the layout.
        const empty = maxX < 0;
        const bw = empty ? cellW : maxX - minX + 1;
        const bh = empty ? cellH : maxY - minY + 1;
        const side = Math.max(bw, bh);

        const square = document.createElement('canvas');
        square.width = size;
        square.height = size;
        const sq = square.getContext('2d');
        sq.imageSmoothingQuality = 'high';
        // 8% breathing room, so nothing touches the edge of its box.
        const scale = (size * 0.84) / side;
        sq.drawImage(
          cell,
          empty ? 0 : minX,
          empty ? 0 : minY,
          bw,
          bh,
          (size - bw * scale) / 2,
          (size - bh * scale) / 2,
          bw * scale,
          bh * scale,
        );

        out.push({
          data: square.toDataURL('image/png').split(',')[1],
          coverage: empty ? 0 : +((bw * bh) / (cellW * cellH)).toFixed(3),
        });
      }
    }
    return out;
  },
  [source, cols, rows, 128],
);

await browser.close();

cells.forEach((cell, i) => {
  const file = join(outDir, `${names[i]}.png`);
  writeFileSync(file, Buffer.from(cell.data, 'base64'));
  const warn = cell.coverage < 0.02 ? '  <-- looks empty, check the sheet' : '';
  console.log(`${names[i]}.png  coverage ${cell.coverage}${warn}`);
});
console.log(`\nwrote ${cells.length} icons to ${outDir}`);
