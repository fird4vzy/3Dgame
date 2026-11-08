import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ParticleSystem } from '../../src/engine/vfx/ParticleSystem';
import { createWorldMaterial } from '../../src/engine/render/WorldMaterial';
import { installAtmosphere, atmosphereUniforms } from '../../src/engine/render/Atmosphere';
import { styliseModel } from '../../src/engine/render/stylise';
import { pickAudioFormat } from '../../src/engine/audio/formats';
import { buildDistrictProps, buildLighthouse } from '../../src/game/entities/districtProps';
import { DISTRICTS } from '../../src/data/content';

const camera = new THREE.PerspectiveCamera();

describe('ParticleSystem', () => {
  it('emits and reports live particles', () => {
    const system = new ParticleSystem(50);
    system.emit({
      position: new THREE.Vector3(),
      count: 10,
      colour: new THREE.Color('#ffffff'),
      life: [1, 1],
    });
    expect(system.activeCount).toBe(10);

    system.update(0.016, camera);
    expect(system.mesh.count).toBe(10);
  });

  it('retires particles when their life expires', () => {
    const system = new ParticleSystem(20);
    system.emit({
      position: new THREE.Vector3(),
      count: 5,
      colour: new THREE.Color('#ffffff'),
      life: [0.1, 0.1],
    });

    system.update(0.05, camera);
    expect(system.activeCount).toBe(5);

    system.update(0.2, camera);
    expect(system.activeCount).toBe(0);
    expect(system.mesh.count).toBe(0);
  });

  it('recycles dead particles rather than growing', () => {
    const system = new ParticleSystem(10);
    const options = {
      position: new THREE.Vector3(),
      count: 10,
      colour: new THREE.Color('#ffffff'),
      life: [0.05, 0.05] as [number, number],
    };

    system.emit(options);
    system.update(0.2, camera); // all expire
    expect(system.activeCount).toBe(0);

    system.emit(options);
    expect(system.activeCount).toBe(10);
    // The pool never exceeds its capacity, whatever we throw at it.
    expect(system.mesh.instanceMatrix.count).toBe(10);
  });

  it('never exceeds capacity even when over-emitted', () => {
    const system = new ParticleSystem(8);
    system.emit({
      position: new THREE.Vector3(),
      count: 100,
      colour: new THREE.Color('#ffffff'),
      life: [5, 5],
    });
    system.update(0.016, camera);
    expect(system.mesh.count).toBeLessThanOrEqual(8);
  });

  it('applies gravity to velocity over time', () => {
    const system = new ParticleSystem(4);
    system.emit({
      position: new THREE.Vector3(0, 0, 0),
      count: 1,
      colour: new THREE.Color('#ffffff'),
      speed: [0, 0],
      life: [10, 10],
      gravity: new THREE.Vector3(0, -10, 0),
      drag: 0,
    });

    system.update(0.5, camera);
    const matrix = new THREE.Matrix4();
    system.mesh.getMatrixAt(0, matrix);
    const position = new THREE.Vector3().setFromMatrixPosition(matrix);
    // Half a second of -10 m/s^2 with no drag: velocity -5, moved -2.5m.
    expect(position.y).toBeLessThan(-1);
  });

  it('biases emission along a direction when given one', () => {
    const system = new ParticleSystem(40);
    system.emit({
      position: new THREE.Vector3(),
      count: 20,
      colour: new THREE.Color('#ffffff'),
      speed: [5, 5],
      life: [10, 10],
      direction: new THREE.Vector3(0, 1, 0),
      spread: 0,
      drag: 0,
    });

    system.update(0.2, camera);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < system.mesh.count; i++) {
      system.mesh.getMatrixAt(i, matrix);
      // With zero spread everything should travel up, not down.
      expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeGreaterThan(0);
    }
  });

  it('clears on demand', () => {
    const system = new ParticleSystem(10);
    system.emit({ position: new THREE.Vector3(), count: 5, colour: new THREE.Color() });
    system.clear();
    expect(system.activeCount).toBe(0);
  });
});

describe('world shading', () => {
  it('creates a matte physically based material', () => {
    const material = createWorldMaterial({ color: '#ff0000' });
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.color.getHexString()).toBe('ff0000');
    // Almost nothing in a village is shiny; low roughness on wood reads as plastic.
    expect(material.roughness).toBeGreaterThanOrEqual(0.8);
    expect(material.metalness).toBe(0);
  });

  it('carries emissive through, since the illumination system drives it', () => {
    const material = createWorldMaterial({ emissive: '#e8a33a', emissiveIntensity: 0 });
    expect(material.emissive.getHexString()).toBe('e8a33a');
    expect(material.emissiveIntensity).toBe(0);
  });

  it('keeps an import\'s maps but tames generator metalness', () => {
    const normalMap = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.1, normalMap });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), source));

    styliseModel(root, { height: 4 });
    const mesh = root.children[0] as THREE.Mesh;
    const converted = mesh.material as THREE.MeshStandardMaterial;

    expect(converted).not.toBe(source);
    expect(converted.normalMap).toBe(normalMap);
    // A metallic roof under a blue sky is a mirror.
    expect(converted.metalness).toBeLessThanOrEqual(0.15);
    expect(converted.roughness).toBeGreaterThanOrEqual(0.55);
  });
});

describe('atmosphere', () => {
  it('replaces three\'s depth fog with the planetary atmosphere', () => {
    installAtmosphere();
    expect(THREE.ShaderChunk.fog_fragment).toContain('atmoSeaRadius');
    expect(THREE.ShaderChunk.fog_vertex).toContain('vFogWorldPosition');
  });

  it('hands every program the same uniform objects', () => {
    installAtmosphere();
    const a = { uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    const b = { uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    const renderer = {} as THREE.WebGLRenderer;
    new THREE.MeshBasicMaterial().onBeforeCompile(a, renderer);
    new THREE.MeshStandardMaterial().onBeforeCompile(b, renderer);

    // Shared by reference, so one write per frame reaches every material.
    expect(a.uniforms.atmoSunDir).toBe(atmosphereUniforms.atmoSunDir);
    expect(b.uniforms.atmoParams).toBe(atmosphereUniforms.atmoParams);
  });
});

describe('audio format selection', () => {
  it('falls back to webm when no DOM is available', () => {
    expect(['webm', 'm4a']).toContain(pickAudioFormat());
  });
});

describe('district props', () => {
  const positions = [
    new THREE.Vector3(0, 60, 0),
    new THREE.Vector3(60, 0, 0),
    new THREE.Vector3(0, 0, 60),
  ];

  it('builds instanced geometry for every district', () => {
    for (const district of DISTRICTS) {
      const meshes = buildDistrictProps(district.id, positions, 1);
      expect(meshes.length).toBeGreaterThan(0);
      for (const mesh of meshes) {
        expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
        expect(mesh.count).toBe(positions.length);
      }
    }
  });

  it('orients props so their local up is the surface normal', () => {
    const meshes = buildDistrictProps('bramblewood', positions, 7);
    const matrix = new THREE.Matrix4();
    meshes[0]!.getMatrixAt(0, matrix);

    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      new THREE.Quaternion().setFromRotationMatrix(matrix),
    );
    const expected = positions[0]!.clone().normalize();
    expect(up.dot(expected)).toBeGreaterThan(0.99);
  });

  it('handles an empty placement list without producing a broken mesh', () => {
    const meshes = buildDistrictProps('coil', [], 1);
    for (const mesh of meshes) expect(mesh.count).toBe(0);
  });

  it('builds a lighthouse tall enough to be a landmark', () => {
    const { group, lamp, light } = buildLighthouse();
    const box = new THREE.Box3().setFromObject(group);
    const height = box.max.y - box.min.y;

    // It has to crest a 13.5 m horizon from outside its own district.
    expect(height).toBeGreaterThan(12);
    expect(lamp.position.y).toBeGreaterThan(10);
    // Starts dark; IlluminationSystem raises it.
    expect(light.intensity).toBe(0);
  });
});
