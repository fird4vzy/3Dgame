import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GrassField } from '../../src/game/world/GrassField';
import { plantTrees } from '../../src/game/world/Trees';
import { isSoftwareRenderer } from '../../src/engine/platform/Viewport';

/**
 * A 10 m square of planet surface at the north pole, carrying the attributes
 * the terrain paints: a colour and a grass weight per vertex.
 */
function surfacePatch(weight: (x: number, z: number) => number): THREE.BufferGeometry {
  const R = 60;
  const positions: number[] = [];
  const colours: number[] = [];
  const grass: number[] = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const x = -5 + (10 * i) / steps;
      const z = -5 + (10 * j) / steps;
      positions.push(x, Math.sqrt(R * R - x * x - z * z), z);
      colours.push(0.3, 0.5, 0.2);
      grass.push(weight(x, z));
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const a = i * (steps + 1) + j;
      const b = a + 1;
      const c = a + steps + 1;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('grass', new THREE.Float32BufferAttribute(grass, 1));
  geometry.setIndex(indices);
  return geometry;
}

function offsets(field: GrassField): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  field.group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const attribute = mesh.geometry.getAttribute('aOffset') as THREE.BufferAttribute;
    for (let i = 0; i < attribute.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(attribute, i));
  });
  return points;
}

describe('grass field', () => {
  it('grows nowhere the terrain painted bare', () => {
    const field = new GrassField(surfacePatch(() => 0), 1, 6);
    expect(field.clumpCount).toBe(0);
  });

  it('grows at about the requested density on full grass', () => {
    const field = new GrassField(surfacePatch(() => 1), 1, 6);
    // ~100 m² at 6 clumps per m².
    expect(field.clumpCount).toBeGreaterThan(450);
    expect(field.clumpCount).toBeLessThan(750);
  });

  it('follows the weight within the patch, not just its mean', () => {
    const field = new GrassField(surfacePatch((x) => (x < 0 ? 1 : 0)), 3, 6);
    const points = offsets(field);
    const east = points.filter((p) => p.x > 1.5).length;
    const west = points.filter((p) => p.x < -1.5).length;
    expect(west).toBeGreaterThan(east * 5);
  });

  it('plants every clump on the surface it was given', () => {
    const field = new GrassField(surfacePatch(() => 1), 2, 6);
    for (const p of offsets(field)) {
      expect(p.length()).toBeGreaterThan(59.7);
      expect(p.length()).toBeLessThan(60.01);
    }
  });

  it('bounds each chunk where its clumps are, so frustum culling works', () => {
    const field = new GrassField(surfacePatch(() => 1), 4, 6);
    field.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const sphere = mesh.geometry.boundingSphere!;
      const attribute = mesh.geometry.getAttribute('aOffset') as THREE.BufferAttribute;
      const p = new THREE.Vector3();
      for (let i = 0; i < attribute.count; i++) {
        expect(sphere.containsPoint(p.fromBufferAttribute(attribute, i))).toBe(true);
      }
    });
  });
});

describe('painted trees', () => {
  const spots = [
    new THREE.Vector3(0, 60, 0),
    new THREE.Vector3(60, 0, 0),
    new THREE.Vector3(0, 0, 60),
    new THREE.Vector3(0, -60, 0),
  ];

  it('plants a trunk and a crown for every tree', () => {
    const meshes = plantTrees('sakura', spots, 5, 7, 'high');
    const trunks = meshes.filter((m) => m.userData.trunk === true);
    const crowns = meshes.filter((m) => m.userData.trunk !== true);
    expect(trunks.reduce((n, m) => n + m.count, 0)).toBe(spots.length);
    expect(crowns.reduce((n, m) => n + m.count, 0)).toBe(spots.length);
  });

  it('stands each tree on its own local up', () => {
    const [trunks] = plantTrees('pine', [new THREE.Vector3(60, 0, 0)], 6, 3, 'high');
    const matrix = new THREE.Matrix4();
    trunks!.getMatrixAt(0, matrix);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
    expect(up.x).toBeGreaterThan(0.99);
  });

  it('paints leaves with gaps in them', () => {
    const meshes = plantTrees('momiji', spots, 4.5, 11, 'high');
    const crown = meshes.find((m) => m.userData.trunk !== true)!;
    const map = (crown.material as THREE.MeshStandardMaterial).map!;
    const data = (map.image as { data: Uint8Array }).data;
    let clear = 0;
    let solid = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! === 0) clear++;
      else if (data[i]! > 200) solid++;
    }
    // Both, in quantity: a crown that is all leaf is a hull again, and one
    // that is all gap is not there.
    expect(clear / (data.length / 4)).toBeGreaterThan(0.15);
    expect(solid / (data.length / 4)).toBeGreaterThan(0.2);
  });

  it('only uses alpha-to-coverage where there is MSAA to give coverage to', () => {
    const high = plantTrees('sakura', spots, 5, 7, 'high').find((m) => !m.userData.trunk)!;
    const low = plantTrees('sakura', spots, 5, 7, 'low').find((m) => !m.userData.trunk)!;
    expect((high.material as THREE.Material).alphaToCoverage).toBe(true);
    expect((low.material as THREE.Material).alphaToCoverage).toBe(false);
  });
});

describe('quality tier', () => {
  it('recognises a CPU rasteriser', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))')).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)')).toBe(true);
  });

  it('does not mistake a GPU for one', () => {
    expect(isSoftwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti Direct3D11)')).toBe(false);
    expect(isSoftwareRenderer('Apple M2')).toBe(false);
    expect(isSoftwareRenderer('')).toBe(false);
  });
});
