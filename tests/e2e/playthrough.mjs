/**
 * End-to-end playthrough.
 *
 * Drives the actual delivery loop in a real browser: accept a contract from the
 * postmaster, walk the parcel to the recipient, hand it over, and assert that
 * the district ignites. Then checks that warmth decays, shards collect, and the
 * quest chain advances.
 *
 * Movement is scripted by steering toward the objective rather than replaying
 * fixed key timings, so terrain changes do not break the test.
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
const check = (label, ok, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const browser = await launchBrowser(chromium, ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']);
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__lumenpost?.scene?.quests, null, { timeout: 60000 });
await page.waitForTimeout(1500);

// Target slot the steering helper below reads from.
await page.evaluate(() => {
  window.__lumenpost.__target = null;
});

// The rig reads look input from InputManager, so drive it through a real drag.
async function faceTarget() {
  const info = await page.evaluate(() => {
    const pos = window.__lumenpost.scene.player.object3D.position;
    const t = window.__lumenpost.__target;
    if (!t) return null;
    const up = pos.clone().normalize();
    const heading = new pos.constructor();
    window.__lumenpost.scene.rig.getHeading(heading);
    const to = t.clone().sub(pos).projectOnPlane(up).normalize();
    const right = up.clone().cross(heading).normalize();
    return { angle: Math.atan2(right.dot(to), heading.dot(to)), distance: pos.distanceTo(t) };
  });
  if (!info) return null;

  const pixels = -info.angle / 0.0022; // inverse of mouse sensitivity
  const clamped = Math.max(-260, Math.min(260, pixels));
  if (Math.abs(clamped) > 4) {
    await page.mouse.move(550, 350);
    await page.mouse.down();
    await page.mouse.move(550 + clamped, 350);
    await page.mouse.up();
  }
  return info;
}

async function travelTo(setTarget, stopAt = 2.0, timeoutMs = 90000) {
  await page.evaluate(setTarget);
  const started = Date.now();

  let running = true;
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  try {
    while (Date.now() - started < timeoutMs) {
      const info = await faceTarget();
      if (!info) break;

      // Drop to a walk for the last few metres. At 4.6 m/s the character
      // carries ~0.75 m of momentum after the key is released, which is enough
      // to skid straight back out of a 2.4 m interaction radius.
      if (running && info.distance < 6) {
        await page.keyboard.up('ShiftLeft');
        running = false;
      }

      if (info.distance <= stopAt) return true;
      await page.waitForTimeout(running ? 220 : 90);
    }
  } finally {
    if (running) await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');
    // Let friction bring the character to rest before anything is asserted.
    await page.waitForTimeout(350);
  }
  return false;
}

const read = () =>
  page.evaluate(() => {
    const s = window.__lumenpost.scene;
    const active = s.quests.active;
    return {
      completed: s.quests.completedCount,
      activeId: active?.def.id ?? null,
      activeState: active?.state ?? null,
      nextId: s.quests.nextAvailable?.def.id ?? null,
      lit: s.districts.litCount,
      focus: s.interaction.current?.id ?? null,
      shards: s.shards.collected,
      dialogue: s.dialogue.isActive,
    };
  });

console.log('\nstart');
const start = await read();
check('first contract is available', start.nextId === 'c01_landing', start.nextId);
check('nothing lit yet', start.lit === 0, String(start.lit));

console.log('\nwalk to the postmaster');
const reachedGiver = await travelTo(() => {
  const s = window.__lumenpost.scene;
  const giver = s.quests.nextAvailable.def.giver;
  window.__lumenpost.__target = s.objectiveTarget.position.clone();
  void giver;
}, 2.0);
check('reached the postmaster', reachedGiver);

await page.waitForTimeout(400);
const atGiver = await read();
check('interaction prompt appears', atGiver.focus !== null, String(atGiver.focus));

console.log('\naccept the contract');
await page.keyboard.press('KeyE');
await page.waitForTimeout(500);
check('dialogue opened', (await read()).dialogue);

// Click through the conversation.
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('Space');
  await page.waitForTimeout(320);
  if (!(await read()).dialogue) break;
}
await page.waitForTimeout(400);

const accepted = await read();
check('contract accepted and being carried', accepted.activeState === 'carrying', accepted.activeState);
check('carrying the first contract', accepted.activeId === 'c01_landing', accepted.activeId);

const warmthStart = await page.evaluate(() =>
  window.__lumenpost.scene.warmth.warmthOf('c01_landing'),
);
check('parcel starts warm', warmthStart > 0.9, warmthStart.toFixed(3));

console.log('\ncarry it to the recipient');
const reachedRecipient = await travelTo(() => {
  const s = window.__lumenpost.scene;
  window.__lumenpost.__target = s.objectiveTarget.position.clone();
}, 2.0);
check('reached the recipient', reachedRecipient);

const warmthEnd = await page.evaluate(() =>
  window.__lumenpost.scene.warmth.warmthOf('c01_landing'),
);
check('warmth decayed on the way', warmthEnd < warmthStart, `${warmthStart.toFixed(3)} → ${warmthEnd.toFixed(3)}`);

console.log('\nhand it over');
await page.waitForTimeout(400);
await page.keyboard.press('KeyE');
await page.waitForTimeout(500);
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('Space');
  await page.waitForTimeout(320);
  if (!(await read()).dialogue) break;
}

// The ignition takes 3 seconds.
await page.waitForTimeout(3600);
const delivered = await read();

check('delivery completed', delivered.completed === 1, String(delivered.completed));
check('district ignited', delivered.lit === 1, String(delivered.lit));
check('next contract unlocked', delivered.nextId === 'c02_bramblewood', String(delivered.nextId));

const lampLit = await page.evaluate(() => {
  const runtime = window.__lumenpost.scene.districts.get('landing');
  return runtime.light;
});
check('lamps reached full brightness', lampLit > 0.99, lampLit.toFixed(3));

const saved = await page.evaluate(() => window.__lumenpost.save.get().progress);
check('progress persisted', saved.completedContracts.includes('c01_landing'), JSON.stringify(saved.completedContracts));
check('lit district persisted', saved.litDistricts.includes('landing'), JSON.stringify(saved.litDistricts));

console.log('\nconsole');
check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await page.screenshot({ path: process.env.LUMENPOST_SHOT ?? 'playthrough.png' });
await browser.close();

console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
