/**
 * Preview one model from four angles and print its report.
 *
 * Usage:  npm run dev
 *         node tools/shoot-model.mjs <name> <heightMetres> <out.png>
 *
 * The report is the same one `model-preview.html` shows; the screenshot is
 * for a person. Generated models arrive with surprises — a beam sticking out
 * of a pillar at ground level, a Chinese pavilion where a shrine was asked
 * for — and no number catches those. Look at it before it goes in the world.
 */
import { chromium } from 'playwright';

const [name, height, out] = process.argv.slice(2);
if (!name || !height || !out) {
  console.error('usage: node tools/shoot-model.mjs <name> <heightMetres> <out.png>');
  process.exit(1);
}
const PORT = process.env.LUMENPOST_PORT ?? '5173';

const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(
  `http://localhost:${PORT}/tools/model-preview.html?model=/assets/models/${name}.glb&height=${height}`,
);
await page.waitForFunction(() => !!window.__previewModel, null, { timeout: 30000 });
await page.waitForTimeout(600);
console.log(await page.evaluate(() => document.querySelector('pre')?.innerText ?? ''));
await page.screenshot({ path: out });
await browser.close();
