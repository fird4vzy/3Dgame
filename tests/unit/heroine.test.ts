import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { flightOf } from '../../src/game/entities/retarget';
import { dressFromSheet, lightDenim, stripedShirt } from '../../src/game/entities/outfit';

const luminance = (p: ArrayLike<number>, i: number): number => 0.2126 * p[i]! + 0.7152 * p[i + 1]! + 0.0722 * p[i + 2]!;

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

describe('dressing her from the character sheet', () => {
  /** A strip of navy cloth, opaque except one texel that is cut away. */
  function navyStrip(width: number): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(width * 4);
    for (let x = 0; x < width; x++) pixels.set([37, 40, 50, 255], x * 4);
    pixels[3] = 0;
    return pixels;
  }

  it('turns the navy top white, with lavender stripes at a fixed period', () => {
    const width = 64;
    const pixels = navyStrip(width);
    stripedShirt(pixels, width, 1);
    const opaque = Array.from({ length: width - 1 }, (_, k) => (k + 1) * 4);
    for (const i of opaque) expect(luminance(pixels, i)).toBeGreaterThan(150);
    const striped = opaque.filter((i) => pixels[i + 2]! - pixels[i]! > 25);
    // Period 8 over 63 texels: a stripe in every period, never the whole cloth.
    expect(striped.length).toBeGreaterThanOrEqual(7);
    expect(striped.length).toBeLessThan(opaque.length / 2);
  });

  it('bleeds white under cut-away texels so mips do not draw a dark rim', () => {
    const pixels = navyStrip(16);
    stripedShirt(pixels, 16, 1);
    expect(Array.from(pixels.slice(0, 4))).toEqual([244, 243, 247, 0]);
  });

  it('lightens denim to a pale blue and leaves the gold trims alone', () => {
    const pixels = new Uint8ClampedArray([25, 35, 60, 255, 30, 42, 70, 255, 190, 150, 70, 255]);
    lightDenim(pixels, 3, 1);
    expect(pixels[2]!).toBeGreaterThan(170);
    expect(pixels[2]!).toBeGreaterThan(pixels[0]! + 30);
    expect(Array.from(pixels.slice(8, 11))).toEqual([190, 150, 70]);
  });

  it('does nothing without a DOM to paint with', () => {
    expect(() => dressFromSheet(new THREE.Object3D())).not.toThrow();
  });
});
