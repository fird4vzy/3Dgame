/**
 * Measure whether the buildings actually stand on the ground.
 *
 * "The origin of every instance is at terrain height" is true by construction
 * and proves nothing — it is where the *footprint* meets the ground that a
 * building floats or sinks. So for every instanced prop this samples the
 * terrain under the four corners of the instance's footprint and reports the
 * worst gap and the worst burial, in metres.
 *
 * Usage:  npm run dev
 *         node tools/probe-grounding.mjs
 */
import { chromium } from 'playwright';

const PORT = process.env.LUMENPOST_PORT ?? '5173';
const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__lumenpost?.scene, null, { timeout: 60000 });
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
// Let the async model loads land.
await page.waitForTimeout(6000);

const report = await page.evaluate(() => {
  const s = window.__lumenpost.scene;
  const rows = [];
  s.world.scene.traverse((o) => {
    if (!o.isInstancedMesh || !o.name.endsWith('.glb')) return;
    const box = o.geometry.boundingBox;
    if (!box) return;
    // Where the thing meets the ground is inside its bounding box: a house's
    // walls sit inside its eaves, and a tree's trunk is a fraction of its
    // canopy. Sample there, or every tree "floats" by its own crown.
    const isTree = /sakura|momiji|bamboo/.test(o.name);
    const inset = isTree ? 0.15 : 0.7;
    const w = ((box.max.x - box.min.x) / 2) * inset;
    const d = ((box.max.z - box.min.z) / 2) * inset;
    let worstGap = 0;
    let worstSink = 0;
    let worstIndex = -1;
    // Read the raw matrices rather than going through getMatrixAt, which
    // needs a THREE.Matrix4 this page context does not have.
    const mat = o.instanceMatrix.array;
    for (let i = 0; i < o.count; i++) {
      const e = mat.subarray(i * 16, i * 16 + 16);
      const sx = Math.hypot(e[0], e[1], e[2]);
      if (sx < 1e-6) continue;
      const origin = [e[12], e[13], e[14]];
      const ax = [e[0] / sx, e[1] / sx, e[2] / sx];
      const az = [e[8] / sx, e[9] / sx, e[10] / sx];
      for (const [cx, cz] of [[-w, -d], [w, -d], [w, d], [-w, d]]) {
        const p = [
          origin[0] + ax[0] * cx * sx + az[0] * cz * sx,
          origin[1] + ax[1] * cx * sx + az[1] * cz * sx,
          origin[2] + ax[2] * cx * sx + az[2] * cz * sx,
        ];
        const r = Math.hypot(p[0], p[1], p[2]);
        const dir = { x: p[0] / r, y: p[1] / r, z: p[2] / r, normalize() { return this; }, clone() { return { ...this }; }, multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; }, dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }, copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } };
        const ground = s.terrain.heightAt(dir);
        const gap = r - ground;
        if (gap > worstGap) { worstGap = gap; worstIndex = i; }
        if (-gap > worstSink) worstSink = -gap;
      }
    }
    rows.push({ name: o.name, count: o.count, footprint: `${(w * 2).toFixed(1)}x${(d * 2).toFixed(1)}`, worstGap: worstGap.toFixed(2), worstSink: worstSink.toFixed(2), worstIndex });
  });
  return rows;
});

console.log('prop'.padEnd(22), 'n'.padStart(4), 'footprint'.padStart(10), 'gap'.padStart(6), 'sink'.padStart(6));
for (const r of report) {
  console.log(r.name.padEnd(22), String(r.count).padStart(4), r.footprint.padStart(10), r.worstGap.padStart(6), r.worstSink.padStart(6));
}
await browser.close();
