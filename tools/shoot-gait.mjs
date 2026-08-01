/**
 * Shoot the gait contact sheet, and check the feet do not slide.
 *
 * The screenshot is for a person to look at. The assertions are the part a
 * green unit suite could never give us: through the stance phase the planted
 * foot has to travel backwards through the character's own frame at the same
 * speed the character travels forwards, or the walk slides. That single number
 * is the difference between locomotion that reads and locomotion that does not,
 * and it is invisible in any still image.
 *
 * Usage:  npm run dev
 *         node tools/shoot-gait.mjs [outputPrefix]
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const out = process.argv[2] ?? 'gait';
const PORT = process.env.LUMENPOST_PORT ?? '5173';

async function launch() {
  const containerPath = '/opt/pw-browsers/chromium';
  const args = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  if (existsSync(containerPath)) return chromium.launch({ executablePath: containerPath, args });
  try {
    return await chromium.launch({ channel: 'chrome', args });
  } catch {
    return chromium.launch({ args });
  }
}

const failures = [];
const check = (label, ok, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1040 } });
const errors = [];
const ignorable = (t) => /favicon/i.test(t) || /404 \(Not Found\)/.test(t);
page.on('console', (m) => m.type() === 'error' && !ignorable(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto(`http://localhost:${PORT}/tools/gait-preview.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__gaitReady, null, { timeout: 60000 });
await page.locator('canvas').screenshot({ path: `${out}-sheet.png` });

const rows = await page.evaluate(() => window.__gaitReport());
const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));

for (const [label, speed] of [['walk', 2.3], ['run', 4.9]]) {
  const m = await page.evaluate((s) => window.__gaitMeasure(s), speed);
  console.log(`\n${label} @ ${speed} m/s   (standing ankle ${m.restY.toFixed(3)}m)`);

  const ankles = m.frames.flatMap((f) => [f.left.y, f.right.y]);
  const lowest = Math.min(...ankles);
  const highest = Math.max(...ankles);

  /**
   * Foot travel per frame, through the character's own frame of reference.
   *
   * The rig is stationary here, so a foot that is genuinely on the ground must
   * move *backwards* at the body's speed. "On the ground" is decided by ankle
   * height against the standing datum rather than by which foot is lower,
   * because in a run there are moments when neither foot is down at all.
   */
  const planted = (f, side) => {
    const other = side === 'left' ? 'right' : 'left';
    // Close to the standing datum *and* the lower of the two. In a run there
    // are moments with neither foot down, and late swing skims close enough to
    // the ground that height alone lets a swinging foot in.
    return f[side].y < m.restY + 0.03 && f[side].y <= f[other].y;
  };
  const drifts = [];
  for (let i = 1; i < m.frames.length; i++) {
    const a = m.frames[i - 1];
    const b = m.frames[i];
    for (const side of ['left', 'right']) {
      if (!planted(a, side) || !planted(b, side)) continue;
      drifts.push((b[side].z - a[side].z) / m.dt);
    }
  }

  const mean = drifts.reduce((x, y) => x + y, 0) / (drifts.length || 1);
  const error = Math.abs(-speed - mean) / speed;
  check(
    'the planted foot tracks the ground',
    drifts.length > 4 && error < 0.2,
    `mean ${mean.toFixed(2)} m/s vs expected ${(-speed).toFixed(2)} (${(error * 100).toFixed(0)}% off, ${drifts.length} planted samples)`,
  );

  check(
    'a foot reaches the ground each cycle',
    lowest < m.restY + 0.03,
    `lowest ankle ${lowest.toFixed(3)}m vs standing ${m.restY.toFixed(3)}m`,
  );
  check('the other foot lifts clear', highest > lowest + 0.08, `lift ${(highest - lowest).toFixed(3)}m`);
  check(
    'no foot goes through the floor',
    lowest > m.restY - 0.04,
    `lowest ankle ${lowest.toFixed(3)}m`,
  );
}

console.log('\njump');
const jump = byLabel.jump;
if (jump) {
  const feetY = jump.frames.map((f) => ((f.left?.y ?? 0) + (f.right?.y ?? 0)) / 2);
  const apex = Math.max(...feetY.slice(0, -1));
  check('the legs tuck at the apex', apex > feetY[0], `apex ankle ${apex.toFixed(3)}m vs takeoff ${feetY[0].toFixed(3)}m`);
  check('and come back down to land', feetY[feetY.length - 1] < apex, feetY[feetY.length - 1].toFixed(3));
}

console.log('\nconsole');
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\nwrote ${out}-sheet.png`);
console.log(`${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
