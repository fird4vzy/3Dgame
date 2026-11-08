/**
 * Shoot the same viewpoints under each lighting mood.
 *
 * The look of this game is three moods blended by progress — the dormant
 * planet, the awakened afternoon, and the golden hour the last delivery buys
 * — and a change that flatters one of them routinely ruins another. So every
 * lighting change gets judged against all three, from the same spots, both
 * into the sun (where the haze glows) and away from it (where it does not).
 *
 * Prints the average frame time at each shot, measured after the view has
 * settled, so a change that costs frames shows up next to the one that looks
 * better.
 *
 * Usage:  npm run dev
 *         node tools/shoot-moods.mjs [outputDir] [mood,mood,...]
 *         moods: dormant, awake, golden  (default: all three)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots-moods';
const only = process.argv[3]?.split(',');
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
// Hide the HUD and the dev-build debug panel: these shots are about the world.
await page.addStyleTag({ content: '#ui { display: none !important; }' });
await page.evaluate(() => {
  for (const el of document.querySelectorAll('div')) {
    if (el.style.position === 'fixed' && el.style.font.includes('monospace')) el.style.display = 'none';
  }
});

/** Light a set of districts instantly, darkening the rest. */
async function setMood(lit) {
  await page.evaluate((lit) => {
    const s = window.__lumenpost.scene;
    s.illumination.reset();
    s.illumination.restore(lit);
  }, lit);
}

/** Stand at a district (or offset from it) facing a heading in its local frame. */
async function standAt(districtId, latOffset, lonOffset, yawDeg, pitchDeg) {
  await page.evaluate(
    ({ districtId, latOffset, lonOffset, yawDeg, pitchDeg }) => {
      const s = window.__lumenpost.scene;
      const def = s.districts.all.find((d) => d.def.id === districtId).def;
      const lat = ((def.centre.lat + latOffset) * Math.PI) / 180;
      const lon = ((def.centre.lon + lonOffset) * Math.PI) / 180;
      const V = s.player.object3D.position.constructor;
      const up = new V(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).normalize();
      const pos = up.clone().multiplyScalar(s.terrain.heightAt(up) + 0.3);
      s.player.object3D.position.copy(pos);
      s.controller.previousPosition?.copy(pos);
      s.controller.renderPosition?.copy(pos);
      s.controller.velocity?.set(0, 0, 0);
      const forward = new V(0, 1, 0).projectOnPlane(up);
      if (forward.lengthSq() < 1e-6) forward.set(1, 0, 0).projectOnPlane(up);
      forward.normalize().applyAxisAngle(up, (yawDeg * Math.PI) / 180);
      s.player.object3D.lookAt(pos.clone().add(forward));
      s.rig.reset(pos, forward);
      s.rig.pitch = (pitchDeg * Math.PI) / 180;
    },
    { districtId, latOffset, lonOffset, yawDeg, pitchDeg },
  );
  await page.waitForTimeout(1800);
}

async function frameTime() {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        function tick(now) {
          times.push(now - last);
          last = now;
          if (times.length < 90) requestAnimationFrame(tick);
          else resolve(times.slice(10).reduce((a, b) => a + b, 0) / (times.length - 10));
        }
        requestAnimationFrame(tick);
      }),
  );
}

// The sun sits 20° clockwise of local north; yaw -20 looks straight into it.
const INTO_SUN = -20;
const AWAY = 160;

const views = [
  ['landing-sun', 'landing', 2, -3, INTO_SUN, 6],
  ['landing-away', 'landing', 0, 0, AWAY, 8],
  ['bramblewood', 'bramblewood', 21, 0, 180, 8],
  ['bramble-sun', 'bramblewood', 4, 4, INTO_SUN, 4],
  ['tidebreak', 'tidebreak', 3, 4, 60, 6],
  ['coil', 'coil', 0, 0, 30, 10],
];

const moods = {
  dormant: [],
  awake: ['landing', 'bramblewood', 'coil', 'tidebreak'],
  golden: ['landing', 'bramblewood', 'coil', 'tidebreak', 'spire'],
};

for (const [mood, lit] of Object.entries(moods)) {
  if (only && !only.includes(mood)) continue;
  await setMood(lit);
  for (const [name, ...args] of views) {
    await standAt(...args);
    const ms = await frameTime();
    await page.screenshot({ path: join(out, `${mood}-${name}.png`) });
    console.log(`${mood.padEnd(8)} ${name.padEnd(14)} ${ms.toFixed(1)} ms  (${(1000 / ms).toFixed(0)} fps)`);
  }
}
await browser.close();
