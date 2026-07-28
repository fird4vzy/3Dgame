/**
 * Gameplay code asks for *actions*, never for keys. Rebinding, gamepad support
 * and touch controls then become backend concerns rather than gameplay changes.
 */
export type Axis2DAction = 'move' | 'look';
export type ButtonAction = 'run' | 'jump' | 'interact' | 'emote' | 'pause';

export interface Vec2 {
  x: number;
  y: number;
}

export const DEFAULT_KEY_BINDINGS: Record<ButtonAction, string[]> = {
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  interact: ['KeyE', 'KeyF'],
  emote: ['KeyQ'],
  pause: ['Escape'],
};

export const MOVE_KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
} as const;
