import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GrassField } from '../../src/game/world/GrassField';
import { plantTrees } from '../../src/game/world/Trees';
import { isIntegratedGpu, isSoftwareRenderer } from '../../src/engine/platform/Viewport';
import {
  FUJI_CRATER,
  FUJI_FOOT,
  FUJI_HALF_WIDTH,
  FUJI_PEAK,
  fujiRise,
  fujiSkyline,
} from '../../src/game/world/Fuji';
import { carryTangent } from '../../src/game/world/skyFrame';
import { NO_INK } from '../../src/engine/render/InkEffect';

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

  it('cuts leaves out by alpha test, leaving alpha itself free to mark them', () => {
    // Alpha in the frame is what tells the ink to leave foliage alone, so it
    // cannot also be coverage.
    const crown = plantTrees('sakura', spots, 5, 7, 'high').find((m) => !m.userData.trunk)!;
    const material = crown.material as THREE.Material;
    expect(material.alphaToCoverage).toBe(false);
    expect(material.alphaTest).toBeGreaterThan(0);
    expect(NO_INK).toContain('gl_FragColor.a = 0.0');
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

  it('tells graphics built into the CPU from a graphics card', () => {
    expect(isIntegratedGpu('ANGLE (Intel, Intel(R) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(true);
    expect(isIntegratedGpu('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)')).toBe(true);
    expect(isIntegratedGpu('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)')).toBe(true);
    expect(isIntegratedGpu('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)')).toBe(false);
    expect(isIntegratedGpu('ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11)')).toBe(false);
    expect(isIntegratedGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti Direct3D11)')).toBe(false);
  });
});

describe('Fuji', () => {
  const degrees = (tangent: number): number => (Math.atan(tangent) * 180) / Math.PI;

  it('stands above eye level, with its foot below it', () => {
    // It used to top out seven degrees over the planet's rim, which from head
    // height on a sixty-metre ball is six degrees *under* the horizon.
    expect(degrees(FUJI_PEAK)).toBeGreaterThan(10);
    expect(degrees(FUJI_PEAK)).toBeLessThan(16);
    expect(FUJI_FOOT).toBeLessThan(0);
    expect(fujiSkyline(0)).toBeCloseTo(FUJI_PEAK, 6);
    expect(fujiSkyline(FUJI_HALF_WIDTH)).toBeCloseTo(FUJI_FOOT, 6);
  });

  it('is much wider than it is tall', () => {
    const width = 2 * FUJI_HALF_WIDTH;
    const height = FUJI_PEAK - FUJI_FOOT;
    expect(width / height).toBeGreaterThan(2.4);
    expect(width / height).toBeLessThan(4.5);
  });

  it('has a flat crater rim, then falls away on both sides without rising again', () => {
    expect(fujiRise(FUJI_HALF_WIDTH * FUJI_CRATER * 0.5)).toBe(1);
    expect(fujiRise(-FUJI_HALF_WIDTH * FUJI_CRATER * 0.5)).toBe(1);
    for (const side of [-1, 1]) {
      let previous = 1;
      for (let x = FUJI_CRATER + 0.01; x <= 1; x += 0.01) {
        const rise = fujiRise(side * x * FUJI_HALF_WIDTH);
        // The Hōei shoulder may hold the right flank level, never lift it.
        expect(rise).toBeLessThanOrEqual(previous + 1e-9);
        previous = rise;
      }
      expect(previous).toBeLessThan(0.01);
    }
  });

  it('has concave flanks: steep under the summit, long and gentle at the foot', () => {
    // On the left, which has no shoulder.
    const slope = (x: number): number =>
      (fujiRise(-(x - 0.01) * FUJI_HALF_WIDTH) - fujiRise(-(x + 0.01) * FUJI_HALF_WIDTH)) / 0.02;
    expect(slope(0.15)).toBeGreaterThan(slope(0.5));
    expect(slope(0.5)).toBeGreaterThan(slope(0.9));
    expect(slope(0.15)).toBeGreaterThan(slope(0.9) * 2);
  });
});

describe('the sky is carried, not steered by a compass', () => {
  const R = 60;
  const at = (latDeg: number, lonDeg: number): THREE.Vector3 => {
    const lat = (latDeg * Math.PI) / 180;
    const lon = (lonDeg * Math.PI) / 180;
    return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
  };
  const north = (up: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(0, 1, 0).projectOnPlane(up).normalize();

  /** Walk due east along a parallel, a centimetre at a time, carrying two directions. */
  function walkEast(latDeg: number, metres: number): { sky: THREE.Vector3; heading: THREE.Vector3; up: THREE.Vector3 } {
    const lonPerMetre = 180 / (Math.PI * R * Math.cos((latDeg * Math.PI) / 180));
    let up = at(latDeg, 30);
    const sky = north(up);
    // The camera's heading: some other direction, carried the same way.
    const heading = north(up).applyAxisAngle(up, 0.9);
    const steps = Math.round(metres * 100);
    for (let i = 1; i <= steps; i++) {
      const next = at(latDeg, 30 + (lonPerMetre * i) / 100);
      carryTangent(sky, up, next);
      carryTangent(heading, up, next);
      up = next;
    }
    return { sky, heading, up };
  }

  it('keeps the sky still against the camera while she walks', () => {
    // At the village: a compass frame slid 13 degrees over this walk.
    const { sky, heading, up } = walkEast(62, 8);
    expect(sky.dot(up)).toBeCloseTo(0, 9);
    expect(sky.length()).toBeCloseTo(1, 9);
    expect(sky.angleTo(heading)).toBeCloseTo(0.9, 4);
  });

  it('is exactly the turning a compass would have added', () => {
    const { sky, up } = walkEast(62, 8);
    const drift = THREE.MathUtils.radToDeg(sky.angleTo(north(up)));
    const expected = THREE.MathUtils.radToDeg((Math.tan((62 * Math.PI) / 180) / R) * 8);
    expect(expected).toBeGreaterThan(13);
    expect(drift).toBeCloseTo(expected, 1);
  });

  it('survives a walk over the pole, where a compass spins', () => {
    let up = at(89, 0);
    const sky = north(up);
    const heading = north(up).applyAxisAngle(up, -0.4);
    for (let lat = 89; lat <= 91.001; lat += 0.02) {
      const next = at(lat, 0);
      carryTangent(sky, up, next);
      carryTangent(heading, up, next);
      up = next;
    }
    expect(Number.isFinite(sky.x + sky.y + sky.z)).toBe(true);
    expect(sky.angleTo(heading)).toBeCloseTo(0.4, 4);
  });
});
