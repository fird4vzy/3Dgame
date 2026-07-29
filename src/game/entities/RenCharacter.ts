import * as THREE from 'three';
import { createToonMaterial } from '@engine/render/ToonMaterial';

/**
 * Ren 'Cypher' Kairo, built as a real 3D rig.
 *
 * The concept sheet is 2D, and a billboard of it was never going to be right in
 * a game where the camera orbits a sphere — the character has to have a back,
 * cast a shadow, and turn. So the sheet is read as a *specification* rather than
 * as art: proportions (180 cm), silhouette (layered jacket, cargo pants, heavy
 * boots, satchel), and the palette chart drive a low-poly humanoid assembled
 * from primitives.
 *
 * The rig is a plain `Object3D` hierarchy rather than a skinned mesh with bones.
 * For a low-poly character with rigid limb segments the visual result is the
 * same, it costs no skinning, and — the reason that actually matters — it can be
 * animated procedurally, so locomotion *cycles* without a single authored
 * keyframe. That was the gap the sprite could never close.
 *
 * Every part is exposed on {@link RenRig} so the animator can pose it.
 */

/**
 * Swatches read straight off the concept sheet.
 *
 * Ren's identity is *near-black charcoal-green with teal accents*. An earlier
 * pass raised every value for legibility and lost exactly that — he came out a
 * mid sage grey and stopped looking like the drawing. These are the art values;
 * the single knob below is the only place the game is allowed to deviate.
 */
const SHEET = {
  skin: '#d9a882',
  hair: '#241d19',
  /** Sheet hair is two-tone: a near-black mass with warmer swept highlights. */
  hairLift: '#3b2d25',
  jacket: '#2b3430',
  jacketDark: '#1d2422',
  accent: '#3f9e73',
  glow: '#7dffc0',
  shirt: '#151918',
  pants: '#2a3230',
  boots: '#161a19',
  metal: '#6a7176',
  leather: '#4c3b2b',
} as const;

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

/** The sheet's palette at the gameplay lift. */
export const REN_PALETTE = {
  skin: lift(SHEET.skin),
  hair: lift(SHEET.hair),
  hairLift: lift(SHEET.hairLift),
  jacket: lift(SHEET.jacket),
  jacketDark: lift(SHEET.jacketDark),
  // The accents are the design's one bright note; lifting them just washes
  // them out, so they stay as drawn.
  accent: SHEET.accent,
  glow: SHEET.glow,
  shirt: lift(SHEET.shirt),
  pants: lift(SHEET.pants),
  boots: lift(SHEET.boots),
  metal: lift(SHEET.metal),
  leather: lift(SHEET.leather),
  /** Eyes and mouth — darker than the hair so the face still reads at 2 m. */
  ink: '#171312',
} as const;

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

const HEIGHT = 1.8;

/**
 * Proportions in metres, for the sheet's 180 cm figure.
 *
 * `hipY` is *derived* from the leg chain rather than written down, so the feet
 * land exactly on y=0 by construction. Hard-coding it is how the rig ended up
 * standing 16 cm below the ground the first time — every proportion tweak
 * silently moved the soles.
 */
const HIP_DROP = 0.08;
const FOOT_DROP = 0.145;

const P = {
  torsoLen: 0.52,
  neckY: 0.52,
  headR: 0.113,
  // The sheet's figure is lean. Wide shoulders on a short torso were reading
  // as heavy-set, which is not this character.
  shoulderX: 0.175,
  upperArm: 0.31,
  foreArm: 0.29,
  hipX: 0.095,
  thigh: 0.40,
  shin: 0.38,
  footLen: 0.25,
  /** Ankle-to-sole, so the boot geometry can be placed from one number. */
  footDrop: FOOT_DROP,
  hipY: HIP_DROP + 0.40 + 0.38 + FOOT_DROP,
};

/** Head origin in torso space. */
const HEAD_Y = P.neckY + 0.10;

/**
 * Lowest point of the jaw, in head space.
 *
 * Kept as a named constant because the collar is positioned *from* it. Sizing
 * the collar independently is how the first pass ended up hiding the jaw, mouth
 * and nose behind a grey box — the face was there, just buried.
 */
const CHIN_Y = -0.134;

/** Top of the standing collar: clears the chin with a visible gap. */
const COLLAR_TOP_Y = HEAD_Y + CHIN_Y - 0.022;

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

/** Build the character. Feet sit at the origin, facing +Z, per the asset spec. */
export function buildRen(): RenRig {
  const meshes: THREE.Mesh[] = [];

  const root = new THREE.Group();
  root.name = 'ren_root';

  // ── hips ────────────────────────────────────────────────────────────────
  const hips = new THREE.Group();
  hips.name = 'ren_hips';
  hips.position.y = P.hipY;
  root.add(hips);

  const pelvis = mesh(new THREE.BoxGeometry(0.32, 0.20, 0.21), REN_PALETTE.pants, meshes);
  pelvis.position.y = -0.04;
  hips.add(pelvis);

  // Utility belt — a strong horizontal read at the waist, as on the sheet.
  const belt = mesh(new THREE.BoxGeometry(0.34, 0.07, 0.23), REN_PALETTE.leather, meshes);
  belt.position.y = 0.07;
  hips.add(belt);

  const pouch = mesh(new THREE.BoxGeometry(0.10, 0.13, 0.08), REN_PALETTE.jacketDark, meshes);
  pouch.position.set(0.17, 0.0, 0.02);
  hips.add(pouch);

  // ── torso ───────────────────────────────────────────────────────────────
  const torso = new THREE.Group();
  torso.name = 'ren_torso';
  torso.position.y = 0.09;
  hips.add(torso);

  const chest = mesh(new THREE.BoxGeometry(0.38, P.torsoLen, 0.24), REN_PALETTE.shirt, meshes);
  chest.position.y = P.torsoLen / 2 - 0.02;
  torso.add(chest);

  // The jacket is a second, slightly larger shell — that layered silhouette is
  // the most recognisable thing about the design.
  const jacket = mesh(new THREE.BoxGeometry(0.41, P.torsoLen * 0.82, 0.28), REN_PALETTE.jacket, meshes);
  jacket.position.y = P.torsoLen / 2 - 0.06;
  torso.add(jacket);

  // Quilting. On the sheet the jacket is a padded puffer read almost entirely
  // through its horizontal seam lines — without them the shell is just a box,
  // and the box is what made him look like a mech instead of a courier.
  for (const y of [0.10, 0.22, 0.34]) {
    const quilt = mesh(new THREE.BoxGeometry(0.415, 0.030, 0.02), REN_PALETTE.jacketDark, meshes);
    quilt.position.set(0, y, 0.135);
    torso.add(quilt);
    const back = mesh(new THREE.BoxGeometry(0.415, 0.030, 0.02), REN_PALETTE.jacketDark, meshes);
    back.position.set(0, y, -0.135);
    torso.add(back);
  }

  // Open front: two lapels over the black tee, rather than a sealed slab.
  for (const side of [-1, 1]) {
    const lapel = mesh(
      new THREE.BoxGeometry(0.135, P.torsoLen * 0.78, 0.045),
      REN_PALETTE.jacket,
      meshes,
    );
    lapel.position.set(side * 0.135, P.torsoLen / 2 - 0.05, 0.125);
    lapel.rotation.z = side * 0.06;
    torso.add(lapel);
  }

  // Standing collar. Its top edge is the constraint that matters: pushed up to
  // where a "tall" collar wants to be, it swallowed the jaw, mouth and nose and
  // the face vanished into a grey box. It stops below the chin, deliberately.
  const collar = mesh(new THREE.BoxGeometry(0.27, 0.10, 0.245), REN_PALETTE.jacketDark, meshes);
  collar.position.y = COLLAR_TOP_Y - 0.05;
  torso.add(collar);

  // Green piping over the shoulders — the design's only saturated note, so it
  // does a lot of the identifying. It has to lie *on* the jacket shell; at any
  // z inside it, it is simply buried and never renders.
  for (const side of [-1, 1]) {
    const piping = mesh(new THREE.BoxGeometry(0.115, 0.014, 0.215), REN_PALETTE.accent, meshes, {
      emissive: REN_PALETTE.accent,
      emissiveIntensity: 0.3,
    });
    piping.position.set(side * 0.14, P.torsoLen / 2 - 0.06 + (P.torsoLen * 0.82) / 2, 0);
    torso.add(piping);
  }

  // Circuit accent down the chest.
  const accent = mesh(
    new THREE.BoxGeometry(0.028, P.torsoLen * 0.44, 0.012),
    REN_PALETTE.accent,
    meshes,
    { emissive: REN_PALETTE.accent, emissiveIntensity: 0.55 },
  );
  accent.position.set(0.058, P.torsoLen * 0.46, 0.152);
  torso.add(accent);

  // Satchel across the back — the courier read, and the glide wing's home.
  const satchel = new THREE.Group();
  satchel.position.set(0, P.torsoLen * 0.35, -0.19);
  const satchelBody = mesh(new THREE.BoxGeometry(0.30, 0.24, 0.13), REN_PALETTE.leather, meshes);
  satchel.add(satchelBody);
  const satchelFlap = mesh(new THREE.BoxGeometry(0.31, 0.11, 0.145), REN_PALETTE.jacketDark, meshes);
  satchelFlap.position.y = 0.08;
  satchel.add(satchelFlap);
  torso.add(satchel);

  // Satchel strap across the chest. Kept short and tight to the shell — run
  // long it swings out past the silhouette and reads as a plank, not a strap.
  const strap = mesh(new THREE.BoxGeometry(0.048, 0.34, 0.018), REN_PALETTE.leather, meshes);
  strap.position.set(-0.035, P.torsoLen * 0.52, 0.146);
  strap.rotation.z = 0.42;
  torso.add(strap);

  // ── head ────────────────────────────────────────────────────────────────
  const head = new THREE.Group();
  head.name = 'ren_head';
  head.position.y = HEAD_Y;
  torso.add(head);

  const neck = mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.08, 8), REN_PALETTE.skin, meshes);
  neck.position.y = -0.07;
  head.add(neck);

  const skull = mesh(new THREE.SphereGeometry(P.headR, 16, 14), REN_PALETTE.skin, meshes);
  skull.scale.set(1, 1.12, 1.02);
  head.add(skull);

  // A jaw mass below the cranium. The sheet's Ren has a defined chin; a single
  // sphere gives a doll head, which is most of what made him read as a helmet.
  const jaw = mesh(new THREE.SphereGeometry(P.headR * 0.74, 12, 10), REN_PALETTE.skin, meshes);
  jaw.scale.set(0.94, 0.86, 1.0);
  jaw.position.set(0, -0.062, 0.016);
  head.add(jaw);

  for (const side of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.024, 8, 6), REN_PALETTE.skin, meshes);
    ear.scale.set(0.5, 1.15, 0.85);
    ear.position.set(side * (P.headR * 0.99), -0.004, -0.004);
    head.add(ear);
  }

  // ── face ────────────────────────────────────────────────────────────────
  // Eyes sit *behind* the lenses rather than being replaced by them: on the
  // sheet you can see through the green tint, and that is the difference
  // between a person in glasses and a visor with two lamps in it.
  const FACE_Z = P.headR * 0.9;
  for (const side of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.0135, 8, 6), REN_PALETTE.ink, meshes);
    eye.scale.set(1.25, 1, 0.6);
    eye.position.set(side * 0.043, 0.011, FACE_Z * 0.99);
    head.add(eye);

    const brow = mesh(new THREE.BoxGeometry(0.040, 0.009, 0.014), REN_PALETTE.hair, meshes);
    brow.position.set(side * 0.045, 0.043, FACE_Z * 0.97);
    // Angled down toward the nose — the sheet's expression is wry, not blank.
    brow.rotation.z = side * -0.16;
    head.add(brow);
  }

  const nose = mesh(new THREE.BoxGeometry(0.020, 0.030, 0.024), REN_PALETTE.skin, meshes);
  nose.position.set(0, -0.020, FACE_Z * 1.02);
  head.add(nose);

  const mouth = mesh(new THREE.BoxGeometry(0.030, 0.007, 0.012), REN_PALETTE.ink, meshes);
  mouth.position.set(0, -0.052, FACE_Z * 0.95);
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
    const rim = mesh(new THREE.TorusGeometry(LENS_R, 0.0075, 6, 16), REN_PALETTE.ink, meshes);
    rim.position.set(side * LENS_X, 0.012, FACE_Z + 0.014);
    head.add(rim);

    const lens = mesh(
      new THREE.CylinderGeometry(LENS_R * 0.94, LENS_R * 0.94, 0.005, 14),
      REN_PALETTE.accent,
      meshes,
      { emissive: REN_PALETTE.glow, emissiveIntensity: 0.4, transparent: true, opacity: 0.55 },
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(side * LENS_X, 0.012, FACE_Z + 0.013);
    // The tint sits over the eye, so it must not also occlude it in the depth
    // buffer from a grazing angle.
    lens.castShadow = false;
    head.add(lens);
    lenses.push(lens);

    // Temple arm, angled back to the ear.
    const temple = mesh(new THREE.BoxGeometry(0.008, 0.008, 0.085), REN_PALETTE.ink, meshes);
    temple.position.set(side * (LENS_X + LENS_R * 0.82), 0.014, FACE_Z - 0.045);
    temple.rotation.y = side * 0.28;
    head.add(temple);
  }

  const bridge = mesh(new THREE.BoxGeometry(0.028, 0.007, 0.008), REN_PALETTE.ink, meshes);
  bridge.position.set(0, 0.014, FACE_Z + 0.013);
  head.add(bridge);

  // ── hair ────────────────────────────────────────────────────────────────
  // The sheet's hair is a big, messy, swept mass with real volume above the
  // skull — it is the loudest thing in his silhouette, and a tight cap loses
  // him. Built as a two-tone cluster: a near-black base with warmer highlight
  // lumps on top, which is what stops it reading as one flat blob.
  const hairMain = mesh(new THREE.SphereGeometry(P.headR * 1.14, 14, 12), REN_PALETTE.hair, meshes);
  hairMain.scale.set(1.06, 1.0, 1.06);
  hairMain.position.set(0, 0.048, -0.014);
  head.add(hairMain);

  // Weighted up and to one side so the shape reads as *swept*, not symmetric —
  // that asymmetry is most of what makes the sheet's hair recognisable at low
  // poly. `lift` marks the lumps that catch the highlight tone.
  for (const [x, y, z, r, sy, highlight] of [
    [-0.092, 0.086, 0.024, 0.62, 1.05, 0],
    [0.062, 0.112, 0.014, 0.66, 1.15, 1],
    [0.000, 0.126, -0.062, 0.70, 0.95, 0],
    [-0.046, 0.152, 0.050, 0.56, 1.25, 1],
    [0.084, 0.080, -0.052, 0.58, 1.05, 0],
    [-0.024, 0.172, -0.014, 0.50, 1.35, 1],
    [0.038, 0.158, 0.052, 0.46, 1.2, 1],
    [-0.078, 0.118, -0.044, 0.52, 1.1, 0],
    [0.096, 0.126, 0.018, 0.44, 1.15, 0],
    [-0.010, 0.096, 0.086, 0.48, 0.9, 0],
  ] as const) {
    const tuft = mesh(
      new THREE.SphereGeometry(P.headR * r, 8, 6),
      highlight ? REN_PALETTE.hairLift : REN_PALETTE.hair,
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
    const fringe = mesh(new THREE.BoxGeometry(w, 0.050, 0.050), REN_PALETTE.hair, meshes);
    fringe.position.set(x, 0.078, FACE_Z * 0.80);
    fringe.rotation.z = rot;
    head.add(fringe);
  }

  for (const side of [-1, 1]) {
    const sideburn = mesh(new THREE.BoxGeometry(0.018, 0.052, 0.040), REN_PALETTE.hair, meshes);
    sideburn.position.set(side * (P.headR * 0.93), 0.018, 0.014);
    head.add(sideburn);
  }

  // ── arms ────────────────────────────────────────────────────────────────
  const makeArm = (side: number) => {
    const upper = new THREE.Group();
    upper.name = side < 0 ? 'ren_armL' : 'ren_armR';
    upper.position.set(side * P.shoulderX, P.torsoLen - 0.07, 0);
    torso.add(upper);

    const shoulder = mesh(new THREE.SphereGeometry(0.075, 10, 8), REN_PALETTE.jacket, meshes);
    upper.add(shoulder);

    const upperMesh = mesh(
      new THREE.CapsuleGeometry(0.058, P.upperArm - 0.11, 4, 8),
      REN_PALETTE.jacket,
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
      REN_PALETTE.jacketDark,
      meshes,
    );
    foreMesh.position.y = -P.foreArm / 2;
    fore.add(foreMesh);

    // Fingerless gloves, as on the sheet: a dark cuff, a dark palm, and bare
    // fingers. Three primitives, but it stops the hand reading as a block.
    const cuff = mesh(new THREE.BoxGeometry(0.062, 0.045, 0.062), REN_PALETTE.jacketDark, meshes);
    cuff.position.y = -P.foreArm - 0.005;
    fore.add(cuff);

    const palm = mesh(new THREE.BoxGeometry(0.058, 0.070, 0.052), REN_PALETTE.boots, meshes);
    palm.position.y = -P.foreArm - 0.055;
    fore.add(palm);

    const fingers = mesh(new THREE.BoxGeometry(0.054, 0.045, 0.046), REN_PALETTE.skin, meshes);
    fingers.position.y = -P.foreArm - 0.108;
    fore.add(fingers);

    const thumb = mesh(new THREE.BoxGeometry(0.022, 0.040, 0.026), REN_PALETTE.skin, meshes);
    thumb.position.set(side * 0.036, -P.foreArm - 0.070, 0.008);
    fore.add(thumb);

    // Elbow pad breaks the straight tube of the forearm.
    const elbowPad = mesh(new THREE.BoxGeometry(0.072, 0.075, 0.072), REN_PALETTE.jacketDark, meshes);
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
      REN_PALETTE.pants,
      meshes,
    );
    thighMesh.position.y = -P.thigh / 2;
    thigh.add(thighMesh);

    // Cargo pocket, as on the sheet.
    const cargo = mesh(new THREE.BoxGeometry(0.10, 0.13, 0.10), REN_PALETTE.jacketDark, meshes);
    cargo.position.set(side * 0.06, -P.thigh * 0.55, 0.01);
    thigh.add(cargo);

    const shin = new THREE.Group();
    shin.name = side < 0 ? 'ren_shinL' : 'ren_shinR';
    shin.position.y = -P.thigh;
    thigh.add(shin);

    const shinMesh = mesh(
      new THREE.CapsuleGeometry(0.062, P.shin - 0.16, 4, 8),
      REN_PALETTE.pants,
      meshes,
    );
    shinMesh.position.y = -P.shin / 2;
    shin.add(shinMesh);

    // Knee pad — a hard edge at the joint, so the leg reads as two segments
    // rather than one bent tube when the gait is at full swing.
    const knee = mesh(new THREE.BoxGeometry(0.085, 0.085, 0.088), REN_PALETTE.jacketDark, meshes);
    knee.position.set(0, -0.012, 0.012);
    shin.add(knee);

    // The boot hangs from the ankle by exactly `footDrop`, so the sole's
    // underside is the lowest point of the whole rig and sits at y=0.
    const soleH = 0.04;
    const bootH = P.footDrop - soleH;

    const boot = mesh(new THREE.BoxGeometry(0.125, bootH, P.footLen), REN_PALETTE.boots, meshes);
    boot.position.set(0, -P.shin - bootH / 2, 0.03);
    shin.add(boot);

    // The sole was `metal` — a light grey that read as a white-soled trainer and
    // dragged the eye straight to his feet. On the sheet the boot is one dark
    // mass with the sole only just separable from it.
    const sole = mesh(new THREE.BoxGeometry(0.132, soleH, P.footLen), REN_PALETTE.jacketDark, meshes);
    sole.position.set(0, -P.shin - bootH - soleH / 2, 0.03);
    shin.add(sole);

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

export const REN_HEIGHT = HEIGHT;

/** Hip height, derived from the leg chain so the soles rest on y=0. */
export const REN_HIP_Y = P.hipY;
