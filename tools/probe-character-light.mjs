/**
 * Measure how lit the player character is.
 *
 * The VRM player is MToon-shaded, and MToon does not read the sky's
 * environment map the way every other material in the world does — so a
 * lighting change that looks right on the world can quietly turn her into a
 * silhouette. This stands her at a fixed spot facing away from the sun, with
 * the camera behind her (the view the player has most of the time), projects
 * a point on her skirt and a point on her back to the screen, and reports the
 * average colour around each, in every mood.
 *
 * Usage:  npm run dev
 *         node tools/probe-character-light.mjs [port]
 */
import { chromium } from 'playwright';
import sharp from 'sharp';

const PORT = process.argv[2] ?? process.env.LUMENPOST_PORT ?? '5173';
const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__lumenpost?.scene?.playerCharacter, null, { timeout: 90000 });
for (const label of ['Begin', 'Continue']) {
  const button = page.getByRole('button', { name: label, exact: true });
  if ((await button.count()) > 0) {
    await button.first().click();
    break;
  }
}
await page.waitForFunction(() => !window.__lumenpost.scene.isMenuMode, null, { timeout: 20000 });
await page.addStyleTag({ content: '#ui { display: none !important; }' });

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
    // The Landing's centre, facing 160° from local north: the sun behind the camera.
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
    const forward = new V(0, 1, 0).projectOnPlane(up).normalize().applyAxisAngle(up, (160 * Math.PI) / 180);
    s.player.object3D.lookAt(pos.clone().add(forward));
    s.rig.reset(pos, forward);
    s.rig.pitch = (8 * Math.PI) / 180;
  }, lit);
  await page.waitForTimeout(2000);

  const points = await page.evaluate(() => {
    const s = window.__lumenpost.scene;
    const camera = s.renderer.camera;
    const p = s.player.object3D.position;
    const up = p.clone().normalize();
    const toCamera = camera.position.clone().sub(p).projectOnPlane(up).normalize();
    const at = (height) => {
      // A point on her surface facing the camera, not her centre line.
      const q = p.clone().addScaledVector(up, height).addScaledVector(toCamera, 0.12).project(camera);
      return { x: Math.round((q.x * 0.5 + 0.5) * innerWidth), y: Math.round((-q.y * 0.5 + 0.5) * innerHeight) };
    };
    return { skirt: at(0.45), back: at(1.15) };
  });

  const shot = await page.screenshot();
  const report = [];
  for (const [name, { x, y }] of Object.entries(points)) {
    const box = await sharp(shot)
      .extract({ left: x - 6, top: y - 6, width: 12, height: 12 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sum = [0, 0, 0];
    for (let i = 0; i < box.data.length; i += box.info.channels) for (let c = 0; c < 3; c++) sum[c] += box.data[i + c];
    const n = box.info.width * box.info.height;
    report.push(`${name} ${sum.map((v) => (v / n).toFixed(0)).join(',')}`);
  }
  console.log(`${mood.padEnd(8)} ${report.join('   ')}`);
}
await browser.close();
