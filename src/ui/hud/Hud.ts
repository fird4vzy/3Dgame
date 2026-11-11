import * as THREE from 'three';
import type { EventBus } from '@core/events/EventBus';
import type { DeviceKind } from '@core/events/EventMap';
import { walkingDistance } from '@game/world/placement';
import { Minimap } from './Minimap';
import { icon } from '../icons';
import type { MinimapMarker } from '@game/world/mapMarkers';

const _toTarget = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

export interface Objective {
  title: string;
  hint: string;
  position: THREE.Vector3 | null;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** What to press, per device. */
const GLYPHS: Record<DeviceKind, Record<'interact' | 'camera' | 'journal', string>> = {
  keyboard: { interact: 'E', camera: 'C', journal: 'Tab' },
  gamepad: { interact: 'X', camera: 'Y', journal: 'Back' },
  touch: { interact: 'Tap', camera: 'Cam', journal: 'Book' },
};

/**
 * The in-game HUD, drawn as captions on a manga page.
 *
 * Four things are always answerable at a glance: what am I doing (the
 * objective, top left), which way is it (the compass, top centre), how am I
 * getting on (the journal chip, top right) and what is round me (the dial,
 * bottom right). Everything else appears when it has something to say and
 * leaves when it does not.
 */
export class Hud {
  private readonly minimap: Minimap;
  private markers: readonly MinimapMarker[] = [];
  private litFraction = 0;

  private readonly root: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly objectiveTitle: HTMLElement;
  private readonly objectiveHint: HTMLElement;
  private readonly compass: HTMLElement;
  private readonly compassNeedle: HTMLElement;
  private readonly compassLabel: HTMLElement;
  private readonly rank: HTMLElement;
  private readonly rankTitle: HTMLElement;
  private readonly rankCount: HTMLElement;
  private readonly rankBar: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly promptKey: HTMLElement;
  private readonly promptText: HTMLElement;
  private readonly parcel: HTMLElement;
  private readonly district: HTMLElement;
  private readonly course: HTMLElement;
  private readonly courseTime: HTMLElement;
  private readonly courseGates: HTMLElement;
  private readonly found: HTMLElement;
  private readonly foundSeal: HTMLElement;
  private readonly foundKicker: HTMLElement;
  private readonly foundTitle: HTMLElement;
  private readonly foundNote: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly viewfinder: HTMLElement;
  private readonly viewTag: HTMLElement;
  private readonly viewHelp: HTMLElement;
  private readonly flash: HTMLElement;

  private target: THREE.Vector3 | null = null;
  private objectiveKey = '';
  private districtTimer = 0;
  private foundTimer = 0;
  private controlsTimer = 45;
  private device: DeviceKind = 'keyboard';
  private photo = false;
  private readonly foundQueue: Array<{ kicker: string; title: string; note: string; seal?: string }> = [];

  constructor(
    parent: HTMLElement,
    private readonly bus: EventBus,
  ) {
    this.root = el('div', 'lp-hud');

    this.objective = el('div', 'lp-objective lp-chip');
    this.objective.append(
      el('div', 'lp-objective-kicker', 'Now'),
      (this.objectiveTitle = el('div', 'lp-objective-title')),
      (this.objectiveHint = el('div', 'lp-objective-hint')),
    );
    this.objective.dataset.hidden = 'true';

    this.compass = el('div', 'lp-compass lp-chip');
    this.compassNeedle = el('div', 'lp-compass-needle');
    this.compassNeedle.appendChild(icon('compass', 20, 'var(--lp-seal)'));
    this.compassLabel = el('div', 'lp-compass-label');
    this.compass.append(this.compassNeedle, this.compassLabel);
    this.compass.dataset.hidden = 'true';

    this.rank = el('button', 'lp-rank lp-chip');
    (this.rank as HTMLButtonElement).type = 'button';
    this.rank.setAttribute('aria-label', 'Open the journal');
    const rankText = el('div', '');
    this.rankTitle = el('div', 'lp-rank-title', 'New Arrival');
    this.rankCount = el('div', 'lp-rank-count', '0 / 25');
    const bar = el('div', 'lp-rank-bar');
    this.rankBar = document.createElement('i');
    bar.appendChild(this.rankBar);
    rankText.append(this.rankTitle, this.rankCount, bar);
    this.rank.append(el('span', 'lp-seal lp-rank-seal', '帳'), rankText);
    this.rank.addEventListener('click', () => this.bus.emit('ui:requestJournal'));

    this.prompt = el('div', 'lp-prompt lp-chip');
    this.promptKey = el('span', 'lp-key', 'E');
    this.promptText = el('span', '');
    this.prompt.append(this.promptKey, this.promptText);

    // Warmth is shown as the parcel's colour, never as a bar: a draining meter
    // would turn a gentle bonus into pressure.
    this.parcel = el('div', 'lp-parcel');
    this.parcel.appendChild(icon('parcel', 22, 'rgba(34,28,43,.85)'));

    this.district = el('div', 'lp-district');

    this.course = el('div', 'lp-course lp-chip');
    this.course.append(
      (this.courseTime = el('div', 'lp-course-time', '0.0')),
      (this.courseGates = el('div', 'lp-course-gates', '')),
    );

    this.found = el('div', 'lp-found lp-chip');
    this.foundSeal = el('span', 'lp-seal', '済');
    const foundText = el('div', '');
    foundText.append(
      (this.foundKicker = el('div', 'lp-found-kicker')),
      (this.foundTitle = el('div', 'lp-found-title')),
      (this.foundNote = el('div', 'lp-found-note')),
    );
    this.found.append(this.foundSeal, foundText);

    this.controls = el('div', 'lp-controls lp-chip');
    this.renderControls();

    this.viewfinder = el('div', 'lp-viewfinder');
    this.viewTag = el('div', 'lp-viewfinder-tag lp-chip');
    this.viewHelp = el('div', 'lp-viewfinder-help lp-chip');
    this.viewfinder.append(el('div', 'lp-viewfinder-frame'), this.viewTag, this.viewHelp);
    this.flash = el('div', 'lp-flash');

    this.minimap = new Minimap(this.root);
    this.root.append(
      this.objective,
      this.compass,
      this.rank,
      this.course,
      this.prompt,
      this.parcel,
      this.district,
      this.found,
      this.controls,
      this.viewfinder,
      this.flash,
    );
    parent.appendChild(this.root);

    this.subscribe();
  }

  private subscribe(): void {
    this.bus.on('delivery:completed', () => {
      this.parcel.dataset.shown = 'false';
    });

    this.bus.on('interaction:focusChanged', ({ prompt }) => {
      if (prompt && !this.photo) {
        this.promptText.textContent = prompt;
        this.prompt.dataset.shown = 'true';
      } else {
        this.prompt.dataset.shown = 'false';
      }
    });

    this.bus.on('parcel:picked', () => {
      this.parcel.dataset.shown = 'true';
    });

    this.bus.on('parcel:warmthChanged', ({ warmth }) => {
      // Amber when fresh, cooling toward blue — the only warmth readout.
      const colour = new THREE.Color('#69a5d8').lerp(new THREE.Color('#f6bd60'), warmth);
      this.parcel.style.background = `#${colour.getHexString()}`;
    });

    this.bus.on('district:entered', ({ displayName }) => {
      this.district.replaceChildren(el('small', '', 'Now entering'), document.createTextNode(displayName));
      this.district.dataset.shown = 'true';
      this.districtTimer = 2.6;
    });

    this.bus.on('dialogue:started', () => this.setVisible(false));
    this.bus.on('dialogue:ended', () => this.setVisible(true));

    this.bus.on('journal:changed', ({ points, total, rank }) => this.setJournal(points, total, rank));
    this.bus.on('journal:found', ({ kind, title, note, seal }) => {
      const kicker =
        kind === 'stamp' ? 'Stamped' : kind === 'souvenir' ? 'Keepsake found' : kind === 'postcard' ? 'Postcard' : 'Journal';
      this.queueFound({ kicker, title, note, ...(seal ? { seal } : {}) });
    });
    this.bus.on('journal:rankUp', ({ title, reward, note }) => {
      this.queueFound({
        kicker: 'New standing',
        title: reward ? `${title} — ${reward}` : title,
        note: note ?? 'The valley knows your name now.',
        seal: '昇',
      });
    });

    this.bus.on('course:started', ({ name, gates }) => {
      this.course.dataset.shown = 'true';
      this.courseTime.textContent = '0.0';
      this.courseGates.textContent = `${name} · 0 / ${gates}`;
    });
    this.bus.on('course:tick', ({ seconds, gate, gates }) => {
      this.courseTime.textContent = seconds.toFixed(1);
      this.courseGates.textContent = `Lantern ${Math.min(gate + 1, gates)} of ${gates}`;
    });
    this.bus.on('course:finished', ({ seconds, medal, best }) => {
      this.course.dataset.shown = 'false';
      this.queueFound({
        kicker: best ? 'New best time' : 'Round finished',
        title: `${seconds.toFixed(1)} s${medal ? ` — ${medal} medal` : ''}`,
        note: medal ? 'Every lantern lit before it could go out.' : 'No medal this time. The bell will ring again.',
        seal: medal === 'gold' ? '金' : medal === 'silver' ? '銀' : medal === 'bronze' ? '銅' : '走',
      });
    });
    this.bus.on('course:abandoned', () => {
      this.course.dataset.shown = 'false';
    });

    this.bus.on('photo:modeChanged', ({ active }) => {
      this.photo = active;
      this.viewfinder.dataset.shown = String(active);
      this.prompt.dataset.shown = 'false';
      this.setViewTag(null, false);
      this.renderViewHelp();
    });
    this.bus.on('photo:framed', ({ title, taken }) => this.setViewTag(title, taken));
    this.bus.on('photo:taken', () => {
      this.flash.dataset.fire = 'false';
      void this.flash.offsetWidth;
      this.flash.dataset.fire = 'true';
    });

    this.bus.on('input:deviceChanged', ({ device }) => {
      this.device = device;
      this.promptKey.textContent = GLYPHS[device].interact;
      this.renderControls();
      this.renderViewHelp();
    });
  }

  /** What the player is doing now. Null clears it. */
  setObjective(objective: Objective | null): void {
    this.target = objective?.position ?? null;
    this.compass.dataset.hidden = String(this.target === null);
    const key = objective ? `${objective.title}|${objective.hint}` : '';
    if (key === this.objectiveKey) return;
    this.objectiveKey = key;
    this.objective.dataset.hidden = String(objective === null);
    if (!objective) return;
    this.objectiveTitle.textContent = objective.title;
    this.objectiveHint.textContent = objective.hint;
    // A new objective announces itself once.
    this.objective.classList.remove('lp-objective-flash');
    void this.objective.offsetWidth;
    this.objective.classList.add('lp-objective-flash');
  }

  setJournal(points: number, total: number, rank: string): void {
    this.rankTitle.textContent = rank;
    this.rankCount.textContent = `${points} / ${total}`;
    this.rankBar.style.width = `${Math.round((points / Math.max(1, total)) * 100)}%`;
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
      if (this.districtTimer <= 0) this.district.dataset.shown = 'false';
    }
    if (this.controlsTimer > 0) {
      this.controlsTimer -= dt;
      if (this.controlsTimer <= 0) this.controls.dataset.hidden = 'true';
    }
    if (this.foundTimer > 0) {
      this.foundTimer -= dt;
      if (this.foundTimer <= 0) {
        this.found.dataset.shown = 'false';
        // A beat between cards, so two finds do not read as one.
        if (this.foundQueue.length > 0) this.foundTimer = -0.35;
      }
    } else if (this.foundTimer < 0) {
      this.foundTimer = Math.min(0, this.foundTimer + dt);
      if (this.foundTimer === 0) this.showNextFound();
    }

    this.minimap.setVisible(!this.photo);
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
    this.compassNeedle.style.transform = `rotate(${(angle * 180) / Math.PI}deg)`;

    const distance = walkingDistance(playerPosition, this.target);
    this.compassLabel.textContent = distance < 4 ? 'Here' : `${Math.round(distance)} m`;
  }

  dispose(): void {
    this.minimap.dispose();
    this.root.remove();
  }

  private queueFound(card: { kicker: string; title: string; note: string; seal?: string }): void {
    this.foundQueue.push(card);
    if (this.foundTimer === 0) this.showNextFound();
  }

  private showNextFound(): void {
    const card = this.foundQueue.shift();
    if (!card) return;
    this.foundKicker.textContent = card.kicker;
    this.foundTitle.textContent = card.title;
    this.foundNote.textContent = card.note;
    this.foundSeal.textContent = card.seal ?? '済';
    this.foundSeal.classList.remove('lp-seal--stamped');
    void this.foundSeal.offsetWidth;
    this.foundSeal.classList.add('lp-seal--stamped');
    this.found.dataset.shown = 'true';
    this.foundTimer = 4.2;
  }

  private setViewTag(title: string | null, taken: boolean): void {
    if (!title) {
      this.viewTag.textContent = 'Nothing for the journal in frame';
      this.viewTag.dataset.state = 'none';
    } else {
      this.viewTag.textContent = taken ? `${title} — already in the journal` : `${title} — take it!`;
      this.viewTag.dataset.state = taken ? 'old' : 'new';
    }
  }

  private key(label: string, text: string): HTMLElement {
    const item = document.createElement('span');
    item.append(el('span', 'lp-key', label), document.createTextNode(text));
    return item;
  }

  private renderControls(): void {
    const g = GLYPHS[this.device];
    const items =
      this.device === 'gamepad'
        ? [this.key('L', 'Move'), this.key('R', 'Look'), this.key('A', 'Jump'), this.key(g.interact, 'Talk'), this.key(g.camera, 'Camera'), this.key(g.journal, 'Journal')]
        : [this.key('WASD', 'Move'), this.key('Shift', 'Walk'), this.key('Space', 'Jump'), this.key(g.interact, 'Talk'), this.key(g.camera, 'Camera'), this.key(g.journal, 'Journal')];
    this.controls.replaceChildren(...items);
  }

  private renderViewHelp(): void {
    const g = GLYPHS[this.device];
    this.viewHelp.replaceChildren(this.key(g.interact, 'Take picture'), this.key(g.camera, 'Put away'));
  }
}
