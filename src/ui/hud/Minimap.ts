import * as THREE from 'three';
import { PLANET_RADIUS } from '@config/constants';
import type { MarkerKind, MinimapMarker } from '@game/world/mapMarkers';

export type { MarkerKind, MinimapMarker };

const SIZE = 148;
/** How much of the surface fits in the dial, as an arc length in metres. */
const RANGE_METRES = 130;

/**
 * Marker styling, and — as importantly — its hierarchy.
 *
 * `order` is the draw order, low first, so the objective always lands on top.
 * The first pass drew markers in whatever order the scene supplied them and the
 * dial became a field of two dozen equally-bright shard dots with the one
 * marker that mattered lost inside it. Collectibles are ambient information;
 * the objective is the reason the dial exists.
 */
const STYLE: Record<
  MarkerKind,
  { fill: string; radius: number; glow: number; alpha: number; order: number }
> = {
  shard: { fill: '#7ff5ee', radius: 1.5, glow: 0, alpha: 0.4, order: 0 },
  lamp: { fill: '#e8a33a', radius: 1.4, glow: 0, alpha: 0.35, order: 1 },
  npc: { fill: '#d8dce8', radius: 2.8, glow: 0, alpha: 0.8, order: 2 },
  objective: { fill: '#f6bd60', radius: 6, glow: 12, alpha: 1, order: 3 },
};

const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _to = new THREE.Vector3();

/**
 * A minimap for a planet you can walk around.
 *
 * Uses an **azimuthal equidistant projection centred on the player**, which is
 * the right projection here and not an aesthetic choice: on a sphere, a
 * straight line from the centre of this dial is a great circle, and distance
 * from the centre is true walking distance. So "it is up and to the left, about
 * halfway out" is literally the route and the effort. A flat top-down map would
 * lie about both as soon as you left its centre.
 *
 * It rotates with the camera, so up on the dial is always forward on screen.
 * Rotating maps beat fixed-north ones for moment-to-moment navigation, and this
 * world has no north to speak of anyway.
 *
 * Drawn on a 2D canvas rather than as a second 3D view: no extra render target,
 * no extra draw calls, and it stays crisp at any DPI.
 */
export class Minimap {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dpr: number;
  private visible = true;

  constructor(parent: HTMLElement) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE * this.dpr;
    this.canvas.height = SIZE * this.dpr;
    this.canvas.style.cssText = `width:${SIZE}px;height:${SIZE}px;display:block`;

    this.element = document.createElement('div');
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.cssText = [
      'position:absolute',
      // Bottom-right, not top-right: toasts stack down the top-right corner
      // and would sit straight on top of the dial.
      'bottom:calc(16px + env(safe-area-inset-bottom))',
      'right:calc(16px + env(safe-area-inset-right))',
      `width:${SIZE}px`,
      `height:${SIZE}px`,
      'border-radius:50%',
      'overflow:hidden',
      'background:rgba(14,17,30,.62)',
      'border:1px solid rgba(234,230,220,.16)',
      'backdrop-filter:blur(6px)',
      'box-shadow:0 8px 30px -14px rgba(0,0,0,.9)',
      'pointer-events:none',
      'transition:opacity 300ms ease',
    ].join(';');
    this.element.appendChild(this.canvas);
    parent.appendChild(this.element);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('[Minimap] 2D canvas unavailable');
    this.ctx = ctx;
    this.ctx.scale(this.dpr, this.dpr);
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.element.style.opacity = visible ? '1' : '0';
  }

  /**
   * @param playerPosition Where the player is standing.
   * @param cameraForward  Camera forward; the dial rotates so this points up.
   * @param markers        Everything worth showing.
   * @param litFraction    0–1 total illumination, used to warm the dial.
   */
  update(
    playerPosition: THREE.Vector3,
    cameraForward: THREE.Vector3,
    markers: readonly MinimapMarker[],
    litFraction: number,
  ): void {
    if (!this.visible) return;

    const ctx = this.ctx;
    const c = SIZE / 2;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Build the player's tangent frame: `fwd` is the camera direction flattened
    // onto the ground, which is the axis the dial is aligned to.
    _up.copy(playerPosition).normalize();
    _fwd.copy(cameraForward).projectOnPlane(_up);
    if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 1, 0).projectOnPlane(_up);
    _fwd.normalize();
    _right.copy(_up).cross(_fwd).normalize();

    this.drawDial(ctx, c, litFraction);

    // Sorted so the objective is drawn last and cannot be buried under a
    // scattering of collectibles. Copying a handful of entries per frame is
    // cheaper than any of the alternatives and keeps the scene ignorant of
    // presentation order.
    const ordered = [...markers].sort(
      (a, b) => STYLE[a.kind].order - STYLE[b.kind].order,
    );

    for (const marker of ordered) {
      const point = this.project(playerPosition, marker.position, c);
      if (!point) continue;
      this.drawMarker(ctx, point.x, point.y, marker.kind, point.clamped);
    }

    this.drawPlayer(ctx, c);
  }

  /**
   * Project a world point into dial space.
   *
   * Bearing comes from the tangent frame; radius is the great-circle distance,
   * so the scale is honest. Anything past the range is pinned to the rim rather
   * than dropped — knowing the objective is "that way, further than the dial
   * shows" is exactly the information the player was missing.
   */
  private project(
    from: THREE.Vector3,
    to: THREE.Vector3,
    c: number,
  ): { x: number; y: number; clamped: boolean } | null {
    const a = from.clone().normalize();
    const b = to.clone().normalize();

    const cos = THREE.MathUtils.clamp(a.dot(b), -1, 1);
    const arc = Math.acos(cos) * PLANET_RADIUS;

    _to.copy(b).projectOnPlane(_up);
    if (_to.lengthSq() < 1e-10) {
      // Directly underfoot: no meaningful bearing.
      return { x: c, y: c, clamped: false };
    }
    _to.normalize();

    const bearing = Math.atan2(_right.dot(_to), _fwd.dot(_to));

    const usable = c - 10;
    const clamped = arc > RANGE_METRES;
    const radius = clamped ? usable : (arc / RANGE_METRES) * usable;

    return {
      x: c + Math.sin(bearing) * radius,
      y: c - Math.cos(bearing) * radius,
      clamped,
    };
  }

  private drawDial(ctx: CanvasRenderingContext2D, c: number, litFraction: number): void {
    // Range rings at a third and two thirds, so distance is readable, not felt.
    ctx.strokeStyle = 'rgba(234,230,220,.10)';
    ctx.lineWidth = 1;
    for (const t of [0.34, 0.67]) {
      ctx.beginPath();
      ctx.arc(c, c, (c - 10) * t, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cross hairs, brightest ahead.
    ctx.strokeStyle = 'rgba(234,230,220,.08)';
    ctx.beginPath();
    ctx.moveTo(c, 8);
    ctx.lineTo(c, SIZE - 8);
    ctx.moveTo(8, c);
    ctx.lineTo(SIZE - 8, c);
    ctx.stroke();

    // The rim warms as the planet lights — the same signal as the sky.
    const warmth = 0.18 + litFraction * 0.4;
    ctx.strokeStyle = `rgba(232,163,58,${warmth.toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, c - 4, 0, Math.PI * 2);
    ctx.stroke();

    // Forward tick, so the dial's orientation is unambiguous.
    ctx.fillStyle = 'rgba(234,230,220,.5)';
    ctx.beginPath();
    ctx.moveTo(c, 5);
    ctx.lineTo(c - 4, 12);
    ctx.lineTo(c + 4, 12);
    ctx.closePath();
    ctx.fill();
  }

  private drawMarker(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    kind: MarkerKind,
    clamped: boolean,
  ): void {
    const style = STYLE[kind];

    if (style.glow > 0) {
      ctx.shadowColor = style.fill;
      ctx.shadowBlur = style.glow;
    }
    ctx.fillStyle = style.fill;
    // Off-range markers fade, so "pinned to the rim" is distinguishable from
    // "actually at the edge of the dial".
    ctx.globalAlpha = style.alpha * (clamped ? 0.7 : 1);

    ctx.beginPath();
    ctx.arc(x, y, style.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    if (kind === 'objective') {
      ctx.strokeStyle = 'rgba(20,23,36,.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, c: number): void {
    // The player is always dead centre, pointing up — that is what "centred on
    // the player, rotated to the camera" means.
    ctx.fillStyle = '#3fd0cc';
    ctx.shadowColor = '#3fd0cc';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(c, c - 5.5);
    ctx.lineTo(c - 4, c + 4.5);
    ctx.lineTo(c, c + 2);
    ctx.lineTo(c + 4, c + 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  dispose(): void {
    this.element.remove();
  }
}
