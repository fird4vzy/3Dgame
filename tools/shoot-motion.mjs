/**
 * Shoot the player's motion contact sheet and measure foot slide.
 *
 * Rows: standing (front, side), walk, run, jump on the real arc, celebration.
 * Then, per gait at the game's speeds: the clip's own ground speed, the rate
 * it has to play at, the resulting cadence, and how fast the planted foot
 * moves backward relative to the body (ratio 1.0 = no slide).
 *
 * Usage:  npm run dev
 *         node tools/shoot-motion.mjs [outputPrefix]
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'motion';
const PORT = process.env.LUMENPOST_PORT ?? '5173';

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch();
}
const page = await browser.newPage({ viewport: { width: 1440, height: 1800 } });
const errors = [];
const ignorable = (t) => /favicon/i.test(t) || /404 \(Not Found\)/.test(t);
page.on('console', (m) => {
  if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text());
  if (m.type() === 'warning') console.log(`  warn: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto(`http://localhost:${PORT}/tools/motion-preview.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__motionReady, null, { timeout: 90000 });
await page.locator('canvas').screenshot({ path: `${out}-sheet.png` });
console.log(`wrote ${out}-sheet.png`);

for (const [clip, speed] of [['walk', 1.8], ['run', 4.6]]) {
  const m = await page.evaluate(([c, s]) => window.__motionMeasure(c, s), [clip, speed]);
  console.log(
    `${clip.padEnd(5)} @ ${speed} m/s  clip ${m.clip} native ${m.native} m/s  rate ×${m.rate}  ` +
      `cadence ${m.cadence}/min  planted foot ${m.planted} m/s (ratio ${m.ratio})`,
  );
}

for (const [label, angle, height, distance] of [
  ['front', 0, 1.0, 1.9],
  ['back', Math.PI, 1.0, 1.9],
  ['face', 0.4, 1.42, 0.7],
]) {
  await page.evaluate(([a, h, d]) => window.__closeUp(a, h, d), [angle, height, distance]);
  await page.locator('canvas').screenshot({ path: `${out}-${label}.png` });
}
console.log(`wrote ${out}-front.png, -back.png, -face.png`);

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
