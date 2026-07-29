#!/usr/bin/env node
/**
 * Synthesise the placeholder soundtrack and SFX set.
 *
 * The stem-layered music system is the mechanical heart of the illumination
 * hook — each district that lights adds an instrument — but it cannot be judged,
 * tuned or regression-tested against silence. This generates six stems that are
 * *musically additive by construction*: one tempo, one chord progression, one
 * length, each part written to work alone and in every combination.
 *
 * These are placeholders with an honest job: prove the system, set the tempo and
 * key, and give a composer a spec to replace. Swapping in real music means
 * dropping files with the same names and lengths into the same folders.
 *
 * Usage:  node tools/generate-audio.mjs [outDir]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

const SAMPLE_RATE = 48000;
const BPM = 96;
const BEAT = 60 / BPM;
const BARS = 8;
const BEATS_PER_BAR = 4;
const LOOP_SECONDS = BARS * BEATS_PER_BAR * BEAT; // 20s

/** A minor progression, two bars each: Am – F – C – G. */
const PROGRESSION = [
  { root: 'A2', chord: ['A3', 'C4', 'E4'] },
  { root: 'F2', chord: ['F3', 'A3', 'C4'] },
  { root: 'C3', chord: ['C4', 'E4', 'G4'] },
  { root: 'G2', chord: ['G3', 'B3', 'D4'] },
];

const NOTE_OFFSETS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Scientific pitch notation → Hz. */
function hz(note) {
  const letter = note[0];
  const octave = Number(note.slice(-1));
  const sharp = note.includes('#') ? 1 : 0;
  const semitone = NOTE_OFFSETS[letter] + sharp + (octave + 1) * 12;
  return 440 * Math.pow(2, (semitone - 69) / 12);
}

// ── synthesis primitives ──────────────────────────────────────────────────

const buffer = () => new Float32Array(Math.ceil(LOOP_SECONDS * SAMPLE_RATE));

/** Attack/decay/sustain/release envelope value at time `t` within `duration`. */
function envelope(t, duration, attack, decay, sustain, release) {
  if (t < 0 || t > duration) return 0;
  if (t < attack) return t / attack;
  if (t < attack + decay) {
    return 1 - ((t - attack) / decay) * (1 - sustain);
  }
  const releaseStart = duration - release;
  if (t > releaseStart) return sustain * Math.max(0, 1 - (t - releaseStart) / release);
  return sustain;
}

const OSC = {
  sine: (phase) => Math.sin(phase),
  triangle: (phase) => (2 / Math.PI) * Math.asin(Math.sin(phase)),
  saw: (phase) => 2 * (((phase / (2 * Math.PI)) % 1) - 0.5),
  square: (phase) => (Math.sin(phase) >= 0 ? 1 : -1),
};

/**
 * Add one note. Writing directly into a shared buffer keeps every stem
 * sample-aligned with the others, which is what lets them be mixed later.
 */
function note(out, { start, duration, frequency, gain = 0.2, wave = 'sine', env, detune = 0, vibrato = 0 }) {
  const [attack, decay, sustain, release] = env ?? [0.01, 0.1, 0.7, 0.15];
  const osc = OSC[wave] ?? OSC.sine;
  const startSample = Math.floor(start * SAMPLE_RATE);
  const endSample = Math.min(out.length, Math.floor((start + duration) * SAMPLE_RATE));

  let phase = 0;
  let phase2 = 0;
  for (let i = startSample; i < endSample; i++) {
    const t = (i - startSample) / SAMPLE_RATE;
    const amp = envelope(t, duration, attack, decay, sustain, release) * gain;
    if (amp <= 0) continue;

    const wobble = vibrato ? 1 + Math.sin(2 * Math.PI * 5 * t) * vibrato : 1;
    phase += (2 * Math.PI * frequency * wobble) / SAMPLE_RATE;

    let value = osc(phase);
    if (detune) {
      // A second slightly-detuned voice is what makes a pad sound wide rather
      // than thin — cheap chorus without a delay line.
      phase2 += (2 * Math.PI * frequency * (1 + detune) * wobble) / SAMPLE_RATE;
      value = (value + osc(phase2)) * 0.5;
    }
    out[i] += value * amp;
  }
}

/** Filtered noise burst — the basis of every footstep and impact. */
function noiseBurst(out, { start, duration, gain = 0.3, lowpass = 0.35, highpass = 0 }) {
  const startSample = Math.floor(start * SAMPLE_RATE);
  const endSample = Math.min(out.length, Math.floor((start + duration) * SAMPLE_RATE));

  let lp = 0;
  let hp = 0;
  let prev = 0;
  for (let i = startSample; i < endSample; i++) {
    const t = (i - startSample) / duration / SAMPLE_RATE;
    const amp = Math.pow(1 - Math.min(1, t), 2.5) * gain;
    const white = Math.random() * 2 - 1;

    lp += (white - lp) * lowpass;
    let value = lp;
    if (highpass > 0) {
      hp = highpass * (hp + value - prev);
      prev = value;
      value = hp;
    }
    out[i] += value * amp;
  }
}

function normalise(out, peak = 0.5) {
  let max = 0;
  for (const sample of out) max = Math.max(max, Math.abs(sample));
  if (max < 1e-6) return out;
  const scale = peak / max;
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

function toWav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SAMPLE_RATE, 24);
  bytes.writeUInt32LE(SAMPLE_RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    bytes.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return bytes;
}

// ── the six stems ─────────────────────────────────────────────────────────
// Each is written against the same progression so any subset sounds intentional.

const chordAt = (bar) => PROGRESSION[Math.floor(bar / 2) % PROGRESSION.length];

function stemBase() {
  // Always-on pad: roots and fifths, very soft, long attack.
  const out = buffer();
  for (let bar = 0; bar < BARS; bar += 2) {
    const { chord } = chordAt(bar);
    const start = bar * BEATS_PER_BAR * BEAT;
    const duration = 2 * BEATS_PER_BAR * BEAT;
    for (const pitch of [chord[0], chord[2]]) {
      note(out, {
        start,
        duration,
        frequency: hz(pitch) / 2,
        gain: 0.22,
        wave: 'triangle',
        detune: 0.004,
        env: [1.2, 0.4, 0.85, 1.4],
      });
    }
  }
  return normalise(out, 0.34);
}

function stemBass() {
  const out = buffer();
  for (let bar = 0; bar < BARS; bar++) {
    const { root } = chordAt(bar);
    for (let beat = 0; beat < BEATS_PER_BAR; beat += 2) {
      note(out, {
        start: (bar * BEATS_PER_BAR + beat) * BEAT,
        duration: BEAT * 1.6,
        frequency: hz(root),
        gain: 0.5,
        wave: 'sine',
        env: [0.006, 0.25, 0.35, 0.3],
      });
    }
    // Soft heartbeat on the downbeat.
    noiseBurst(out, {
      start: bar * BEATS_PER_BAR * BEAT,
      duration: 0.12,
      gain: 0.12,
      lowpass: 0.06,
    });
  }
  return normalise(out, 0.42);
}

function stemGuitar() {
  // Plucked arpeggio, one note per beat, gently syncopated.
  const out = buffer();
  for (let bar = 0; bar < BARS; bar++) {
    const { chord } = chordAt(bar);
    for (let beat = 0; beat < BEATS_PER_BAR; beat++) {
      const pitch = chord[(bar + beat) % chord.length];
      note(out, {
        start: (bar * BEATS_PER_BAR + beat) * BEAT + (beat % 2 ? 0.06 : 0),
        duration: BEAT * 1.1,
        frequency: hz(pitch),
        gain: 0.3,
        wave: 'triangle',
        env: [0.004, 0.5, 0.15, 0.3],
      });
    }
  }
  return normalise(out, 0.36);
}

function stemArp() {
  // Sixteenth-note synth figure — the industrial district's pulse.
  const out = buffer();
  const step = BEAT / 4;
  for (let bar = 0; bar < BARS; bar++) {
    const { chord } = chordAt(bar);
    for (let i = 0; i < BEATS_PER_BAR * 4; i++) {
      if (i % 2 === 1) continue; // eighth-note feel, not a wall of sixteenths
      const pitch = chord[i % chord.length];
      note(out, {
        start: bar * BEATS_PER_BAR * BEAT + i * step,
        duration: step * 1.4,
        frequency: hz(pitch) * 2,
        gain: 0.16,
        wave: 'square',
        env: [0.003, 0.06, 0.1, 0.08],
      });
    }
  }
  return normalise(out, 0.26);
}

function stemStrings() {
  const out = buffer();
  for (let bar = 0; bar < BARS; bar += 2) {
    const { chord } = chordAt(bar);
    const start = bar * BEATS_PER_BAR * BEAT;
    const duration = 2 * BEATS_PER_BAR * BEAT;
    for (const pitch of chord) {
      note(out, {
        start,
        duration,
        frequency: hz(pitch),
        gain: 0.16,
        wave: 'saw',
        detune: 0.006,
        vibrato: 0.004,
        env: [0.9, 0.5, 0.75, 1.1],
      });
    }
  }
  return normalise(out, 0.3);
}

function stemChoir() {
  // High, airy, wide — the finale layer.
  const out = buffer();
  for (let bar = 0; bar < BARS; bar += 2) {
    const { chord } = chordAt(bar);
    const start = bar * BEATS_PER_BAR * BEAT;
    const duration = 2 * BEATS_PER_BAR * BEAT;
    for (const pitch of chord) {
      note(out, {
        start,
        duration,
        frequency: hz(pitch) * 2,
        gain: 0.13,
        wave: 'sine',
        detune: 0.008,
        vibrato: 0.006,
        env: [1.6, 0.6, 0.7, 1.6],
      });
    }
  }
  return normalise(out, 0.26);
}

// ── sound effects ─────────────────────────────────────────────────────────

function sfxBuffer(seconds) {
  return new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
}

/** Surface-specific footsteps: same gesture, different filtering. */
function footstep(lowpass, highpass, gain) {
  const out = sfxBuffer(0.22);
  noiseBurst(out, { start: 0, duration: 0.18, gain, lowpass, highpass });
  return normalise(out, 0.5);
}

function jump() {
  const out = sfxBuffer(0.3);
  for (let i = 0; i < 3; i++) {
    note(out, {
      start: i * 0.012,
      duration: 0.2,
      frequency: 300 + i * 120,
      gain: 0.25,
      wave: 'triangle',
      env: [0.004, 0.09, 0.1, 0.09],
    });
  }
  return normalise(out, 0.5);
}

function land(hard) {
  const out = sfxBuffer(0.35);
  noiseBurst(out, { start: 0, duration: hard ? 0.3 : 0.18, gain: hard ? 0.55 : 0.3, lowpass: 0.09 });
  note(out, {
    start: 0,
    duration: 0.16,
    frequency: hard ? 90 : 130,
    gain: hard ? 0.4 : 0.22,
    wave: 'sine',
    env: [0.002, 0.1, 0.05, 0.06],
  });
  return normalise(out, hard ? 0.6 : 0.42);
}

function chime(frequencies, seconds, gain = 0.3) {
  const out = sfxBuffer(seconds);
  frequencies.forEach((frequency, index) => {
    note(out, {
      start: index * 0.055,
      duration: seconds - index * 0.055,
      frequency,
      gain,
      wave: 'sine',
      env: [0.005, seconds * 0.5, 0.18, seconds * 0.4],
    });
  });
  return normalise(out, 0.5);
}

/**
 * The ignition swell — the single most important sound in the game.
 *
 * Rises for 3.5 s to land with the lamp cascade, then blooms the tonic chord.
 */
function ignite() {
  const seconds = 3.5;
  const out = sfxBuffer(seconds);

  // Rising filtered noise: air being drawn in.
  const total = Math.floor(seconds * SAMPLE_RATE);
  let lp = 0;
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    const progress = t / 2.2;
    if (progress > 1) break;
    const cutoff = 0.02 + progress * 0.35;
    lp += (Math.random() * 2 - 1 - lp) * cutoff;
    out[i] += lp * 0.22 * Math.pow(progress, 2);
  }

  // The bloom: A minor, arriving as the lamps catch.
  ['A3', 'C4', 'E4', 'A4'].forEach((pitch, index) => {
    note(out, {
      start: 1.9 + index * 0.07,
      duration: 1.5,
      frequency: hz(pitch),
      gain: 0.3,
      wave: 'triangle',
      detune: 0.005,
      env: [0.02, 0.5, 0.4, 0.9],
    });
  });

  return normalise(out, 0.62);
}

function uiTick(frequency, seconds, wave = 'sine') {
  const out = sfxBuffer(seconds);
  note(out, {
    start: 0,
    duration: seconds,
    frequency,
    gain: 0.3,
    wave,
    env: [0.002, seconds * 0.4, 0.1, seconds * 0.5],
  });
  return normalise(out, 0.35);
}

// ── ambience beds ─────────────────────────────────────────────────────────

const AMBIENCE_SECONDS = 20;

/**
 * Make a buffer loop seamlessly by cross-fading its tail over its head.
 *
 * Noise beds are the one place a loop discontinuity is unmissable — a click
 * every twenty seconds is worse than no ambience at all. The fade is
 * equal-power; a linear one dips in the middle and reads as a dropout.
 */
function seamless(out, fadeSeconds = 2) {
  const fade = Math.floor(fadeSeconds * SAMPLE_RATE);
  const length = out.length;
  if (fade * 2 >= length) return out;

  const body = new Float32Array(length - fade);
  body.set(out.subarray(0, length - fade));

  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const a = Math.cos((t * Math.PI) / 2);
    const b = Math.sin((t * Math.PI) / 2);
    body[i] = body[i] * b + out[length - fade + i] * a;
  }
  return body;
}

/** Slowly-modulated filtered noise — the substrate of every bed. */
function windBed(out, { lowpass, gain, swellRate, swellDepth = 0.5, highpass = 0 }) {
  let lp = 0;
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    // Two detuned LFOs so the swell never sounds metronomic.
    const swell =
      1 - swellDepth +
      swellDepth *
        (0.5 + 0.35 * Math.sin(2 * Math.PI * swellRate * t) +
          0.15 * Math.sin(2 * Math.PI * swellRate * 1.7 * t + 1.1));

    lp += (Math.random() * 2 - 1 - lp) * lowpass;
    let value = lp;
    if (highpass > 0) {
      hp = highpass * (hp + value - prev);
      prev = value;
      value = hp;
    }
    out[i] += value * gain * swell;
  }
}

const ambBuffer = () => new Float32Array(AMBIENCE_SECONDS * SAMPLE_RATE);

function ambLanding() {
  const out = ambBuffer();
  windBed(out, { lowpass: 0.06, gain: 0.5, swellRate: 0.07 });
  for (let i = 0; i < 5; i++) {
    note(out, {
      start: 1.5 + i * 3.7, duration: 2.4,
      frequency: hz(['E5', 'A5', 'C6'][i % 3]),
      gain: 0.05, wave: 'sine', env: [0.02, 1.2, 0.1, 1.1],
    });
  }
  return normalise(seamless(out), 0.4);
}

function ambBramblewood() {
  const out = ambBuffer();
  // Leaves: brighter and faster than open wind.
  windBed(out, { lowpass: 0.35, highpass: 0.55, gain: 0.4, swellRate: 0.22, swellDepth: 0.7 });
  for (let i = 0; i < 7; i++) {
    const start = 0.8 + i * 2.6;
    note(out, { start, duration: 0.1, frequency: 1400 + Math.random() * 900, gain: 0.05, wave: 'sine', env: [0.01, 0.05, 0.1, 0.04] });
    note(out, { start: start + 0.13, duration: 0.09, frequency: 1900 + Math.random() * 700, gain: 0.04, wave: 'sine', env: [0.01, 0.04, 0.1, 0.04] });
  }
  return normalise(seamless(out), 0.36);
}

function ambCoil() {
  const out = ambBuffer();
  // Machine hum under intermittent steam.
  note(out, { start: 0, duration: AMBIENCE_SECONDS, frequency: 55, gain: 0.16, wave: 'triangle', detune: 0.01, env: [0.5, 0.5, 1, 0.5] });
  note(out, { start: 0, duration: AMBIENCE_SECONDS, frequency: 110, gain: 0.07, wave: 'sine', env: [0.5, 0.5, 1, 0.5] });
  windBed(out, { lowpass: 0.5, highpass: 0.6, gain: 0.22, swellRate: 0.31, swellDepth: 0.9 });
  for (let i = 0; i < 4; i++) {
    noiseBurst(out, { start: 2 + i * 4.9, duration: 0.9, gain: 0.14, lowpass: 0.7, highpass: 0.5 });
  }
  return normalise(seamless(out), 0.4);
}

function ambTidebreak() {
  const out = ambBuffer();
  // Deep swell with a brighter crest riding on it.
  windBed(out, { lowpass: 0.05, gain: 0.55, swellRate: 0.11, swellDepth: 0.85 });
  windBed(out, { lowpass: 0.4, highpass: 0.4, gain: 0.16, swellRate: 0.11, swellDepth: 0.95 });
  return normalise(seamless(out), 0.42);
}

function ambSpire() {
  const out = ambBuffer();
  // Thin, exposed, and quieter than everywhere else.
  windBed(out, { lowpass: 0.14, highpass: 0.35, gain: 0.42, swellRate: 0.09, swellDepth: 0.65 });
  note(out, { start: 0, duration: AMBIENCE_SECONDS, frequency: hz('A5'), gain: 0.02, wave: 'sine', detune: 0.01, env: [3, 2, 1, 3] });
  return normalise(seamless(out), 0.3);
}

const AMBIENCE = {
  amb_landing: ambLanding,
  amb_bramblewood: ambBramblewood,
  amb_coil: ambCoil,
  amb_tidebreak: ambTidebreak,
  amb_spire: ambSpire,
};

// ── build ─────────────────────────────────────────────────────────────────

const MUSIC = {
  mus_stem_base: stemBase,
  mus_stem_bass: stemBass,
  mus_stem_guitar: stemGuitar,
  mus_stem_arp: stemArp,
  mus_stem_strings: stemStrings,
  mus_stem_choir: stemChoir,
};

const SFX = {
  sfx_footstep_grass: () => footstep(0.5, 0.5, 0.22),
  sfx_footstep_sand: () => footstep(0.3, 0.2, 0.26),
  sfx_footstep_stone: () => footstep(0.75, 0.75, 0.2),
  sfx_footstep_wood: () => footstep(0.45, 0.6, 0.24),
  sfx_footstep_metal: () => footstep(0.9, 0.85, 0.18),
  sfx_jump: jump,
  sfx_land_soft: () => land(false),
  sfx_land_hard: () => land(true),
  sfx_parcel_pickup: () => chime([hz('E4'), hz('A4'), hz('C5')], 0.7),
  sfx_parcel_handoff: () => chime([hz('C4'), hz('E4'), hz('G4'), hz('C5')], 1.1),
  sfx_shard_collect: () => chime([hz('E5'), hz('B5')], 0.55, 0.24),
  sfx_district_ignite: ignite,
  sfx_ui_click: () => uiTick(660, 0.09),
  sfx_ui_hover: () => uiTick(880, 0.05),
  sfx_ui_back: () => uiTick(440, 0.11, 'triangle'),
};

function encode(wavPath, outBase) {
  const bin = ffmpeg.path;
  const common = ['-y', '-hide_banner', '-loglevel', 'error', '-i', wavPath];
  // Opus everywhere, AAC for Safari.
  execFileSync(bin, [...common, '-c:a', 'libopus', '-b:a', '72k', `${outBase}.webm`]);
  execFileSync(bin, [...common, '-c:a', 'aac', '-b:a', '96k', `${outBase}.m4a`]);
}

function main() {
  const outDir = process.argv[2] ?? 'public/assets/audio';
  const musicDir = join(outDir, 'music');
  const sfxDir = join(outDir, 'sfx');
  const ambDir = join(outDir, 'ambience');
  const tmpDir = join(outDir, '.tmp');

  for (const dir of [musicDir, sfxDir, ambDir, tmpDir]) mkdirSync(dir, { recursive: true });

  console.log(`tempo ${BPM} BPM · loop ${LOOP_SECONDS.toFixed(1)}s · A minor`);

  for (const [name, generate] of Object.entries(MUSIC)) {
    const wav = join(tmpDir, `${name}.wav`);
    writeFileSync(wav, toWav(generate()));
    encode(wav, join(musicDir, name));
    console.log(`  music/${name}`);
  }

  for (const [name, generate] of Object.entries(SFX)) {
    const wav = join(tmpDir, `${name}.wav`);
    writeFileSync(wav, toWav(generate()));
    encode(wav, join(sfxDir, name));
    console.log(`  sfx/${name}`);
  }

  for (const [name, generate] of Object.entries(AMBIENCE)) {
    const wav = join(tmpDir, `${name}.wav`);
    writeFileSync(wav, toWav(generate()));
    encode(wav, join(ambDir, name));
    console.log(`  ambience/${name}`);
  }

  rmSync(tmpDir, { recursive: true, force: true });
  console.log('\ndone');
}

main();
