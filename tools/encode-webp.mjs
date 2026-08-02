/**
 * Re-encode a PNG to WebP through a headless browser canvas.
 *
 * Generated art arrives as multi-megabyte PNG — the menu key art was 4.4 MB,
 * which is more than the entire JS bundle and would be the single slowest thing
 * on the title screen. There is no image encoder in Node's standard library and
 * pulling in `sharp` for one asset is not worth a native dependency, but
 * Chromium is already here for the screenshot tooling and encodes WebP happily.
 *
 * Usage:  node tools/encode-webp.mjs <in.png> <out.webp> [maxWidth] [quality]
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const [input, output, maxWidth = '1920', quality = '0.86'] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node tools/encode-webp.mjs <in.png> <out.webp> [maxWidth] [quality]');
  process.exit(1);
}

const source = `data:image/png;base64,${readFileSync(input).toString('base64')}`;

// Prefer the installed Chrome; the bundled headless shell may not be present.
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch();
}
const page = await browser.newPage();

const encoded = await page.evaluate(
  async ([src, max, q]) => {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = src;
    });

    const scale = Math.min(1, max / img.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return {
      data: canvas.toDataURL('image/webp', q).split(',')[1],
      width: canvas.width,
      height: canvas.height,
    };
  },
  [source, Number(maxWidth), Number(quality)],
);

writeFileSync(output, Buffer.from(encoded.data, 'base64'));
await browser.close();

const before = statSync(input).size;
const after = statSync(output).size;
console.log(
  `${output}  ${encoded.width}x${encoded.height}  ` +
    `${(before / 1024 / 1024).toFixed(2)} MB -> ${(after / 1024).toFixed(0)} KB ` +
    `(${Math.round((1 - after / before) * 100)}% smaller)`,
);
