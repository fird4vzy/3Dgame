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
 * Palette from the sheet's colour chart, lifted for gameplay.
 *
 * The concept art is very dark — great on a white sheet, unreadable against a
 * dusk sky where the character becomes one flat silhouette. These are the same
 * hues raised in value, which keeps the design's identity while letting the
 * form read at distance. The relationships between the swatches are preserved;
 * only the overall level moved.
 */
export const REN_PALETTE = {
  skin: '#e8bd97',
  hair: '#43332c',
  jacket: '#5c6d64',
  jacketDark: '#45514c',
  accent: '#5fd6a8',
  glow: '#7dffc0',
  shirt: '#33393a',
  pants: '#525d5b',
  boots: '#33393b',
  metal: '#8d949a',
  leather: '#7a6046',
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
  shoulderX: 0.19,
  upperArm: 0.28,
  foreArm: 0.25,
  hipX: 0.095,
  thigh: 0.40,
  shin: 0.38,
  footLen: 0.25,
  /** Ankle-to-sole, so the boot geometry can be placed from one number. */
  footDrop: FOOT_DROP,
  hipY: HIP_DROP + 0.40 + 0.38 + FOOT_DROP,
};

function mesh(
  geometry: THREE.BufferGeometry,
  colour: string,
  collect: THREE.Mesh[],
  options: { emissive?: string; emissiveIntensity?: number } = {},
): THREE.Mesh {
  const material = createToonMaterial({
    color: colour,
    bands: 3,
    ...(options.emissive ? { emissive: options.emissive } : {}),
    ...(options.emissiveIntensity !== undefined
      ? { emissiveIntensity: options.emissiveIntensity }
      : {}),
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
  const jacket = mesh(new THREE.BoxGeometry(0.43, P.torsoLen * 0.82, 0.29), REN_PALETTE.jacket, meshes);
  jacket.position.y = P.torsoLen / 2 - 0.06;
  torso.add(jacket);

  const collar = mesh(new THREE.BoxGeometry(0.30, 0.10, 0.26), REN_PALETTE.jacketDark, meshes);
  collar.position.y = P.torsoLen - 0.04;
  torso.add(collar);

  // Circuit accent down the chest.
  const accent = mesh(
    new THREE.BoxGeometry(0.045, P.torsoLen * 0.5, 0.01),
    REN_PALETTE.accent,
    meshes,
    { emissive: REN_PALETTE.accent, emissiveIntensity: 0.55 },
  );
  accent.position.set(0.10, P.torsoLen * 0.48, 0.152);
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

  const strap = mesh(new THREE.BoxGeometry(0.07, 0.44, 0.02), REN_PALETTE.leather, meshes);
  strap.position.set(-0.06, P.torsoLen * 0.5, 0.145);
  strap.rotation.z = 0.32;
  torso.add(strap);

  // ── head ────────────────────────────────────────────────────────────────
  const head = new THREE.Group();
  head.name = 'ren_head';
  head.position.y = P.neckY + 0.06;
  torso.add(head);

  const neck = mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.08, 8), REN_PALETTE.skin, meshes);
  neck.position.y = -0.07;
  head.add(neck);

  const skull = mesh(new THREE.SphereGeometry(P.headR, 14, 12), REN_PALETTE.skin, meshes);
  skull.scale.set(1, 1.12, 1.02);
  head.add(skull);

  // Hair as an offset cluster — reads as the sheet's swept, messy shape without
  // needing alpha cards.
  const hairMain = mesh(new THREE.SphereGeometry(P.headR * 1.06, 12, 10), REN_PALETTE.hair, meshes);
  hairMain.scale.set(1.04, 0.92, 1.04);
  hairMain.position.set(0, 0.035, -0.008);
  head.add(hairMain);

  for (const [x, y, z, s] of [
    [-0.07, 0.08, 0.03, 0.55],
    [0.06, 0.09, 0.01, 0.6],
    [0.0, 0.10, -0.06, 0.62],
    [-0.03, 0.12, 0.05, 0.45],
  ] as const) {
    const tuft = mesh(new THREE.SphereGeometry(P.headR * s, 8, 6), REN_PALETTE.hair, meshes);
    tuft.position.set(x, y, z);
    head.add(tuft);
  }

  // Glasses: Ren's signature, and the easiest thing to get wrong. Pushed too
  // bright the two lenses bleed into one another and read as a solid visor
  // bar, which is a different character entirely. Keep the emissive modest,
  // hold a real gap between them, and let a dark frame separate the shapes.
  const lenses: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const rim = mesh(new THREE.BoxGeometry(0.058, 0.040, 0.010), REN_PALETTE.hair, meshes);
    rim.position.set(side * 0.052, 0.012, P.headR * 0.92);
    head.add(rim);

    const lens = mesh(new THREE.BoxGeometry(0.046, 0.028, 0.011), REN_PALETTE.glow, meshes, {
      emissive: REN_PALETTE.glow,
      emissiveIntensity: 0.85,
    });
    lens.position.set(side * 0.052, 0.012, P.headR * 0.95);
    head.add(lens);
    lenses.push(lens);
  }
  const bridge = mesh(new THREE.BoxGeometry(0.022, 0.007, 0.009), REN_PALETTE.hair, meshes);
  bridge.position.set(0, 0.012, P.headR * 0.94);
  head.add(bridge);

  // Brow line, so the face has structure above the lenses.
  const brow = mesh(new THREE.BoxGeometry(0.14, 0.016, 0.02), REN_PALETTE.hair, meshes);
  brow.position.set(0, 0.042, P.headR * 0.88);
  head.add(brow);

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

    const hand = mesh(new THREE.BoxGeometry(0.075, 0.10, 0.055), REN_PALETTE.skin, meshes);
    hand.position.y = -P.foreArm - 0.04;
    fore.add(hand);

    return { upper, fore, hand };
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

    // The boot hangs from the ankle by exactly `footDrop`, so the sole's
    // underside is the lowest point of the whole rig and sits at y=0.
    const soleH = 0.04;
    const bootH = P.footDrop - soleH;

    const boot = mesh(new THREE.BoxGeometry(0.135, bootH, P.footLen), REN_PALETTE.boots, meshes);
    boot.position.set(0, -P.shin - bootH / 2, 0.035);
    shin.add(boot);

    const sole = mesh(new THREE.BoxGeometry(0.145, soleH, P.footLen + 0.01), REN_PALETTE.metal, meshes);
    sole.position.set(0, -P.shin - bootH - soleH / 2, 0.04);
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
