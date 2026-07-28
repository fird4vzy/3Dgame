/**
 * End-to-end smoke test.
 *
 * Boots the real game in a real browser and asserts the Phase 1 contract: the
 * player spawns on the surface, stays grounded while walking, reaches the tuned
 * walk and run speeds, jumps and lands, and traverses a meaningful arc of the
 * planet without console errors.
 *
 * Usage:  npm run dev   (in another shell)
 *         npm run test:e2e
 *
 * In this container Chromium is preinstalled at /opt/pw-browsers; set
 * LUMENPOST_CHROMIUM to override.
 */
import { chromium } from 'playwright';

const URL = process.env.LUMENPOST_URL ?? 'http://localhost:5173/';
const EXECUTABLE = process.env.LUMENPOST_CHROMIUM ?? '/opt/pw-browsers/chromium';

const failures = [];
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
};

const launchOptions = {
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};
if (EXECUTABLE) launchOptions.executablePath = EXECUTABLE;

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__lumenpost?.scene?.controller, null, { timeout: 60000 });

const read = () =>
  page.evaluate(() => {
    const { scene, loop } = window.__lumenpost;
    const p = scene.player.object3D.position;
    return {
      radius: Math.hypot(p.x, p.y, p.z),
      pos: { x: p.x, y: p.y, z: p.z },
      grounded: scene.controller.grounded,
      state: scene.controller.state,
      speed: scene.controller.planarSpeed,
      fps: loop.fps,
    };
  });

/** Fraction of frames over `n` samples where the player was grounded. */
const groundedFraction = (n) =>
  page.evaluate(async (count) => {
    const { scene } = window.__lumenpost;
    let grounded = 0;
    for (let i = 0; i < count; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (scene.controller.grounded) grounded++;
    }
    return grounded / count;
  }, n);

console.log('\nspawn');
await page.waitForTimeout(1500);
const spawn = await read();
check('lands on the surface, not in the void', spawn.grounded, `state=${spawn.state}`);
check('spawns at plausible altitude', spawn.radius > 50 && spawn.radius < 70, `r=${spawn.radius.toFixed(2)}`);
check('is idle at rest', spawn.state === 'idle', spawn.state);

console.log('\nwalking');
await page.keyboard.down('KeyW');
await page.waitForTimeout(1500);
const walk = await read();
check('reaches walk speed (2.2 m/s)', Math.abs(walk.speed - 2.2) < 0.25, `${walk.speed.toFixed(2)} m/s`);
check('reports walking', walk.state === 'walking', walk.state);
const walkGrounded = await groundedFraction(90);
check('stays grounded while walking', walkGrounded > 0.95, `${(walkGrounded * 100).toFixed(0)}%`);

console.log('\nrunning');
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(1500);
const run = await read();
check('reaches run speed (4.6 m/s)', Math.abs(run.speed - 4.6) < 0.3, `${run.speed.toFixed(2)} m/s`);
check('reports running', run.state === 'running', run.state);
const runGrounded = await groundedFraction(90);
check('stays grounded over hills while running', runGrounded > 0.9, `${(runGrounded * 100).toFixed(0)}%`);

console.log('\njumping');
await page.keyboard.press('Space');
await page.waitForTimeout(200);
const mid = await read();
check('leaves the ground', !mid.grounded && mid.state === 'jumping', mid.state);
await page.waitForTimeout(1600);
const landed = await read();
check('lands again', landed.grounded, landed.state);

console.log('\ncamera and traversal');
await page.mouse.move(640, 360);
await page.mouse.down();
for (let i = 0; i < 30; i++) {
  await page.mouse.move(640 + i * 16, 360 + Math.sin(i / 4) * 40);
  await page.waitForTimeout(20);
}
await page.mouse.up();
await page.waitForTimeout(4000);
const far = await read();

// Great-circle arc travelled from the spawn point.
const angle = Math.acos(
  Math.min(
    1,
    (spawn.pos.x * far.pos.x + spawn.pos.y * far.pos.y + spawn.pos.z * far.pos.z) /
      (spawn.radius * far.radius),
  ),
);
const arc = angle * 60;
check('traverses the surface', arc > 20, `${arc.toFixed(1)} m of arc`);
check('stays on the surface after camera work', far.grounded && far.radius > 50 && far.radius < 70, `r=${far.radius.toFixed(2)}`);

await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');

console.log('\nresponsive');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
const portrait = await page.evaluate(() => {
  const c = document.getElementById('game');
  const r = c.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
check('canvas fills a portrait viewport', portrait.w === 390 && portrait.h === 844, JSON.stringify(portrait));

console.log('\nconsole');
check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();

console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
