import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HorizonInstances, horizonReach } from '../../src/engine/render/HorizonInstances';

const R = 60;

/** One instance standing at each given direction, on the surface. */
function props(directions: THREE.Vector3[], height = 1): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(0.4, height, 0.4).translate(0, height / 2, 0);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), directions.length);
  const m = new THREE.Matrix4();
  directions.forEach((d, i) => {
    const p = d.clone().normalize().multiplyScalar(R);
    m.compose(p, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, new THREE.Color(i / 10, 0, 0));
  });
  return mesh;
}

const north = new THREE.Vector3(0, 1, 0);
const near = new THREE.Vector3(0.1, 1, 0);
const south = new THREE.Vector3(0, -1, 0);
const equator = new THREE.Vector3(1, 0, 0);

describe('horizon reach', () => {
  it('reaches further from higher up, and to taller things', () => {
    expect(horizonReach(R, 64, R)).toBeGreaterThan(horizonReach(R, 62, R));
    expect(horizonReach(R, 62, R + 8)).toBeGreaterThan(horizonReach(R, 62, R + 1));
    expect(horizonReach(R, R, R)).toBe(0);
  });
});

describe('HorizonInstances', () => {
  it('draws only what crests the horizon, packed to the front with its colour', () => {
    const mesh = props([south, north, equator, near]);
    const culler = new HorizonInstances(R);
    culler.add(mesh);
    culler.update(new THREE.Vector3(0, 63, 0));

    expect(mesh.count).toBe(2);
    const p = new THREE.Vector3();
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    expect(p.setFromMatrixPosition(m).normalize().dot(north)).toBeCloseTo(1, 5);
    mesh.getMatrixAt(1, m);
    expect(p.setFromMatrixPosition(m).normalize().dot(near.clone().normalize())).toBeCloseTo(1, 5);
    const colour = new THREE.Color();
    mesh.getColorAt(1, colour);
    expect(colour.r).toBeCloseTo(0.3, 5);
    expect(mesh.frustumCulled).toBe(false);
  });

  it('brings copies back as the viewer walks round, in their own places', () => {
    const mesh = props([south, north, equator]);
    const culler = new HorizonInstances(R);
    culler.add(mesh);
    culler.update(new THREE.Vector3(0, 63, 0));
    expect(mesh.count).toBe(1);

    culler.update(new THREE.Vector3(0, -63, 0));
    expect(mesh.count).toBe(1);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).y).toBeCloseTo(-R, 4);

    // From orbit, half the planet at once.
    culler.update(new THREE.Vector3(0, 0, 0).addScaledVector(equator, 400));
    expect(mesh.count).toBe(3);
  });

  it('keeps a tall thing past the horizon that a short one at the same spot loses', () => {
    const over = new THREE.Vector3(Math.sin(0.5), Math.cos(0.5), 0); // ~29° round
    const short = props([over], 0.5);
    const tall = props([over], 9);
    const culler = new HorizonInstances(R);
    culler.add(short);
    culler.add(tall);
    culler.update(new THREE.Vector3(0, 62, 0));
    expect(short.count).toBe(0);
    expect(tall.count).toBe(1);
  });
});
