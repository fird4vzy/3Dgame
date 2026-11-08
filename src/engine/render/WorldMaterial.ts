import * as THREE from 'three';

/**
 * The material everything procedural in the world is drawn with.
 *
 * Physically based, not cel-banded. The game began as a toon-shaded world with
 * ink outlines; the art direction is now a painterly-realistic valley — soft
 * light, real shadows, air you can see — and that look comes from the lighting
 * model, not from the colours. A three-band ramp throws away exactly the
 * gradients that make a surface read as lit by a sky: the sky colour creeping
 * into the shadow side, the warm fall-off of a low sun, the sheen on a wet
 * stone. `MeshStandardMaterial` keeps them, and with the sky captured as an
 * environment map (see `game/world/Environment`) everything is lit by the same
 * sky the player can see.
 *
 * Defaults are matte: almost nothing in a village is shiny, and a roughness
 * under ~0.6 on painted wood reads as plastic.
 */

export interface WorldMaterialOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  side?: THREE.Side;
}

export function createWorldMaterial(options: WorldMaterialOptions = {}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: options.color ?? 0xffffff,
    vertexColors: options.vertexColors ?? false,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    roughness: options.roughness ?? 0.88,
    metalness: options.metalness ?? 0,
    side: options.side ?? THREE.FrontSide,
  });

  if (options.emissive !== undefined) {
    material.emissive = new THREE.Color(options.emissive);
    material.emissiveIntensity = options.emissiveIntensity ?? 1;
  }
  return material;
}
