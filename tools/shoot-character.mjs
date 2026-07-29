/**
 * Render a character turnaround to PNG.
 *
 * The unit tests can prove the rig's *structure* — feet on the ground, joints
 * parented, lenses apart — but they cannot see it. Two faults that shipped
 * through a green suite were only ever visible here: a collar sized on its own
 * terms that swallowed the entire lower face, and shoulder piping placed at a
 * z inside the jacket shell, so it never rendered at all. Look at the character
 * before believing anything about it.
 *
 * Usage:  npm run dev
 *         node tools/shoot-character.mjs [outputPrefix]
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'ren';
const PORT = process.env.LUMENPOST_PORT ?? '5173';
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch();
}
const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
const errors = [];
// The bare preview page declares no favicon, so the browser's automatic
// /favicon.ico probe 404s. Reporting that as an error trains you to ignore the
// error line, which is worse than not printing it.
const ignorable = (text) => /favicon/i.test(text) || /404 \(Not Found\)/.test(text);
page.on('console', (m) => m.type() === 'error' && !ignorable(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto(`http://localhost:${PORT}/tools/character-preview.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__renReady, null, { timeout: 30000 });
await page.waitForTimeout(400);

await page.locator('canvas').screenshot({ path: `${out}-turnaround.png` });

await page.evaluate(() => window.__renHead());
await page.waitForTimeout(200);
await page.locator('canvas').screenshot({ path: `${out}-head.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
