/**
 * Shoot the player in the game itself: from behind (the view the player has)
 * and from the front, in all three lighting moods, then walking and running.
 *
 * `tools/motion-preview.html` judges motion and cloth under neutral light;
 * this judges her in the world, with the grade, the haze and the sky that
 * every other material answers to — MToon answers to less of it (docs/24).
 *
 * Usage:  npm run dev
 *         node tools/shoot-player.mjs <outDir>
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'out';
const PORT = process.env.LUMENPOST_PORT ?? '5173';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist'] }).catch(() =>
  chromium.launch({ args: ['--ignore-gpu-blocklist'] }),
);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__lumenpost?.scene?.playerCharacter, null, { timeout: 120000 });
for (const label of ['Begin', 'Continue']) {
  const button = page.getByRole('button', { name: label, exact: true });
  if ((await button.count()) > 0) {
    await button.first().click();
    break;
  }
}
await page.waitForFunction(() => !window.__lumenpost.scene.isMenuMode, null, { timeout: 20000 });
await page.addStyleTag({ content: '#ui { display: none !important; }' });
console.log('character:', await page.evaluate(() => window.__lumenpost.scene.playerCharacter.definition.id));

const moods = {
  dormant: [],
  awake: ['landing', 'bramblewood', 'coil', 'tidebreak'],
  golden: ['landing', 'bramblewood', 'coil', 'tidebreak', 'spire'],
};

/**
 * Stand her at the Landing facing `heading` degrees from local north (or toward
 * the mountain, for `'fuji'`); camera behind or in front.
 */
const stage = (lit, heading, front, arm) =>
  page.evaluate(
    ({ lit, heading, front, arm }) => {
      const s = window.__lumenpost.scene;
      s.illumination.reset();
      s.illumination.restore(lit);
      const def = s.districts.all.find((d) => d.def.id === 'landing').def;
      const lat = (def.centre.lat * Math.PI) / 180;
      const lon = (def.centre.lon * Math.PI) / 180;
      const V = s.player.object3D.position.constructor;
      const up = new V(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).normalize();
      const pos = up.clone().multiplyScalar(s.terrain.heightAt(up) + 0.3);
      s.player.object3D.position.copy(pos);
      s.controller.previousPosition?.copy(pos);
      s.controller.renderPosition?.copy(pos);
      s.controller.velocity?.set(0, 0, 0);
      const fuji = s.world.scene.getObjectByName('fuji');
      const forward =
        heading === 'fuji' && fuji
          ? fuji.position.clone().sub(pos).projectOnPlane(up).normalize()
          : new V(0, 1, 0).projectOnPlane(up).normalize().applyAxisAngle(up, (heading * Math.PI) / 180);
      s.player.object3D.lookAt(pos.clone().add(forward));
      s.rig.wantedArm = arm;
      s.rig.currentArm = arm;
      s.rig.reset(pos, front ? forward.clone().negate() : forward);
      s.rig.pitch = (6 * Math.PI) / 180;
    },
    { lit, heading, front, arm },
  );

for (const [mood, lit] of Object.entries(moods)) {
  for (const [view, front, arm] of [
    ['back', false, 4.2],
    ['front', true, 2.6],
  ]) {
    await stage(lit, 160, front, arm);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${out}/player-${mood}-${view}.png` });
  }
}

// The village looking toward Fuji, in every mood.
for (const [mood, lit] of Object.entries(moods)) {
  await stage(lit, 'fuji', false, 4.6);
  await page.evaluate(() => (window.__lumenpost.scene.rig.pitch = (2 * Math.PI) / 180));
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/player-fuji-${mood}.png` });
}

// On the move, golden hour, camera behind: walk, then run.
await stage(moods.golden, 160, false, 4.2);
await page.waitForTimeout(800);
await page.keyboard.down('KeyW');
await page.waitForTimeout(1300);
await page.screenshot({ path: `${out}/player-walk.png` });
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(1300);
await page.screenshot({ path: `${out}/player-run.png` });
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');

// Carrying the lantern: standing, seen from the front, then walking side-on
// (strafing right, so the camera sees the arm and the lantern swing).
await stage(moods.awake, 160, true, 2.8);
await page.evaluate(() => window.__lumenpost.scene.attachParcel('preview', '#ffd27a', 'light'));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/player-carry-front.png` });
await stage(moods.awake, 160, false, 3.4);
await page.waitForTimeout(600);
await page.keyboard.down('KeyD');
await page.waitForTimeout(1400);
await page.screenshot({ path: `${out}/player-carry-walk.png` });
await page.keyboard.up('KeyD');

console.log(`wrote ${out}/player-*.png`);
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
