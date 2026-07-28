import * as THREE from 'three';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from '@config/constants';

/**
 * The stand-in courier: a capsule with a satchel, a scarf and a nose.
 *
 * This exists so every system — controller, camera, animation, collision — can
 * be built and judged before the real character art arrives. The nose and scarf
 * are not decoration: without a clear facing cue you cannot tell whether the
 * orientation code is working.
 *
 * Replacing it is a manifest edit, not an integration project. See
 * docs/06-asset-specification.md §6.2 for the character contract.
 */
export function createPlaceholderCharacter(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'char_placeholder';

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#e8e2d4'),
    roughness: 0.75,
    metalness: 0,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#c8582f'),
    roughness: 0.6,
    metalness: 0,
  });
  const satchelMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7a5a3a'),
    roughness: 0.85,
    metalness: 0,
  });

  // Body — a capsule whose feet sit exactly at the entity origin, matching the
  // collision capsule and the character contract's "feet at origin" rule.
  const bodyHeight = PLAYER_HEIGHT - PLAYER_RADIUS * 2;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_RADIUS, bodyHeight, 6, 12),
    bodyMaterial,
  );
  body.position.y = PLAYER_HEIGHT / 2;
  body.castShadow = true;
  group.add(body);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), bodyMaterial);
  head.position.y = PLAYER_HEIGHT + 0.12;
  head.castShadow = true;
  group.add(head);

  // Nose — the facing cue. +Z is forward, per the asset spec.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 8), accentMaterial);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, PLAYER_HEIGHT + 0.12, 0.26);
  group.add(nose);

  // Scarf
  const scarf = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.06, 8, 16),
    accentMaterial,
  );
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = PLAYER_HEIGHT - 0.14;
  group.add(scarf);

  // Satchel, worn on the left hip — this is where the `back` socket will live.
  const satchel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.16), satchelMaterial);
  satchel.position.set(-0.3, PLAYER_HEIGHT * 0.52, -0.06);
  satchel.rotation.z = 0.15;
  satchel.castShadow = true;
  satchel.name = 'socket_back';
  group.add(satchel);

  // A carried lumen — stands in for the parcel and gives the scene a light source.
  const lumen = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.11, 1),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#f6bd60'),
      emissive: new THREE.Color('#e8a33a'),
      emissiveIntensity: 1.6,
      roughness: 0.4,
    }),
  );
  lumen.position.set(0.3, PLAYER_HEIGHT * 0.56, 0.12);
  lumen.name = 'socket_hand_R';
  group.add(lumen);

  const glow = new THREE.PointLight(0xe8a33a, 6, 9, 2);
  glow.position.copy(lumen.position);
  group.add(glow);

  return group;
}
