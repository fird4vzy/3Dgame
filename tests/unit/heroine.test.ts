import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { flightOf } from '../../src/game/entities/retarget';
import { OUTFIT, cloth, dressAria, knit } from '../../src/game/entities/outfit';

describe('captured jump timing (flightOf)', () => {
  const times = Array.from({ length: 11 }, (_, i) => i / 10);

  it('finds take-off before the feet leave and touchdown when they return', () => {
    // Feet: on the ground, crouch, leave, apex at 0.5 s, down by 0.8 s.
    const lift = [0, 0, 0.01, 0.05, 0.2, 0.4, 0.3, 0.1, 0.02, 0, 0];
    expect(flightOf(times, lift)).toEqual({ takeoff: 0.2, touchdown: 0.8 });
  });

  it('is not a jump if the feet never clear the ground', () => {
    const shuffle = [0, 0.01, 0.04, 0.06, 0.05, 0.02, 0, 0, 0, 0, 0];
    expect(flightOf(times, shuffle)).toBeUndefined();
  });
});

describe('dressing her in burgundy and brown', () => {
  /** A strip of navy cloth, opaque except one texel that is cut away. */
  function navyStrip(width: number): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(width * 4);
    for (let x = 0; x < width; x++) pixels.set([37, 40, 50, 255], x * 4);
    pixels[3] = 0;
    return pixels;
  }

  it('turns the navy top into a burgundy knit with visible ribs', () => {
    const width = 96;
    const pixels = navyStrip(width);
    knit(OUTFIT.top)(pixels, width, 1);
    const opaque = Array.from({ length: width - 1 }, (_, k) => (k + 1) * 4);
    for (const i of opaque) {
      expect(pixels[i]!).toBeGreaterThan(pixels[i + 1]! + 50);
      expect(pixels[i]!).toBeGreaterThan(pixels[i + 2]! + 40);
    }
    // Ribs: a tenth or so darker in the grooves, whatever the colour.
    const reds = opaque.map((i) => pixels[i]!);
    expect((Math.max(...reds) - Math.min(...reds)) / Math.max(...reds)).toBeGreaterThan(0.08);
  });

  it('bleeds the cloth colour under cut-away texels so mips do not draw a dark rim', () => {
    const pixels = navyStrip(16);
    knit(OUTFIT.top)(pixels, 16, 1);
    expect(Array.from(pixels.slice(0, 4))).toEqual([...OUTFIT.top, 0]);
  });

  it('turns denim brown and leaves the gold trims alone', () => {
    const pixels = new Uint8ClampedArray([25, 35, 60, 255, 30, 42, 70, 255, 190, 150, 70, 255]);
    cloth(OUTFIT.trousers)(pixels, 3, 1);
    expect(pixels[0]!).toBeGreaterThan(pixels[1]!);
    expect(pixels[1]!).toBeGreaterThan(pixels[2]!);
    expect(Array.from(pixels.slice(8, 11))).toEqual([190, 150, 70]);
  });

  it('does nothing without a DOM to paint with', () => {
    expect(() => dressAria(new THREE.Object3D())).not.toThrow();
  });
});
