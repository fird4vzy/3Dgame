import * as THREE from 'three';
import { PLAYER_HEIGHT } from '@config/constants';
import { createToonMaterial } from '@engine/render/ToonMaterial';

/**
 * Procedural stand-in props.
 *
 * Deliberately simple geometry with strong silhouettes: the point of Phase 3 is
 * to make the loop playable and judgeable, and a lamp only has to read as a
 * lamp. All of these are replaced by authored art in Phase 4, and each is a
 * single mesh so they instance cleanly when that happens.
 */

/** A street lamp. Its emissive is driven by the district's light level. */
export function createLamp(): { group: THREE.Group; light: THREE.PointLight; bulb: THREE.Mesh } {
  const group = new THREE.Group();
  group.name = 'lamp';

  const postMaterial = createToonMaterial({ color: '#2f3242' });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 2.6, 6), postMaterial);
  post.position.y = 1.3;
  post.castShadow = true;
  group.add(post);

  const bulbMaterial = createToonMaterial({
    color: '#3a3d52',
    emissive: '#e8a33a',
    emissiveIntensity: 0,
  });
  const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), bulbMaterial);
  bulb.position.y = 2.7;
  group.add(bulb);

  // Range 0 keeps the light effectively off until ignition ramps it up.
  const light = new THREE.PointLight(0xe8a33a, 0, 12, 2);
  light.position.y = 2.7;
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
    createToonMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.75 }),
  );
  group.add(core);

  const cage = new THREE.Mesh(
    new THREE.TorusGeometry(0.23, 0.02, 6, 14),
    createToonMaterial({ color: '#6b5a3a' }),
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
    createToonMaterial({ color: '#f6bd60', emissive: '#e8a33a', emissiveIntensity: 1.4 }),
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

  const bodyMaterial = createToonMaterial({ color: colour });

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
    createToonMaterial({ color: '#c8582f' }),
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
