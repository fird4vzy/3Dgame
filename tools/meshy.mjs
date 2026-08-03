/**
 * Meshy client.
 *
 * Fetches models straight into `public/assets/models/`, so the loop from "I
 * want a cottage" to "it is in the game" is one command instead of a browser
 * round trip. Everything it downloads still goes through `styliseModel` at
 * load time — this only gets the file here.
 *
 * The key is read from `.env`, which is gitignored. It is never printed, never
 * passed on the command line (shell history), and never written into any file
 * this produces.
 *
 * Usage:
 *   node tools/meshy.mjs check
 *   node tools/meshy.mjs text "a small cosy cottage with a tiled roof" cottage
 *   node tools/meshy.mjs status <taskId>
 *   node tools/meshy.mjs fetch <taskId> <name>
 *
 * `text` runs the whole thing: submit, poll, download. The other three are for
 * when a job outlives the terminal you started it in.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'assets', 'models');

/** Minimal .env reader — not worth a dependency for one key. */
function loadEnv() {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const KEY = loadEnv().MESHY_API_KEY || process.env.MESHY_API_KEY;
if (!KEY) {
  console.error(
    'No MESHY_API_KEY.\n\n' +
      '  1. app.meshy.ai -> Settings -> API Keys -> Create new key\n' +
      '  2. paste it into .env  (copy .env.example if it is missing)\n\n' +
      '.env is gitignored, so the key stays on this machine.',
  );
  process.exit(1);
}

const BASE = 'https://api.meshy.ai/openapi';

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const text = await response.text();
  if (!response.ok) {
    // Say what actually went wrong. A bare 401 sends people hunting through
    // their code when the answer is almost always the key.
    const hint =
      response.status === 401
        ? '  -> the key is wrong, expired, or has a stray space in .env'
        : response.status === 402
          ? '  -> out of credits'
          : response.status === 404
            ? '  -> endpoint not found; Meshy may have moved this route'
            : '';
    throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}\n${text}\n${hint}`);
  }
  return text ? JSON.parse(text) : {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check() {
  const balance = await api('/v1/balance');
  console.log('key works. balance:', JSON.stringify(balance));
}

/**
 * Submit a text-to-3D preview job.
 *
 * Deliberately low-poly and 1024 textures: this is a cel-shaded world with a
 * screen-space outline, and detail beyond that is a draw call and a memory
 * cost buying something the shader throws away. See
 * `public/assets/models/README.md`.
 */
async function submitText(prompt) {
  const body = {
    mode: 'preview',
    prompt,
    // The API accepts exactly one value here; anything else is a 400.
    art_style: 'realistic',
    should_remesh: true,
    target_polycount: 4000,
    topology: 'triangle',
  };
  const result = await api('/v2/text-to-3d', { method: 'POST', body: JSON.stringify(body) });
  return result.result ?? result.id;
}

/**
 * Texture a finished preview.
 *
 * `preview` returns geometry only — untextured white. That is not a fault, it
 * is how the two-stage flow works, and it is the single most confusing thing
 * about this API: the first result looks broken when it is merely unfinished.
 * A textured model is the entire reason to use a generator over primitives, so
 * this always runs.
 */
async function submitRefine(previewTaskId) {
  const result = await api('/v2/text-to-3d', {
    method: 'POST',
    body: JSON.stringify({ mode: 'refine', preview_task_id: previewTaskId }),
  });
  return result.result ?? result.id;
}

async function status(taskId) {
  return api(`/v2/text-to-3d/${taskId}`);
}

async function waitFor(taskId) {
  process.stdout.write(`task ${taskId} `);
  for (let attempt = 0; attempt < 240; attempt++) {
    const task = await status(taskId);
    const state = task.status ?? task.state;
    if (state === 'SUCCEEDED') {
      console.log(' done');
      return task;
    }
    if (state === 'FAILED' || state === 'CANCELED') {
      throw new Error(`task ${state}: ${JSON.stringify(task.task_error ?? task)}`);
    }
    process.stdout.write('.');
    await sleep(5000);
  }
  throw new Error('timed out after 20 minutes');
}

async function download(task, name) {
  const url = task.model_urls?.glb ?? task.model_url;
  if (!url) throw new Error(`no glb in task: ${JSON.stringify(task).slice(0, 400)}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download -> ${response.status}`);

  const file = join(OUT_DIR, `${name}.glb`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));

  // Optimise before anyone can forget to.
  //
  // Meshy ships 2048 PNG maps, about 3 MB a model. Thirty props at that size
  // is 90 MB of assets for a game whose whole JS bundle is under one, and the
  // detail buys nothing: behind a cel shader and a screen-space outline a 2048
  // map and a 512 map are indistinguishable past two metres. Making this a
  // separate step people are told to run is making it a step people skip.
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [join(ROOT, 'tools', 'optimise-glb.mjs'), file, '512'], {
    stdio: 'inherit',
  });

  const mb = (readFileSync(file).length / 1024 / 1024).toFixed(2);
  console.log(`\nwrote public/assets/models/${name}.glb  (${mb} MB)`);
  console.log(
    `check it:  http://localhost:5173/tools/model-preview.html?model=/assets/models/${name}.glb&height=3`,
  );
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'check') {
    await check();
  } else if (command === 'text') {
    // Last argument is the name; everything before it is the prompt.
    //
    // `npm run` strips quotes on Windows, so a carefully quoted prompt arrives
    // as loose words and a naive `[prompt, name]` destructure silently submits
    // the single word "a" — which is what happened the first time this ran.
    // Joining is not a workaround for a broken shell, it is how the command is
    // actually typed.
    if (args.length < 2) throw new Error('usage: npm run meshy text <prompt words> <name>');
    const name = args[args.length - 1];
    const prompt = args.slice(0, -1).join(' ');
    console.log(`prompt: "${prompt}"`);
    console.log(`name:   ${name}`);
    const previewId = await submitText(prompt);
    console.log(`preview:   ${previewId}`);
    await waitFor(previewId);

    const refineId = await submitRefine(previewId);
    console.log(`refine:    ${refineId}`);
    await download(await waitFor(refineId), name);
  } else if (command === 'status') {
    console.log(JSON.stringify(await status(args[0]), null, 1));
  } else if (command === 'fetch') {
    await download(await status(args[0]), args[1] ?? args[0]);
  } else {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  }
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
