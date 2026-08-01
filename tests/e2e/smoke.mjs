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

/**
 * Launch a browser, portably.
 *
 * CI containers ship a Chromium at a fixed path; developer machines have their
 * own Chrome. Prefer an explicit override, then the container path if it really
 * exists, then the locally-installed Chrome, then whatever Playwright bundled.
 * Hard-coding one of these is why this suite only ran in one place.
 */
async function launchBrowser(chromium, args) {
  const explicit = process.env.LUMENPOST_CHROMIUM;
  if (explicit) return chromium.launch({ executablePath: explicit, args });

  const { existsSync } = await import('node:fs');
  const containerPath = '/opt/pw-browsers/chromium';
  if (existsSync(containerPath)) {
    return chromium.launch({ executablePath: containerPath, args });
  }

  try {
    return await chromium.launch({ channel: 'chrome', args });
  } catch {
    return chromium.launch({ args });
  }
}

const URL = process.env.LUMENPOST_URL ?? 'http://localhost:5173/';

const failures = [];
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
};

const browser = await launchBrowser(chromium, [
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
]);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));


/**
 * Dismiss the main menu and begin a run.
 *
 * The game boots into the menu, so every gameplay test starts by doing what a
 * player does. Accepts either label, since "Continue" replaces "Begin" once a
 * save exists.
 */
async function beginRun(page) {
  await page.waitForFunction(() => window.__lumenpost?.scene, null, { timeout: 60000 });
  if (await page.evaluate(() => !window.__lumenpost.scene.isMenuMode)) return;

  for (const label of ['Begin', 'Continue']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if ((await button.count()) > 0) {
      await button.first().click();
      break;
    }
  }
  await page.waitForFunction(() => !window.__lumenpost.scene.isMenuMode, null, { timeout: 20000 });
  await page.waitForTimeout(700);
}

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__lumenpost?.scene?.controller, null, { timeout: 60000 });
await beginRun(page);

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
// Assert she is *airborne*, not which half of the arc she is in. The apex is
// at 367 ms (6.6 m/s against 18 m/s²), so a 200 ms sample is nominally still
// rising — but any scheduling delay pushes it past the top and the state flips
// to `falling`. Pinning the exact state made this fail about one run in three
// while the behaviour under test was fine.
check('leaves the ground', !mid.grounded && mid.state !== 'idle', mid.state);
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
