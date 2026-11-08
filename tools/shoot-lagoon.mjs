/**
 * Shoot the Tidebreak lagoon from its shore, looking at the sea torii.
 *
 * Water is the one surface whose look depends almost entirely on what is
 * around it — sky, sun, the gate standing in it — so it gets its own fixed
 * shot: from the beach, through the gate, under each lighting mood.
 *
 * Usage:  npm run dev
 *         node tools/shoot-lagoon.mjs [outputDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots-lagoon';
mkdirSync(out, { recursive: true });
const PORT = process.env.LUMENPOST_PORT ?? '5173';

const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__lumenpost?.scene, null, { timeout: 90000 });
for (const label of ['Begin', 'Continue']) {
  const button = page.getByRole('button', { name: label, exact: true });
  if ((await button.count()) > 0) {
    await button.first().click();
    break;
  }
}
await page.waitForFunction(() => !window.__lumenpost.scene.isMenuMode, null, { timeout: 20000 });
await page.addStyleTag({ content: '#ui { display: none !important; }' });
await page.evaluate(() => {
  for (const el of document.querySelectorAll('div')) {
    if (el.style.position === 'fixed' && el.style.font.includes('monospace')) el.style.display = 'none';
  }
});

/** Walk back from the gate toward the district until the ground is dry, then face the gate. */
const found = await page.evaluate(() => {
  const s = window.__lumenpost.scene;
  const gate = s.layout.seaTorii;
  if (!gate) return false;
  const V = gate.position.constructor;
  const def = s.districts.all.find((d) => d.def.id === 'tidebreak').def;
  const lat = (def.centre.lat * Math.PI) / 180;
  const lon = (def.centre.lon * Math.PI) / 180;
  const centre = new V(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
  const toward = centre.clone().sub(gate.position.clone().normalize());
  let spot = null;
  for (let t = 0.05; t <= 1; t += 0.01) {
    const dir = gate.position.clone().normalize().addScaledVector(toward, t).normalize();
    const h = s.terrain.heightAt(dir);
    // A few metres up the beach: enough to see the water in front.
    if (h > 58.5 + 0.35) {
      spot = dir.multiplyScalar(h + 0.3);
      break;
    }
  }
  if (!spot) return false;
  const up = spot.clone().normalize();
  const forward = gate.position.clone().sub(spot).projectOnPlane(up).normalize();
  s.player.object3D.position.copy(spot);
  s.controller.previousPosition?.copy(spot);
  s.controller.renderPosition?.copy(spot);
  s.controller.velocity?.set(0, 0, 0);
  s.player.object3D.lookAt(spot.clone().add(forward));
  s.rig.reset(spot, forward);
  s.rig.pitch = (8 * Math.PI) / 180;
  return true;
});
if (!found) {
  console.log('no lagoon on this planet');
  process.exit(1);
}

const moods = {
  dormant: [],
  awake: ['landing', 'bramblewood', 'coil', 'tidebreak'],
  golden: ['landing', 'bramblewood', 'coil', 'tidebreak', 'spire'],
};
for (const [mood, lit] of Object.entries(moods)) {
  await page.evaluate((lit) => {
    const s = window.__lumenpost.scene;
    s.illumination.reset();
    s.illumination.restore(lit);
  }, lit);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(out, `lagoon-${mood}.png`) });
  console.log('shot', mood);
}
await browser.close();
