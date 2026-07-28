import type { GameLoop } from '@engine/loop/GameLoop';
import type { SphericalCharacterController } from '@game/components/SphericalCharacterController';
import { cartesianToLatLon, horizonDistance } from '@core/math/spherical';
import { PLANET_RADIUS } from '@config/constants';
import type * as THREE from 'three';

/**
 * Development HUD: frame rate, locomotion state, and the player's position in
 * the (lat, lon, alt) coordinates that level data is authored in.
 *
 * Dev-only — gated on `import.meta.env.DEV` at the call site so it is tree-shaken
 * out of production builds entirely.
 */
export class DebugOverlay {
  private readonly root: HTMLElement;
  private elapsed = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed',
      'top:calc(8px + env(safe-area-inset-top))',
      'left:calc(8px + env(safe-area-inset-left))',
      'padding:8px 11px',
      'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#eae6dc',
      'background:rgba(20,23,36,.72)',
      'border:1px solid rgba(234,230,220,.14)',
      'border-radius:8px',
      'white-space:pre',
      'pointer-events:none',
      'z-index:30',
      'backdrop-filter:blur(6px)',
    ].join(';');
    parent.appendChild(this.root);
  }

  update(
    dt: number,
    loop: GameLoop,
    controller: SphericalCharacterController,
    position: THREE.Vector3,
  ): void {
    // Refresh at 10 Hz — updating text every frame is itself a measurable cost.
    this.elapsed += dt;
    if (this.elapsed < 0.1) return;
    this.elapsed = 0;

    const geo = cartesianToLatLon(position, PLANET_RADIUS);
    const horizon = horizonDistance(PLANET_RADIUS, 1.5);

    this.root.textContent = [
      `fps       ${loop.fps.toFixed(0).padStart(3)}`,
      `state     ${controller.state}`,
      `speed     ${controller.planarSpeed.toFixed(2)} m/s`,
      `grounded  ${controller.grounded ? 'yes' : 'no'}`,
      `lat/lon   ${geo.lat.toFixed(1)}° ${geo.lon.toFixed(1)}°`,
      `altitude  ${geo.altitude.toFixed(2)} m`,
      `horizon   ${horizon.toFixed(1)} m`,
    ].join('\n');
  }

  dispose(): void {
    this.root.remove();
  }
}
