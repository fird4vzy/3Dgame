import * as THREE from 'three';
import { createToonMaterial } from '@engine/render/ToonMaterial';

/**
 * The courier rig — one builder, many characters.
 *
 * Concept sheets are 2D, and a billboard was never going to be right in a game
 * where the camera orbits a sphere: the character has to have a back, cast a
 * shadow, and turn. So a sheet is read as a *specification* rather than as art —
 * proportions, silhouette and palette drive a low-poly humanoid assembled from
 * primitives.
 *
 * The rig is a plain `Object3D` hierarchy rather than a skinned mesh with bones.
 * For a low-poly character with rigid limb segments the visual result is the
 * same, it costs no skinning, and — the reason that actually matters — it can be
 * animated procedurally, so locomotion *cycles* without a single authored
 * keyframe. That was the gap a sprite could never close.
 *
 * Which character gets built is a {@link CharacterSpec}: palette, proportions,
 * hair style, pack and accessories. Aria Chen and Ren Kairo are the same
 * geometry code with different numbers, which is what stops a second character
 * meaning a second 600-line file.
 *
 * Every part is exposed on {@link RenRig} so the animator can pose it.
 */
import {
  REN_SPEC,
  type CharacterPalette,
  type CharacterProportions,
  type CharacterSpec,
} from './characterSpec';

/**
 * How far to lift the sheet's values for gameplay, 0–1.
 *
 * The art is drawn on white paper; the game is a dusk planet, and at 0 the
 * darkest swatches merge into the night sky at distance. This is the smallest
 * lift that keeps a silhouette readable — turn it toward 0 for a look truer to
 * the sheet, toward 1 for the old high-legibility palette. It is one number on
 * purpose: it was previously baked into eleven hand-picked hex values, which
 * made "why doesn't he look like the drawing" impossible to answer or undo.
 */
export const PALETTE_LIFT = 0.14;

const LIFT_TOWARD = '#cfd8d2';

/**
 * Blend a swatch toward `LIFT_TOWARD` in plain sRGB bytes.
 *
 * Deliberately *not* `THREE.Color.lerp`: three converts hex to linear working
 * space on construction, and a linear-space blend toward a light colour raises
 * dark swatches far more than the number suggests — 0.14 there lands lighter
 * than the palette this is replacing. Byte-space matches what the eye and the
 * art tool both do.
 */
function lift(hex: string, amount = PALETTE_LIFT): string {
  const from = parseInt(hex.slice(1), 16);
  const to = parseInt(LIFT_TOWARD.slice(1), 16);
  let out = '';
  for (let shift = 16; shift >= 0; shift -= 8) {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    out += Math.round(a + (b - a) * amount)
      .toString(16)
      .padStart(2, '0');
  }
  return `#${out}`;
}

type BuiltPalette = Record<keyof CharacterPalette, string> & { ink: string };

/** Apply the gameplay lift to a sheet palette. */
function buildPalette(sheet: CharacterPalette): BuiltPalette {
  return {
    skin: lift(sheet.skin),
    hair: lift(sheet.hair),
    hairLift: lift(sheet.hairLift),
    jacket: lift(sheet.jacket),
    jacketDark: lift(sheet.jacketDark),
    // The accents are the design's one bright note; lifting them just washes
    // them out, so they stay as drawn.
    accent: sheet.accent,
    glow: sheet.glow,
    shirt: lift(sheet.shirt),
    pants: lift(sheet.pants),
    boots: lift(sheet.boots),
    metal: lift(sheet.metal),
    leather: lift(sheet.leather),
    /** Eyes and mouth — darker than the hair so the face still reads at 2 m. */
    ink: '#171312',
  };
}

/**
 * The palette and proportions the builder is currently working from.
 *
 * Module-level and mutable, set once at the top of {@link buildCourier}. The
 * geometry below reads them in a couple of hundred places; threading a
 * parameter through every helper would be a large mechanical change for no
 * behavioural gain. The build is synchronous and single-threaded, so there is
 * no interleaving to worry about — but do not read these outside a build.
 */
let PAL: BuiltPalette = buildPalette(REN_SPEC.palette);
let SPEC: CharacterSpec = REN_SPEC;

/** Kept for callers that referenced the old constant. */
export const REN_PALETTE = buildPalette(REN_SPEC.palette);

export interface RenRig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  forearmL: THREE.Group;
  forearmR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  /** Attachment point in the right hand, for carried parcels. */
  handSocket: THREE.Object3D;
  /** The satchel, worn across the back. */
  satchel: THREE.Object3D;
  /** Glasses lenses — emissive, and Ren's signature read. */
  lenses: THREE.Mesh[];
  /** Every mesh, so tinting can be applied uniformly. */
  meshes: THREE.Mesh[];
}

/**
 * Working proportions, in metres.
 *
 * `hipY` is *derived* from the leg chain rather than written down, so the feet
 * land exactly on y=0 by construction. Hard-coding it is how the rig ended up
 * standing 16 cm below the ground the first time — every proportion tweak
 * silently moved the soles.
 */
const HIP_DROP = 0.08;
const FOOT_DROP = 0.145;

type WorkingProportions = CharacterProportions & { footDrop: number; hipY: number };

function buildProportions(p: CharacterProportions): WorkingProportions {
  // Shorter characters need a proportionally smaller ankle-to-sole, or the
  // boots read as platform heels.
  const footDrop = FOOT_DROP * (p.shin / 0.38);
  return {
    ...p,
    footDrop,
    hipY: HIP_DROP * (p.thigh / 0.4) + p.thigh + p.shin + footDrop,
  };
}

let P: WorkingProportions = buildProportions(REN_SPEC.proportions);

/** Head origin in torso space. Recomputed per build, since it follows `P`. */
let HEAD_Y = P.neckY + 0.1;

/**
 * Lowest point of the jaw, in head space.
 *
 * Kept as a named value because the collar is positioned *from* it. Sizing the
 * collar independently is how the first pass ended up hiding the jaw, mouth and
 * nose behind a grey box — the face was there, just buried. It scales with head
 * radius so a smaller head does not lose its chin.
 */
let CHIN_Y = -0.134;

/** Top of the standing collar: clears the chin with a visible gap. */
let COLLAR_TOP_Y = HEAD_Y + CHIN_Y - 0.022;

function mesh(
  geometry: THREE.BufferGeometry,
  colour: string,
  collect: THREE.Mesh[],
  options: {
    emissive?: string;
    emissiveIntensity?: number;
    transparent?: boolean;
    opacity?: number;
  } = {},
): THREE.Mesh {
  const material = createToonMaterial({
    color: colour,
    bands: 3,
    ...(options.emissive ? { emissive: options.emissive } : {}),
    ...(options.emissiveIntensity !== undefined
      ? { emissiveIntensity: options.emissiveIntensity }
      : {}),
    ...(options.transparent !== undefined ? { transparent: options.transparent } : {}),
    ...(options.opacity !== undefined ? { opacity: options.opacity } : {}),
  });
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  collect.push(m);
  return m;
}

/**
 * Ren's hair: a big, messy, swept mass with real volume above the skull.
 *
 * It is the loudest thing in his silhouette and a tight cap loses him, so it is
 * a two-tone cluster — a near-black base with warmer highlight lumps — which is
 * what stops it reading as one flat blob.
 */
function buildSweptHair(head: THREE.Group, meshes: THREE.Mesh[], faceZ: number): void {
  const hairMain = mesh(new THREE.SphereGeometry(P.headR * 1.14, 14, 12), PAL.hair, meshes);
  hairMain.scale.set(1.06, 1.0, 1.06);
  hairMain.position.set(0, 0.048, -0.014);
  head.add(hairMain);

  // Weighted up and to one side so the shape reads as *swept*, not symmetric —
  // that asymmetry is most of what makes the sheet's hair recognisable at low
  // poly. The flag marks lumps that catch the highlight tone.
  for (const [x, y, z, r, sy, highlight] of [
    [-0.092, 0.086, 0.024, 0.62, 1.05, 0],
    [0.062, 0.112, 0.014, 0.66, 1.15, 1],
    [0.0, 0.126, -0.062, 0.7, 0.95, 0],
    [-0.046, 0.152, 0.05, 0.56, 1.25, 1],
    [0.084, 0.08, -0.052, 0.58, 1.05, 0],
    [-0.024, 0.172, -0.014, 0.5, 1.35, 1],
    [0.038, 0.158, 0.052, 0.46, 1.2, 1],
    [-0.078, 0.118, -0.044, 0.52, 1.1, 0],
    [0.096, 0.126, 0.018, 0.44, 1.15, 0],
    [-0.01, 0.096, 0.086, 0.48, 0.9, 0],
  ] as const) {
    const tuft = mesh(
      new THREE.SphereGeometry(P.headR * r, 8, 6),
      highlight ? PAL.hairLift : PAL.hair,
      meshes,
    );
    tuft.position.set(x, y, z);
    tuft.scale.set(1, sy, 1);
    head.add(tuft);
  }

  // Fringe: two angled slabs falling over the brow rather than one bar, so it
  // reads as parted hair instead of a helmet lip.
  for (const [x, rot, w] of [
    [-0.048, -0.34, 0.11],
    [0.042, 0.22, 0.13],
  ] as const) {
    const fringe = mesh(new THREE.BoxGeometry(w, 0.05, 0.05), PAL.hair, meshes);
    fringe.position.set(x, 0.078, faceZ * 0.8);
    fringe.rotation.z = rot;
    head.add(fringe);
  }

  for (const side of [-1, 1]) {
    const sideburn = mesh(new THREE.BoxGeometry(0.018, 0.052, 0.04), PAL.hair, meshes);
    sideburn.position.set(side * (P.headR * 0.93), 0.018, 0.014);
    head.add(sideburn);
  }
}

/**
 * Aria's hair: long, straight and past the shoulders.
 *
 * Split deliberately between two parents. The cap, fringe and face-framing
 * strands ride the **head**, so they turn when she looks around. The long back
 * mass hangs off the **torso**, because hair that pivots with the skull swings
 * like a solid plank every time the head turns — parenting it to the body is
 * the cheapest convincing approximation of it hanging under its own weight.
 */
function buildLongHair(
  head: THREE.Group,
  torso: THREE.Group,
  meshes: THREE.Mesh[],
  faceZ: number,
): void {
  // Cap, slightly larger than the skull and flattened on top.
  const cap = mesh(new THREE.SphereGeometry(P.headR * 1.1, 14, 12), PAL.hair, meshes);
  cap.scale.set(1.05, 1.02, 1.06);
  cap.position.set(0, 0.03, -0.008);
  head.add(cap);

  // A soft crown lump so the top is not a perfect dome.
  const crown = mesh(new THREE.SphereGeometry(P.headR * 0.72, 10, 8), PAL.hairLift, meshes);
  crown.scale.set(1.15, 0.72, 1.1);
  crown.position.set(-0.012, P.headR * 0.72, -0.02);
  head.add(crown);

  // Fringe: a centre-parted sweep across the brow, longer on one side.
  for (const [x, w, h, rot] of [
    [-0.055, 0.095, 0.072, -0.2],
    [0.05, 0.105, 0.062, 0.16],
  ] as const) {
    const fringe = mesh(new THREE.BoxGeometry(w, h, 0.05), PAL.hair, meshes);
    fringe.position.set(x, P.headR * 0.42, faceZ * 0.84);
    fringe.rotation.z = rot;
    head.add(fringe);
  }

  // Face-framing strands, parented to the **torso** so they hang past the
  // shoulders instead of being clipped at the neck.
  //
  // These do most of the work. The back mass is invisible from the front, and
  // the camera spends most of its time behind the player — so without a length
  // of hair visible either side of the jaw, a long-haired character reads as
  // having a short cap from every angle that matters.
  for (const side of [-1, 1]) {
    const front = mesh(
      new THREE.BoxGeometry(0.05, 0.34, 0.075),
      PAL.hair,
      meshes,
    );
    front.position.set(side * (P.headR * 1.02), P.torsoLen * 0.86, P.headR * 0.28);
    front.rotation.z = side * 0.06;
    torso.add(front);

    // A shorter inner strand against the neck, so the outer one does not read
    // as a floating slab detached from the head.
    const inner = mesh(new THREE.BoxGeometry(0.042, 0.15, 0.06), PAL.hair, meshes);
    inner.position.set(side * (P.headR * 0.86), P.torsoLen * 0.98, P.headR * 0.1);
    torso.add(inner);
  }

  // Back mass, on the torso: a tapered fall to mid-back.
  //
  // Its depth has to clear whatever is on the back. At the nape it was sitting
  // *inside* the torso shell and behind that inside the backpack, so the whole
  // long-hair silhouette — the thing that most identifies this character — was
  // invisible from every angle. With a pack it drapes over the outside of it.
  const packDepth = SPEC.pack === 'backpack' ? 0.26 : 0.1;
  const fall = new THREE.Group();
  fall.position.set(0, P.torsoLen * 0.98, -packDepth);
  torso.add(fall);

  const upper = mesh(new THREE.BoxGeometry(0.20, 0.24, 0.10), PAL.hair, meshes);
  upper.position.y = -0.10;
  fall.add(upper);

  const lower = mesh(new THREE.BoxGeometry(0.165, 0.22, 0.085), PAL.hair, meshes);
  lower.position.set(0, -0.31, 0.006);
  fall.add(lower);

  const tip = mesh(new THREE.BoxGeometry(0.115, 0.13, 0.07), PAL.hair, meshes);
  tip.position.set(0.006, -0.46, 0.012);
  fall.add(tip);

  // One highlight panel catching the light, so the mass is not a flat slab.
  const sheen = mesh(new THREE.BoxGeometry(0.075, 0.30, 0.012), PAL.hairLift, meshes);
  sheen.position.set(-0.035, -0.16, -0.052);
  fall.add(sheen);

  // Teal hair clip from the accessories row — a tiny bright spot at the temple.
  const clip = mesh(new THREE.BoxGeometry(0.055, 0.016, 0.03), PAL.accent, meshes, {
    emissive: PAL.accent,
    emissiveIntensity: 0.6,
  });
  clip.position.set(-P.headR * 0.78, P.headR * 0.5, 0.055);
  clip.rotation.z = 0.3;
  head.add(clip);
}

/**
 * Build a character from its spec. Feet sit at the origin, facing +Z, per the
 * asset spec.
 */
export function buildCourier(spec: CharacterSpec = REN_SPEC): RenRig {
  // Point the geometry below at this character's numbers.
  SPEC = spec;
  PAL = buildPalette(spec.palette);
  P = buildProportions(spec.proportions);
  HEAD_Y = P.neckY + 0.1;
  CHIN_Y = -1.186 * P.headR;
  COLLAR_TOP_Y = HEAD_Y + CHIN_Y - 0.022;

  const meshes: THREE.Mesh[] = [];

  const root = new THREE.Group();
  root.name = `${spec.id}_root`;

  // ── hips ────────────────────────────────────────────────────────────────
  const hips = new THREE.Group();
  hips.name = 'ren_hips';
  hips.position.y = P.hipY;
  root.add(hips);

  const pelvis = mesh(new THREE.BoxGeometry(P.pelvisW, 0.20, 0.21), PAL.pants, meshes);
  pelvis.position.y = -0.04;
  hips.add(pelvis);

  // Utility belt — a strong horizontal read at the waist, as on the sheet.
  const belt = mesh(new THREE.BoxGeometry(P.pelvisW * 1.06, 0.07, 0.23), PAL.leather, meshes);
  belt.position.y = 0.07;
  hips.add(belt);

  const pouch = mesh(new THREE.BoxGeometry(0.10, 0.13, 0.08), PAL.jacketDark, meshes);
  pouch.position.set(0.17, 0.0, 0.02);
  hips.add(pouch);

  // ── torso ───────────────────────────────────────────────────────────────
  const torso = new THREE.Group();
  torso.name = 'ren_torso';
  torso.position.y = 0.09;
  hips.add(torso);

  // Torso in two tapered sections rather than one slab, so the figure has a
  // waist. This is the single biggest lever on whether a low-poly humanoid
  // reads as male or female, and it was previously a hardcoded 0.38 box that
  // ignored the spec entirely.
  const waistLen = P.torsoLen * 0.38;
  const chestLen = P.torsoLen - waistLen;
  const depth = P.chestW * 0.63;

  const waist = mesh(
    new THREE.BoxGeometry(P.waistW, waistLen, depth * 0.86),
    PAL.shirt,
    meshes,
  );
  waist.position.y = waistLen / 2 - 0.02;
  torso.add(waist);

  const chest = mesh(new THREE.BoxGeometry(P.chestW, chestLen, depth), PAL.shirt, meshes);
  chest.position.y = waistLen + chestLen / 2 - 0.02;
  torso.add(chest);

  // The jacket is a second, slightly larger shell — that layered silhouette is
  // the most recognisable thing about the design. It follows the same taper,
  // or it fills the waist back in and undoes the shape underneath.
  const jacket = mesh(
    new THREE.BoxGeometry(P.chestW * 1.08, P.torsoLen * 0.58, depth * 1.17),
    PAL.jacket,
    meshes,
  );
  jacket.position.y = waistLen + chestLen / 2 - 0.02;
  torso.add(jacket);

  const jacketSkirt = mesh(
    new THREE.BoxGeometry(P.waistW * 1.1, waistLen * 0.9, depth * 0.98),
    PAL.jacket,
    meshes,
  );
  jacketSkirt.position.y = waistLen * 0.5;
  torso.add(jacketSkirt);

  // Quilting. On the sheet the jacket is a padded puffer read almost entirely
  // through its horizontal seam lines — without them the shell is just a box,
  // and the box is what made him look like a mech instead of a courier.
  for (const y of [0.10, 0.22, 0.34]) {
    const quilt = mesh(new THREE.BoxGeometry(P.chestW * 1.09, 0.030, 0.02), PAL.jacketDark, meshes);
    quilt.position.set(0, y, 0.135);
    torso.add(quilt);
    const back = mesh(new THREE.BoxGeometry(P.chestW * 1.09, 0.030, 0.02), PAL.jacketDark, meshes);
    back.position.set(0, y, -0.135);
    torso.add(back);
  }

  // Open front: two lapels over the black tee, rather than a sealed slab.
  for (const side of [-1, 1]) {
    const lapel = mesh(
      new THREE.BoxGeometry(0.135, P.torsoLen * 0.78, 0.045),
      PAL.jacket,
      meshes,
    );
    lapel.position.set(side * 0.135, P.torsoLen / 2 - 0.05, 0.125);
    lapel.rotation.z = side * 0.06;
    torso.add(lapel);
  }

  // Standing collar. Its top edge is the constraint that matters: pushed up to
  // where a "tall" collar wants to be, it swallowed the jaw, mouth and nose and
  // the face vanished into a grey box. It stops below the chin, deliberately.
  const collar = mesh(new THREE.BoxGeometry(0.27, 0.10, 0.245), PAL.jacketDark, meshes);
  collar.position.y = COLLAR_TOP_Y - 0.05;
  torso.add(collar);

  // Green piping over the shoulders — the design's only saturated note, so it
  // does a lot of the identifying. It has to lie *on* the jacket shell; at any
  // z inside it, it is simply buried and never renders.
  for (const side of [-1, 1]) {
    const piping = mesh(new THREE.BoxGeometry(0.115, 0.014, 0.215), PAL.accent, meshes, {
      emissive: PAL.accent,
      emissiveIntensity: 0.3,
    });
    piping.position.set(side * 0.14, P.torsoLen / 2 - 0.06 + (P.torsoLen * 0.82) / 2, 0);
    torso.add(piping);
  }

  // Circuit accent down the chest.
  const accent = mesh(
    new THREE.BoxGeometry(0.028, P.torsoLen * 0.44, 0.012),
    PAL.accent,
    meshes,
    { emissive: PAL.accent, emissiveIntensity: 0.55 },
  );
  accent.position.set(0.058, P.torsoLen * 0.46, 0.152);
  torso.add(accent);

  // Pack on the back — the courier read, and the glide wing's home. Named
  // `satchel` on the rig whichever shape it takes, so the animator and the
  // glide code do not care which character is wearing it.
  const satchel = new THREE.Group();
  if (SPEC.pack === 'backpack') {
    // Aria's sheet: a tall slab pack with a teal-piped lid, sitting high.
    satchel.position.set(0, P.torsoLen * 0.46, -0.17);
    const body = mesh(new THREE.BoxGeometry(0.27, 0.34, 0.15), PAL.jacketDark, meshes);
    satchel.add(body);

    const lid = mesh(new THREE.BoxGeometry(0.28, 0.10, 0.16), PAL.jacket, meshes);
    lid.position.y = 0.13;
    satchel.add(lid);

    const piping = mesh(new THREE.BoxGeometry(0.29, 0.014, 0.017), PAL.accent, meshes, {
      emissive: PAL.accent,
      emissiveIntensity: 0.5,
    });
    piping.position.set(0, 0.075, 0.076);
    satchel.add(piping);
    torso.add(satchel);

    // Two shoulder straps rather than one cross-body strap.
    for (const side of [-1, 1]) {
      const strap = mesh(new THREE.BoxGeometry(0.042, 0.30, 0.016), PAL.jacketDark, meshes);
      strap.position.set(side * 0.085, P.torsoLen * 0.56, 0.142);
      torso.add(strap);
    }
  } else if (SPEC.pack === 'satchel') {
    satchel.position.set(0, P.torsoLen * 0.35, -0.19);
    const satchelBody = mesh(new THREE.BoxGeometry(0.30, 0.24, 0.13), PAL.leather, meshes);
    satchel.add(satchelBody);
    const satchelFlap = mesh(new THREE.BoxGeometry(0.31, 0.11, 0.145), PAL.jacketDark, meshes);
    satchelFlap.position.y = 0.08;
    satchel.add(satchelFlap);
    torso.add(satchel);

    // Strap across the chest. Kept short and tight to the shell — run long it
    // swings out past the silhouette and reads as a plank, not a strap.
    const strap = mesh(new THREE.BoxGeometry(0.048, 0.34, 0.018), PAL.leather, meshes);
    strap.position.set(-0.035, P.torsoLen * 0.52, 0.146);
    strap.rotation.z = 0.42;
    torso.add(strap);
  } else {
    torso.add(satchel);
  }

  // Belt vials — three little glowing bottles on the hip, straight off Aria's
  // sheet. Small, but they catch the bloom and read at a distance.
  if (SPEC.vials) {
    for (let i = 0; i < 3; i++) {
      const vial = mesh(
        new THREE.CylinderGeometry(0.019, 0.019, 0.075, 6),
        PAL.glow,
        meshes,
        { emissive: PAL.glow, emissiveIntensity: 0.8 },
      );
      vial.position.set(-0.13 - i * 0.035, 0.03, 0.10 - i * 0.02);
      vial.rotation.z = 0.25;
      torso.add(vial);
    }
  }

  // ── head ────────────────────────────────────────────────────────────────
  const head = new THREE.Group();
  head.name = 'ren_head';
  head.position.y = HEAD_Y;
  torso.add(head);

  const neck = mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.08, 8), PAL.skin, meshes);
  neck.position.y = -0.07;
  head.add(neck);

  const skull = mesh(new THREE.SphereGeometry(P.headR, 16, 14), PAL.skin, meshes);
  skull.scale.set(1, 1.12, 1.02);
  head.add(skull);

  // A jaw mass below the cranium. The sheet's Ren has a defined chin; a single
  // sphere gives a doll head, which is most of what made him read as a helmet.
  const jaw = mesh(new THREE.SphereGeometry(P.headR * 0.74, 12, 10), PAL.skin, meshes);
  jaw.scale.set(0.94, 0.86, 1.0);
  jaw.position.set(0, -0.062, 0.016);
  head.add(jaw);

  for (const side of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.024, 8, 6), PAL.skin, meshes);
    ear.scale.set(0.5, 1.15, 0.85);
    ear.position.set(side * (P.headR * 0.99), -0.004, -0.004);
    head.add(ear);
  }

  // ── face ────────────────────────────────────────────────────────────────
  // Eyes sit *behind* the lenses rather than being replaced by them: on the
  // sheet you can see through the green tint, and that is the difference
  // between a person in glasses and a visor with two lamps in it.
  const FACE_Z = P.headR * 0.9;

  // Every feature below is expressed as a fraction of head radius.
  //
  // They used to be absolute metres tuned against Ren's 0.113 m head. On a
  // smaller head those same numbers put an oversized mouth barely under the
  // nose, and it read unmistakably as a moustache. Face features have to scale
  // with the skull or they land on the wrong part of it.
  const F = P.headR / 0.113;

  for (const side of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.0145 * F, 8, 6), PAL.ink, meshes);
    eye.scale.set(1.3, 1.05, 0.6);
    eye.position.set(side * 0.042 * F, 0.014 * F, FACE_Z * 0.99);
    head.add(eye);

    const brow = mesh(
      new THREE.BoxGeometry(0.038 * F, 0.008 * F, 0.014 * F),
      PAL.hair,
      meshes,
    );
    brow.position.set(side * 0.044 * F, 0.048 * F, FACE_Z * 0.97);
    brow.rotation.z = side * -0.14;
    head.add(brow);
  }

  const nose = mesh(
    new THREE.BoxGeometry(0.017 * F, 0.024 * F, 0.021 * F),
    PAL.skin,
    meshes,
  );
  nose.position.set(0, -0.018 * F, FACE_Z * 1.02);
  head.add(nose);

  // Small, set well below the nose, and softened away from pure ink — a hard
  // dark bar directly under the nose is the moustache read, whatever its size.
  const mouth = mesh(
    new THREE.BoxGeometry(0.019 * F, 0.005 * F, 0.010 * F),
    '#7d4a44',
    meshes,
  );
  mouth.position.set(0, -0.070 * F, FACE_Z * 0.95);
  head.add(mouth);

  // ── glasses ─────────────────────────────────────────────────────────────
  // Round frames with a real rim, a tinted lens and temple arms reaching the
  // ears. Pushed too bright the two lenses bleed together and read as one solid
  // visor bar, which is a different character entirely — so the emissive stays
  // low, the lens is translucent, and a dark rim holds the two shapes apart.
  const LENS_X = 0.047;
  const LENS_R = 0.034;
  const lenses: THREE.Mesh[] = [];

  for (const side of [-1, 1]) {
    const rim = mesh(new THREE.TorusGeometry(LENS_R, 0.0075, 6, 16), PAL.ink, meshes);
    rim.position.set(side * LENS_X, 0.012, FACE_Z + 0.014);
    head.add(rim);

    const lens = mesh(
      new THREE.CylinderGeometry(LENS_R * 0.94, LENS_R * 0.94, 0.005, 14),
      PAL.accent,
      meshes,
      {
        // Ren's lenses are a tech read and glow; Aria's are ordinary glass and
        // only catch a highlight. One number, from the spec.
        emissive: PAL.glow,
        emissiveIntensity: 0.4 * SPEC.lensGlow,
        transparent: true,
        opacity: 0.3 + 0.25 * SPEC.lensGlow,
      },
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(side * LENS_X, 0.012, FACE_Z + 0.013);
    // The tint sits over the eye, so it must not also occlude it in the depth
    // buffer from a grazing angle.
    lens.castShadow = false;
    head.add(lens);
    lenses.push(lens);

    // Temple arm, angled back to the ear.
    const temple = mesh(new THREE.BoxGeometry(0.008, 0.008, 0.085), PAL.ink, meshes);
    temple.position.set(side * (LENS_X + LENS_R * 0.82), 0.014, FACE_Z - 0.045);
    temple.rotation.y = side * 0.28;
    head.add(temple);
  }

  const bridge = mesh(new THREE.BoxGeometry(0.028, 0.007, 0.008), PAL.ink, meshes);
  bridge.position.set(0, 0.014, FACE_Z + 0.013);
  head.add(bridge);

  // ── hair ────────────────────────────────────────────────────────────────
  if (SPEC.hair === 'long') {
    buildLongHair(head, torso, meshes, FACE_Z);
  } else {
    buildSweptHair(head, meshes, FACE_Z);
  }

  // ── arms ────────────────────────────────────────────────────────────────
  const makeArm = (side: number) => {
    const upper = new THREE.Group();
    upper.name = side < 0 ? 'ren_armL' : 'ren_armR';
    upper.position.set(side * P.shoulderX, P.torsoLen - 0.07, 0);
    torso.add(upper);

    const shoulder = mesh(new THREE.SphereGeometry(0.075, 10, 8), PAL.jacket, meshes);
    upper.add(shoulder);

    const upperMesh = mesh(
      new THREE.CapsuleGeometry(0.058, P.upperArm - 0.11, 4, 8),
      PAL.jacket,
      meshes,
    );
    upperMesh.position.y = -P.upperArm / 2;
    upper.add(upperMesh);

    const fore = new THREE.Group();
    fore.name = side < 0 ? 'ren_forearmL' : 'ren_forearmR';
    fore.position.y = -P.upperArm;
    upper.add(fore);

    const foreMesh = mesh(
      new THREE.CapsuleGeometry(0.048, P.foreArm - 0.10, 4, 8),
      PAL.jacketDark,
      meshes,
    );
    foreMesh.position.y = -P.foreArm / 2;
    fore.add(foreMesh);

    // Fingerless gloves, as on the sheet: a dark cuff, a dark palm, and bare
    // fingers. Three primitives, but it stops the hand reading as a block.
    const cuff = mesh(new THREE.BoxGeometry(0.062, 0.045, 0.062), PAL.jacketDark, meshes);
    cuff.position.y = -P.foreArm - 0.005;
    fore.add(cuff);

    // Teal band on the glove cuff — the accent nearest the camera in most
    // gameplay framings, since the arms swing through frame as she walks.
    const cuffTrim = mesh(new THREE.BoxGeometry(0.066, 0.011, 0.066), PAL.accent, meshes, {
      emissive: PAL.accent,
      emissiveIntensity: 0.55,
    });
    cuffTrim.position.y = -P.foreArm + 0.021;
    fore.add(cuffTrim);

    // Sleeve stripe running down the outside of the forearm.
    const sleeve = mesh(new THREE.BoxGeometry(0.012, P.foreArm * 0.6, 0.014), PAL.accent, meshes, {
      emissive: PAL.accent,
      emissiveIntensity: 0.45,
    });
    sleeve.position.set(side * 0.032, -P.foreArm * 0.45, 0.026);
    fore.add(sleeve);

    const palm = mesh(new THREE.BoxGeometry(0.058, 0.070, 0.052), PAL.boots, meshes);
    palm.position.y = -P.foreArm - 0.055;
    fore.add(palm);

    const fingers = mesh(new THREE.BoxGeometry(0.054, 0.045, 0.046), PAL.skin, meshes);
    fingers.position.y = -P.foreArm - 0.108;
    fore.add(fingers);

    const thumb = mesh(new THREE.BoxGeometry(0.022, 0.040, 0.026), PAL.skin, meshes);
    thumb.position.set(side * 0.036, -P.foreArm - 0.070, 0.008);
    fore.add(thumb);

    // Elbow pad breaks the straight tube of the forearm.
    const elbowPad = mesh(new THREE.BoxGeometry(0.072, 0.075, 0.072), PAL.jacketDark, meshes);
    elbowPad.position.y = -0.018;
    fore.add(elbowPad);

    return { upper, fore, hand: palm };
  };

  const left = makeArm(-1);
  const right = makeArm(1);

  const handSocket = new THREE.Object3D();
  handSocket.name = 'socket_hand_R';
  handSocket.position.set(0, -P.foreArm - 0.10, 0.02);
  right.fore.add(handSocket);

  // ── legs ────────────────────────────────────────────────────────────────
  const makeLeg = (side: number) => {
    const thigh = new THREE.Group();
    thigh.name = side < 0 ? 'ren_legL' : 'ren_legR';
    thigh.position.set(side * P.hipX, -HIP_DROP, 0);
    hips.add(thigh);

    const thighMesh = mesh(
      new THREE.CapsuleGeometry(0.075, P.thigh - 0.15, 4, 8),
      PAL.pants,
      meshes,
    );
    thighMesh.position.y = -P.thigh / 2;
    thigh.add(thighMesh);

    // Cargo pocket, as on the sheet.
    const cargo = mesh(new THREE.BoxGeometry(0.10, 0.13, 0.10), PAL.jacketDark, meshes);
    cargo.position.set(side * 0.06, -P.thigh * 0.55, 0.01);
    thigh.add(cargo);

    const shin = new THREE.Group();
    shin.name = side < 0 ? 'ren_shinL' : 'ren_shinR';
    shin.position.y = -P.thigh;
    thigh.add(shin);

    const shinMesh = mesh(
      new THREE.CapsuleGeometry(0.062, P.shin - 0.16, 4, 8),
      PAL.pants,
      meshes,
    );
    shinMesh.position.y = -P.shin / 2;
    shin.add(shinMesh);

    // Knee pad — a hard edge at the joint, so the leg reads as two segments
    // rather than one bent tube when the gait is at full swing.
    const knee = mesh(new THREE.BoxGeometry(0.085, 0.085, 0.088), PAL.jacketDark, meshes);
    knee.position.set(0, -0.012, 0.012);
    shin.add(knee);

    // Teal chevron on the knee pad. The accent is this character's whole
    // identity on the sheet, and confined to the chest it simply does not read
    // at gameplay distance — it needs to appear down the whole silhouette.
    const kneeTrim = mesh(new THREE.BoxGeometry(0.05, 0.012, 0.014), PAL.accent, meshes, {
      emissive: PAL.accent,
      emissiveIntensity: 0.55,
    });
    kneeTrim.position.set(0, -0.006, 0.058);
    shin.add(kneeTrim);

    // The boot hangs from the ankle by exactly `footDrop`, so the sole's
    // underside is the lowest point of the whole rig and sits at y=0.
    const soleH = 0.04;
    const bootH = P.footDrop - soleH;

    const boot = mesh(new THREE.BoxGeometry(0.125, bootH, P.footLen), PAL.boots, meshes);
    boot.position.set(0, -P.shin - bootH / 2, 0.03);
    shin.add(boot);

    // The sole was `metal` — a light grey that read as a white-soled trainer and
    // dragged the eye straight to his feet. On the sheet the boot is one dark
    // mass with the sole only just separable from it.
    const sole = mesh(new THREE.BoxGeometry(0.132, soleH, P.footLen), PAL.jacketDark, meshes);
    sole.position.set(0, -P.shin - bootH - soleH / 2, 0.03);
    shin.add(sole);

    // Teal flash across the boot toe, as drawn.
    const bootTrim = mesh(new THREE.BoxGeometry(0.10, 0.014, 0.02), PAL.accent, meshes, {
      emissive: PAL.accent,
      emissiveIntensity: 0.5,
    });
    bootTrim.position.set(0, -P.shin - bootH * 0.35, 0.03 + P.footLen / 2 - 0.012);
    shin.add(bootTrim);

    return { thigh, shin };
  };

  const legLeft = makeLeg(-1);
  const legRight = makeLeg(1);

  return {
    root,
    hips,
    torso,
    head,
    armL: left.upper,
    armR: right.upper,
    forearmL: left.fore,
    forearmR: right.fore,
    legL: legLeft.thigh,
    legR: legRight.thigh,
    shinL: legLeft.shin,
    shinR: legRight.shin,
    handSocket,
    satchel,
    lenses,
    meshes,
  };
}

/** Back-compatible alias; prefer {@link buildCourier}. */
export const buildRen = (): RenRig => buildCourier(REN_SPEC);

/** Overall height for a spec, without building the geometry. */
export const courierHeight = (spec: CharacterSpec): number => spec.height;

/**
 * Hip height for a spec, derived from the leg chain so the soles rest on y=0.
 *
 * Exposed as a function rather than a constant because it depends on the spec —
 * as a constant it silently kept Ren's value for every other character, which
 * put shorter ones underground.
 */
export const courierHipY = (spec: CharacterSpec): number =>
  buildProportions(spec.proportions).hipY;

export const REN_HEIGHT = REN_SPEC.height;
export const REN_HIP_Y = courierHipY(REN_SPEC);
