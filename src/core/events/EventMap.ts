/**
 * The single source of truth for every event in the game.
 *
 * Adding an event without declaring it here is a type error, and every handler
 * is checked against its payload. Naming: `domain:pastTenseFact` for things
 * that happened, `ui:requestX` for intents travelling the other way.
 *
 * Vector payloads are plain `{x,y,z}` so this file stays renderer-agnostic —
 * core/ must not import three (enforced by eslint.config.js).
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type SurfaceType = 'grass' | 'stone' | 'wood' | 'sand' | 'metal' | 'water';
export type DeviceKind = 'keyboard' | 'gamepad' | 'touch';

export interface EventMap {
  // ── engine ──────────────────────────────────────────────────────────────
  'engine:ready': void;
  'engine:contextLost': void;
  'engine:contextRestored': void;
  'viewport:resized': { width: number; height: number; dpr: number; portrait: boolean };
  'quality:changed': { tier: 'low' | 'medium' | 'high'; reason: 'auto' | 'user' };

  // ── assets & scenes ─────────────────────────────────────────────────────
  'asset:progress': { loaded: number; total: number };
  'scene:willEnter': { id: string };
  'scene:entered': { id: string };
  'scene:willExit': { id: string };

  // ── input ───────────────────────────────────────────────────────────────
  'input:deviceChanged': { device: DeviceKind };

  // ── game state ──────────────────────────────────────────────────────────
  // Typed as strings rather than the GameState union because core/ sits below
  // game/ and must not import from it.
  'state:changed': { from: string; to: string };
  'game:started': { isNewRun: boolean };
  'game:paused': void;
  'game:resumed': void;

  // ── ui intents (UI → game; the only direction the UI may push) ───────────
  'ui:requestStart': { newRun: boolean };
  'ui:requestPause': void;
  'ui:requestResume': void;
  'ui:requestQuit': void;
  'ui:settingChanged': { key: string; value: unknown };
  'ui:requestDialogueAdvance': void;
  'ui:requestInteract': void;

  // ── player ──────────────────────────────────────────────────────────────
  'player:spawned': { entityId: string };
  'player:stateChanged': { from: string; to: string };
  'player:landed': { impactSpeed: number; surface: SurfaceType };
  'player:footstep': { surface: SurfaceType; position: Vec3Like };
  'player:jumped': void;
  'player:glideStarted': void;
  'player:glideEnded': { airtime: number };

  // ── delivery ────────────────────────────────────────────────────────────
  'contract:available': { id: string };
  'contract:offered': { id: string; giver: string };
  'contract:accepted': { id: string; recipient: string; title: string };
  'parcel:picked': { parcelId: string };
  'parcel:dropped': { parcelId: string; position: Vec3Like };
  'parcel:warmthChanged': { parcelId: string; warmth: number };
  'delivery:completed': {
    contractId: string;
    rating: 'bright' | 'warm' | 'cool';
    seconds: number;
  };
  'run:completed': {
    seconds: number;
    ratings: Array<'bright' | 'warm' | 'cool'>;
    shards: number;
    districtsLit: number;
  };

  // ── world ───────────────────────────────────────────────────────────────
  'district:igniting': { district: string };
  'district:lit': { district: string; litCount: number };
  'district:entered': { district: string; displayName: string };
  'shard:collected': { id: string; total: number; of: number };
  'music:stemEnabled': { stem: string };

  // ── interaction & dialogue ──────────────────────────────────────────────
  'interaction:focusChanged': { id: string | null; prompt: string | null };
  'dialogue:started': { id: string };
  'dialogue:line': { speaker: string; text: string; index: number; total: number };
  'dialogue:ended': { id: string };

  // ── persistence ─────────────────────────────────────────────────────────
  'save:written': { bytes: number };
  'save:corrupt': { backupKey: string };
}

export type EventName = keyof EventMap;
