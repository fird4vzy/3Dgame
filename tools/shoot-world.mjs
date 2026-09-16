/**
 * Shoot the world from a few fixed viewpoints.
 *
 * A screenshot is the only honest check on things like "is the sky white" —
 * no number in a unit test says what a frame looks like. Each shot stands the
 * player at a named place and aims the camera along a heading, so two runs
 * are comparable.
 *
 * Usage:  npm run dev
 *         node tools/shoot-world.mjs [outputDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const PORT = process.env.LUMENPOST_PORT ?? '5173';

const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__lumenpost?.scene, null, { timeout: 60000 });

// The menu shot first — it is a view of the world too.
await page.waitForTimeout(2500);
await page.screenshot({ path: join(out, '00-menu.png') });

if (await page.evaluate(() => window.__lumenpost.scene.isMenuMode)) {
  for (const label of ['Begin', 'Continue']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if ((await button.count()) > 0) {
      await button.first().click();
      break;
    }
  }
  await page.waitForFunction(() => !window.__lumenpost.scene.isMenuMode, null, { timeout: 20000 });
}
await page.waitForTimeout(5000);

/** Teleport the player to a district (or offset from one) and face a heading. */
async function standAt(districtId, latOffset, lonOffset, yawDeg, pitchDeg) {
  await page.evaluate(
    ({ districtId, latOffset, lonOffset, yawDeg, pitchDeg }) => {
      const s = window.__lumenpost.scene;
      const def = s.districts.all.find((d) => d.def.id === districtId).def;
      const lat = ((def.centre.lat + latOffset) * Math.PI) / 180;
      const lon = ((def.centre.lon + lonOffset) * Math.PI) / 180;
      const dir = {
        x: Math.cos(lat) * Math.cos(lon),
        y: Math.sin(lat),
        z: Math.cos(lat) * Math.sin(lon),
      };
      const len = Math.hypot(dir.x, dir.y, dir.z);
      const V = s.player.object3D.position.constructor;
      const up = new V(dir.x / len, dir.y / len, dir.z / len);
      const pos = up.clone().multiplyScalar(s.terrain.heightAt(up) + 0.3);
      s.player.object3D.position.copy(pos);
      s.controller.previousPosition?.copy(pos);
      s.controller.renderPosition?.copy(pos);
      s.controller.velocity?.set(0, 0, 0);
      // Face along a heading in the tangent plane, then hand the rig the same
      // facing so the camera settles behind it.
      const forward = new V(0, 1, 0).projectOnPlane(up);
      if (forward.lengthSq() < 1e-6) forward.set(1, 0, 0).projectOnPlane(up);
      forward.normalize().applyAxisAngle(up, (yawDeg * Math.PI) / 180);
      s.player.object3D.lookAt(pos.clone().add(forward));
      s.rig.reset(pos, forward);
      s.rig.pitch = (pitchDeg * Math.PI) / 180;
    },
    { districtId, latOffset, lonOffset, yawDeg, pitchDeg },
  );
  await page.waitForTimeout(1600);
}

const shots = [
  ['01-landing', 'landing', 0, 0, 0, 12],
  ['02-landing-low', 'landing', 3, 2, 120, 4],
  ['03-bramblewood', 'bramblewood', 21, 0, 180, 8],
  ['04-wild', 'coil', 20, -40, 60, 6],
  ['05-tidebreak', 'tidebreak', 0, 0, 240, 8],
];
for (const [name, ...args] of shots) {
  await standAt(...args);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log('shot', name);
}
await browser.close();
