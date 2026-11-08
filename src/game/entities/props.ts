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

/**
 * A carried lumen: a bottle of light on a short brass bail.
 *
 * It was an orb the size of a grapefruit inside a ring nearly half a metre
 * across, centred on her wrist, with a point light in the same spot. The
 * ring read as a frying pan, and a light a few centimetres from her forearm
 * blew the arm out to white — the glowing streak up her arm in every carry.
 *
 * Now the group's origin is the top of the bail, where a hand holds it, and
 * the orb hangs below. The light is a spot pointed at the ground: a warm
 * pool round her feet, which is what a lantern is for, and nothing aimed
 * back up the arm that carries it. Its colour encodes warmth.
 */
export function createParcel(colour: string): { group: THREE.Group; glow: THREE.SpotLight; core: THREE.Mesh } {
  const group = new THREE.Group();
  group.name = 'parcel';

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.068, 3),
    createWorldMaterial({ color: colour, emissive: colour, emissiveIntensity: 1.5, roughness: 0.25 }),
  );
  core.position.y = -0.16;
  group.add(core);

  const brass = createWorldMaterial({ color: '#8c6b3c', roughness: 0.45, metalness: 0.6 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.03, 12), brass);
  cap.position.y = -0.085;
  group.add(cap);
  // Half a loop, from the cap up to where the fingers close on it.
  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.0045, 6, 18, Math.PI), brass);
  bail.position.y = -0.07;
  group.add(bail);

  const glow = new THREE.SpotLight(new THREE.Color(colour), 3, 7, Math.PI * 0.36, 0.85, 2);
  glow.position.copy(core.position);
  glow.target.position.set(0, -2, 0.25);
  group.add(glow, glow.target);

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
