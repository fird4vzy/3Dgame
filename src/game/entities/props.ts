import * as THREE from 'three';
import { PLAYER_HEIGHT } from '@config/constants';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createWorldMaterial } from '@engine/render/WorldMaterial';

/**
 * Procedural stand-in props.
 *
 * Deliberately simple geometry with strong silhouettes: the point of Phase 3 is
 * to make the loop playable and judgeable, and a lamp only has to read as a
 * lamp. All of these are replaced by authored art in Phase 4, and each is a
 * single mesh so they instance cleanly when that happens.
 */

/**
 * A street lantern: a paper andon on a wooden post. Its paper's emissive is
 * driven by the district's light level.
 *
 * It was a glowing ball on a pole — a placeholder that read as a park lamp in
 * a Japanese village, and under real light as exactly what it was. The paper
 * box is the "bulb" the illumination system talks to; by day it is simply
 * paper, which is what makes it worth lighting.
 */
export function createLamp(): { group: THREE.Group; light: THREE.PointLight; bulb: THREE.Mesh } {
  const group = new THREE.Group();
  group.name = 'lamp';

  // Post, lantern frame, cap and roof in one dark-wood mesh: one draw.
  const parts: THREE.BufferGeometry[] = [];
  const post = new THREE.BoxGeometry(0.11, 2.3, 0.11);
  post.translate(0, 1.15, 0);
  parts.push(post);
  const base = new THREE.BoxGeometry(0.36, 0.04, 0.36);
  base.translate(0, 2.31, 0);
  parts.push(base);
  for (const [x, z] of [
    [-0.15, -0.15],
    [0.15, -0.15],
    [-0.15, 0.15],
    [0.15, 0.15],
  ] as const) {
    const corner = new THREE.BoxGeometry(0.035, 0.42, 0.035);
    corner.translate(x, 2.53, z);
    parts.push(corner);
  }
  const roof = new THREE.ConeGeometry(0.31, 0.2, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 2.84, 0);
  parts.push(roof);
  const frame = new THREE.Mesh(
    mergeGeometries(parts.map((g) => g.toNonIndexed()))!,
    createWorldMaterial({ color: '#4a3526', roughness: 0.9 }),
  );
  for (const part of parts) part.dispose();
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  const bulbMaterial = createWorldMaterial({
    color: '#e6dcc4',
    emissive: '#e8a33a',
    emissiveIntensity: 0,
    roughness: 0.92,
  });
  const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.38, 0.27), bulbMaterial);
  bulb.position.y = 2.53;
  group.add(bulb);

  // Range 0 keeps the light effectively off until ignition ramps it up.
  //
  // The 12 m range cut the pool off well before the physical falloff had, so
  // adjacent lamps left dark gaps between them along a street.
  //
  // Decay 1.4 rather than the physical 2. Strict inverse-square across the 2–8 m
  // a player actually walks past a lamp is a 16:1 swing — bright enough to blow
  // a wall out at arm's length and still too dim to read from across the plaza.
  // Softening it trades physical accuracy for a lamp that works at every
  // distance, which is the correct trade for a cel-shaded game.
  const light = new THREE.PointLight(0xe8a33a, 0, 18, 1.4);
  light.position.y = 2.53;
  group.add(light);

  return { group, light, bulb };
}

/** A carried lumen. Bobs and glows; its colour encodes warmth. */
export function createParcel(colour: string): { group: THREE.Group; glow: THREE.PointLight; core: THREE.Mesh } {
  const group = new THREE.Group();
  group.name = 'parcel';

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.13, 1),
    // Emissive was 1.8, which is well past the bloom threshold at point-blank
    // range: carried at chest height it flared into a white disc that erased
    // the courier behind it. The parcel should read as a lantern she is
    // holding, not as a light source pointed at the camera.
    createWorldMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.75 }),
  );
  group.add(core);

  const cage = new THREE.Mesh(
    new THREE.TorusGeometry(0.23, 0.02, 6, 14),
    createWorldMaterial({ color: '#6b5a3a' }),
  );
  cage.rotation.x = Math.PI / 2;
  group.add(cage);

  // Short range and low intensity: it is lighting her hand and the ground by
  // her feet, not the whole district.
  const glow = new THREE.PointLight(new THREE.Color(colour), 1.6, 4.5, 2);
  group.add(glow);

  return { group, glow, core };
}

/** A collectible lumen shard. */
export function createShard(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.OctahedronGeometry(0.19, 0),
    createWorldMaterial({ color: '#f6bd60', emissive: '#e8a33a', emissiveIntensity: 1.4 }),
  );
}

/**
 * A stand-in villager.
 *
 * Same proportions as the player capsule so interaction radii, camera framing
 * and eyeline all read correctly before real NPC art exists.
 */
export function createVillager(colour: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'villager';

  const bodyMaterial = createWorldMaterial({ color: colour });

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, PLAYER_HEIGHT - 0.9, 5, 10),
    bodyMaterial,
  );
  body.position.y = PLAYER_HEIGHT / 2 - 0.05;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), bodyMaterial);
  head.position.y = PLAYER_HEIGHT - 0.05;
  head.castShadow = true;
  group.add(head);

  // Facing cue, matching the placeholder player.
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.06, 0.15, 6),
    createWorldMaterial({ color: '#c8582f' }),
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, PLAYER_HEIGHT - 0.05, 0.24);
  group.add(nose);

  return group;
}

/** Floating ring that marks an interactable before the prompt appears. */
export function createInteractionRing(): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.035, 6, 24),
    new THREE.MeshBasicMaterial({
      color: '#e8a33a',
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  return ring;
}
