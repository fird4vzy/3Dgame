import * as THREE from 'three';
import type { EventBus } from '@core/events/EventBus';
import { walkingDistance } from '@game/world/placement';
import { Minimap } from './Minimap';
import { icon } from '../icons';
import type { MinimapMarker } from '@game/world/mapMarkers';

const _toTarget = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

/**
 * The in-game HUD — sparse, but no longer *only* a compass.
 *
 * The original design said direction-only and never a map, on the reasoning
 * that a 13.5 m horizon means landmarks crest into view as you approach. In
 * play that turned out to be half right: it works beautifully for the last
 * twenty metres and not at all for the first two hundred, and players reported
 * losing time hunting for recipients. So there is now a {@link Minimap} —
 * a dial, not a map screen, and it shows where things *are* without telling you
 * how to get there. Playtest beats pillar.
 */
export class Hud {
  private readonly minimap: Minimap;
  /** Markers supplied by the scene each frame; empty until it feeds us. */
  private markers: readonly MinimapMarker[] = [];
  private litFraction = 0;

  private readonly root: HTMLElement;
  private readonly compass: HTMLElement;
  private readonly compassNeedle: HTMLElement;
  private readonly compassLabel: HTMLElement;
  private readonly card: HTMLElement;
  private readonly cardTitle: HTMLElement;
  private readonly cardHint: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly parcel: HTMLElement;
  private readonly district: HTMLElement;

  private target: THREE.Vector3 | null = null;
  private districtTimer = 0;

  constructor(
    parent: HTMLElement,
    private readonly bus: EventBus,
  ) {
    this.root = el('div', 'position:absolute;inset:0;pointer-events:none;');

    // ── compass ribbon, top centre ────────────────────────────────────────
    this.compass = el(
      'div',
      [
        'position:absolute',
        'top:calc(14px + env(safe-area-inset-top))',
        'left:50%',
        'transform:translateX(-50%)',
        'display:flex;flex-direction:column;align-items:center;gap:4px',
        'padding:8px 18px',
        'background:rgba(20,23,36,.55)',
        'border:1px solid rgba(234,230,220,.12)',
        'border-radius:999px',
        'backdrop-filter:blur(6px)',
        'transition:opacity 400ms ease',
        'opacity:0',
      ].join(';'),
    );
    // The needle was the "▲" character. A glyph is at the mercy of whatever
    // font resolves, and its optical centre is not its bounding-box centre, so
    // rotating it wobbled. A mask rotates about the middle of its own box.
    this.compassNeedle = el('div', 'transition:transform 120ms ease;line-height:0');
    this.compassNeedle.appendChild(icon('compass', 20, 'var(--lp-lumen)'));
    this.compassLabel = el(
      'div',
      'font:500 11px/1 var(--lp-font-body);letter-spacing:.1em;text-transform:uppercase;color:var(--lp-ink-soft)',
    );
    this.compass.append(this.compassNeedle, this.compassLabel);

    // ── contract card, top left ───────────────────────────────────────────
    this.card = el(
      'div',
      [
        'position:absolute',
        'top:calc(14px + env(safe-area-inset-top))',
        'left:calc(14px + env(safe-area-inset-left))',
        'max-width:min(280px,42vw)',
        'padding:10px 14px',
        'background:rgba(20,23,36,.6)',
        'border:1px solid rgba(234,230,220,.12)',
        'border-left:3px solid var(--lp-lumen)',
        'border-radius:0 10px 10px 0',
        'backdrop-filter:blur(6px)',
        'transition:opacity 300ms ease,transform 300ms ease',
        'opacity:0;transform:translateX(-8px)',
      ].join(';'),
    );
    this.cardTitle = el('div', 'font:600 13.5px/1.35 var(--lp-font-body);color:var(--lp-ink)');
    this.cardHint = el(
      'div',
      'font:400 12px/1.4 var(--lp-font-body);color:var(--lp-ink-soft);margin-top:3px',
    );
    this.card.append(this.cardTitle, this.cardHint);

    // ── interaction prompt, centre ────────────────────────────────────────
    this.prompt = el(
      'div',
      [
        'position:absolute',
        'left:50%;top:58%',
        'transform:translate(-50%,-50%) scale(.85)',
        'padding:7px 15px',
        'background:rgba(232,163,58,.92)',
        'color:#241d13',
        'font:650 13px/1 var(--lp-font-body)',
        'border-radius:999px',
        'opacity:0',
        'transition:opacity 140ms ease,transform 140ms cubic-bezier(.34,1.56,.64,1)',
      ].join(';'),
    );

    // ── parcel indicator, bottom left ─────────────────────────────────────
    // Warmth is shown as the parcel's colour, never as a bar (Pillar 2).
    //
    // The dot is still what carries the warmth reading — a filled circle is a
    // far better colour swatch than a detailed shape, because the eye judges
    // hue by area. The parcel icon rides *inside* it as a mask in the ink
    // colour, so the silhouette says "you are carrying something" while the
    // colour behind it keeps saying how warm it still is.
    this.parcel = el(
      'div',
      [
        'position:absolute',
        'bottom:calc(18px + env(safe-area-inset-bottom))',
        'left:calc(18px + env(safe-area-inset-left))',
        'width:38px;height:38px;border-radius:50%',
        'border:2px solid rgba(234,230,220,.25)',
        'display:grid;place-items:center',
        'transition:background 400ms ease,box-shadow 400ms ease,opacity 250ms ease',
        'opacity:0',
      ].join(';'),
    );
    this.parcel.appendChild(icon('parcel', 20, 'rgba(20,23,36,.78)'));

    // ── district banner ───────────────────────────────────────────────────
    this.district = el(
      'div',
      [
        'position:absolute',
        'left:50%;top:34%',
        'transform:translateX(-50%)',
        'font:700 26px/1 var(--lp-font-display)',
        'letter-spacing:.06em',
        'color:var(--lp-ink)',
        'text-shadow:0 2px 18px rgba(0,0,0,.8)',
        'opacity:0',
        'transition:opacity 700ms ease',
      ].join(';'),
    );

    this.minimap = new Minimap(this.root);
    this.root.append(this.compass, this.card, this.prompt, this.parcel, this.district);
    parent.appendChild(this.root);

    this.subscribe();
  }

  private subscribe(): void {
    this.bus.on('contract:accepted', ({ title }) => {
      this.cardTitle.textContent = title;
      this.show(this.card, 'translateX(0)');
      this.compass.style.opacity = '1';
    });

    this.bus.on('delivery:completed', () => {
      this.hide(this.card, 'translateX(-8px)');
      this.compass.style.opacity = '0';
      this.parcel.style.opacity = '0';
      this.target = null;
    });

    this.bus.on('interaction:focusChanged', ({ prompt }) => {
      if (prompt) {
        this.prompt.textContent = prompt;
        this.prompt.style.opacity = '1';
        this.prompt.style.transform = 'translate(-50%,-50%) scale(1)';
      } else {
        this.prompt.style.opacity = '0';
        this.prompt.style.transform = 'translate(-50%,-50%) scale(.85)';
      }
    });

    this.bus.on('parcel:picked', () => {
      this.parcel.style.opacity = '1';
    });

    this.bus.on('parcel:warmthChanged', ({ warmth }) => {
      // Amber when fresh, cooling toward blue — the only warmth readout.
      const colour = new THREE.Color('#69a5d8').lerp(new THREE.Color('#f6bd60'), warmth);
      const css = `#${colour.getHexString()}`;
      this.parcel.style.background = css;
      this.parcel.style.boxShadow = `0 0 ${8 + warmth * 16}px ${css}`;
    });

    this.bus.on('district:entered', ({ displayName }) => {
      this.district.textContent = displayName;
      this.district.style.opacity = '1';
      this.districtTimer = 2.6;
    });

    this.bus.on('dialogue:started', () => this.setVisible(false));
    this.bus.on('dialogue:ended', () => this.setVisible(true));
  }

  /** Point the compass at a world position, or clear it with null. */
  setTarget(target: THREE.Vector3 | null, hint?: string): void {
    this.target = target;
    if (hint) this.cardHint.textContent = hint;
    // The compass follows whatever the current objective is, including the
    // walk to the postmaster before the first contract exists.
    this.compass.style.opacity = target ? '1' : '0';
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  /** Feed the minimap. Called by the scene, which owns what is out there. */
  setMinimapData(markers: readonly MinimapMarker[], litFraction: number): void {
    this.markers = markers;
    this.litFraction = litFraction;
  }

  update(dt: number, playerPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
    if (this.districtTimer > 0) {
      this.districtTimer -= dt;
      if (this.districtTimer <= 0) this.district.style.opacity = '0';
    }

    // Drawn every frame regardless of whether there is an objective: knowing
    // what is around you is the point, not just where you are headed.
    this.minimap.update(playerPosition, cameraForward, this.markers, this.litFraction);

    if (!this.target) return;

    // Bearing is computed in the player's tangent plane: on a sphere there is
    // no global "north" to measure against, only the local frame.
    _up.copy(playerPosition).normalize();
    _toTarget.copy(this.target).sub(playerPosition).projectOnPlane(_up);
    if (_toTarget.lengthSq() < 1e-6) return;
    _toTarget.normalize();

    _forward.copy(cameraForward).projectOnPlane(_up).normalize();
    _right.copy(_up).cross(_forward).normalize();

    const angle = Math.atan2(_right.dot(_toTarget), _forward.dot(_toTarget));
    // Rotation only. This used to also assign `textContent = '▲'` every frame,
    // which now would delete the masked icon child on the first update.
    this.compassNeedle.style.transform = `rotate(${(angle * 180) / Math.PI}deg)`;

    const distance = walkingDistance(playerPosition, this.target);
    this.compassLabel.textContent =
      distance < 12 ? 'Near' : distance < 60 ? 'A short walk' : 'Across the world';
  }

  dispose(): void {
    this.minimap.dispose();
    this.root.remove();
  }

  private show(element: HTMLElement, transform: string): void {
    element.style.opacity = '1';
    element.style.transform = transform;
  }

  private hide(element: HTMLElement, transform: string): void {
    element.style.opacity = '0';
    element.style.transform = transform;
  }
}

function el(tag: string, cssText: string): HTMLElement {
  const element = document.createElement(tag);
  element.style.cssText = cssText;
  return element;
}

