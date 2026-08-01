import * as THREE from 'three';
import { createToonMaterial } from '@engine/render/ToonMaterial';
import { makeRng } from '@core/math/rng';
import type { DistrictId } from '../../data/content';

const _matrix = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _tanA = new THREE.Vector3();
const _tanB = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/** Orientation whose local +Y is the surface normal, with a random yaw. */
function plant(position: THREE.Vector3, yaw: number): THREE.Quaternion {
  _up.copy(position).normalize();
  _tanA.set(0, 1, 0).projectOnPlane(_up);
  if (_tanA.lengthSq() < 1e-6) _tanA.set(1, 0, 0).projectOnPlane(_up);
  _tanA.normalize().applyAxisAngle(_up, yaw);
  _tanB.copy(_up).cross(_tanA).normalize();
  return _quat.setFromRotationMatrix(_basis.makeBasis(_tanB, _up, _tanA));
}

function scatter(
  geometry: THREE.BufferGeometry,
  colour: string,
  positions: THREE.Vector3[],
  seed: number,
  scaleRange: [number, number],
  emissive?: string,
): THREE.InstancedMesh {
  const material = createToonMaterial(
    emissive
      ? { color: colour, emissive, emissiveIntensity: 0.35 }
      : { color: colour },
  );

  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, positions.length));
  mesh.count = positions.length;
  // Ground cover is small and everywhere; shadow-casting it would double the
  // shadow pass cost for detail nobody would notice.
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const rng = makeRng(seed);
  positions.forEach((position, index) => {
    const s = scaleRange[0] + rng() * (scaleRange[1] - scaleRange[0]);
    _scale.set(s, s, s);
    _matrix.compose(position, plant(position, rng() * Math.PI * 2), _scale);
    mesh.setMatrixAt(index, _matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/**
 * A single flower: a stem, a disc of petals, and a centre.
 *
 * Built as one merged-ish cluster of three primitives rather than a card with a
 * texture, because there is no texture pipeline in this project and a flat quad
 * would break the moment the camera orbited past it.
 */
function flowerGeometry(): { stem: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const stem = new THREE.CylinderGeometry(0.006, 0.008, 0.16, 4);
  stem.translate(0, 0.08, 0);

  // A low, wide cylinder reads as a flower head at this scale and costs eight
  // triangles; petal geometry would cost thirty and look identical at 2 m.
  const head = new THREE.CylinderGeometry(0.035, 0.028, 0.018, 6);
  head.translate(0, 0.17, 0);

  return { stem, head };
}

function grassGeometry(): THREE.BufferGeometry {
  const blade = new THREE.ConeGeometry(0.028, 0.19, 3);
  blade.translate(0, 0.095, 0);
  return blade;
}

function mushroomGeometry(): { stalk: THREE.BufferGeometry; cap: THREE.BufferGeometry } {
  const stalk = new THREE.CylinderGeometry(0.018, 0.022, 0.09, 5);
  stalk.translate(0, 0.045, 0);
  const cap = new THREE.SphereGeometry(0.055, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.7, 1);
  cap.translate(0, 0.09, 0);
  return { stalk, cap };
}

function pebbleGeometry(): THREE.BufferGeometry {
  const pebble = new THREE.DodecahedronGeometry(0.055, 0);
  pebble.scale(1, 0.55, 1);
  pebble.translate(0, 0.02, 0);
  return pebble;
}

/**
 * Per-district ground cover.
 *
 * The world had trees and lamps and nothing between them, so the ground read as
 * empty sand and grass however good the sky was. This is the layer that makes
 * somewhere feel *inhabited* at walking distance, and it is the cheapest kind
 * of detail there is: four instanced meshes per district, no shadows, no
 * textures, no per-frame cost at all.
 */
export function buildGroundCover(
  district: DistrictId,
  positions: THREE.Vector3[],
  seed: number,
): THREE.InstancedMesh[] {
  if (positions.length === 0) return [];

  // Split the scatter between cover types rather than placing each separately,
  // so density is controlled by one number at the call site.
  const slice = (from: number, to: number) =>
    positions.slice(
      Math.floor(positions.length * from),
      Math.floor(positions.length * to),
    );

  const { stem, head } = flowerGeometry();
  const { stalk, cap } = mushroomGeometry();

  switch (district) {
    case 'bramblewood': {
      // Woodland floor: mushrooms, ferns, and pale flowers that catch the lamp.
      const shrooms = slice(0, 0.3);
      const grass = slice(0.3, 0.75);
      const blooms = slice(0.75, 1);
      return [
        scatter(stalk, '#d8cbb4', shrooms, seed, [0.8, 1.4]),
        scatter(cap, '#b05a4e', shrooms, seed, [0.8, 1.4]),
        scatter(grassGeometry(), '#4f8a52', grass, seed + 1, [0.7, 1.5]),
        scatter(stem, '#4f8a52', blooms, seed + 2, [0.8, 1.2]),
        scatter(head, '#e8dcc0', blooms, seed + 2, [0.8, 1.2], '#fff1d0'),
      ];
    }

    case 'landing': {
      // Kept meadow: grass and warm little flowers around the post office.
      const grass = slice(0, 0.55);
      const blooms = slice(0.55, 1);
      return [
        scatter(grassGeometry(), '#6f9a5c', grass, seed, [0.7, 1.3]),
        scatter(stem, '#6f9a5c', blooms, seed + 1, [0.9, 1.3]),
        scatter(head, '#e8a33a', blooms, seed + 1, [0.9, 1.3], '#ffd08a'),
      ];
    }

    case 'tidebreak': {
      // Shore: tough grass and shingle.
      const grass = slice(0, 0.45);
      const stones = slice(0.45, 1);
      return [
        scatter(grassGeometry(), '#7f8f6a', grass, seed, [0.6, 1.1]),
        scatter(pebbleGeometry(), '#8d9099', stones, seed + 1, [0.6, 1.4]),
      ];
    }

    case 'coil': {
      // Industrial ground: gravel, and a few hardy blue flowers in the cracks.
      const stones = slice(0, 0.7);
      const blooms = slice(0.7, 1);
      return [
        scatter(pebbleGeometry(), '#6d7078', stones, seed, [0.5, 1.2]),
        scatter(stem, '#5d7a63', blooms, seed + 1, [0.7, 1.1]),
        scatter(head, '#5ec8c0', blooms, seed + 1, [0.7, 1.1], '#8ff0e8'),
      ];
    }

    case 'spire': {
      // Exposed and windswept: sparse grass, pale stones.
      const grass = slice(0, 0.4);
      const stones = slice(0.4, 1);
      return [
        scatter(grassGeometry(), '#8a9179', grass, seed, [0.5, 0.9]),
        scatter(pebbleGeometry(), '#a8a49b', stones, seed + 1, [0.5, 1.1]),
      ];
    }
  }
}
