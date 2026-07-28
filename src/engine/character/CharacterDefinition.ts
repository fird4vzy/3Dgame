/**
 * The character asset contract (docs/06-asset-specification.md §6.2).
 *
 * The game never references a mesh, bone or clip by hard-coded name. Every
 * character is described by one of these manifests, which maps *our* canonical
 * names onto whatever the supplied art actually calls things. Swapping in a new
 * character is therefore a JSON edit, not an integration project.
 */

/** Canonical clip names. Gameplay code only ever uses these. */
export const CLIP_NAMES = [
  'idle',
  'idle_look',
  'walk',
  'run',
  'jump_start',
  'fall',
  'land',
  'glide_in',
  'glide',
  'glide_out',
  'carry_idle',
  'carry_walk',
  'carry_run',
  'handoff',
  'sit',
  'celebrate',
  'emote_wave',
  'emote_cheer',
  'emote_laugh',
  'emote_sad',
  'emote_love',
  'emote_think',
  'emote_dance',
  'emote_sleep',
  'emote_shrug',
  'emote_thumbsup',
] as const;

export type ClipName = (typeof CLIP_NAMES)[number];

/** Canonical attachment points. */
export const SOCKET_NAMES = ['hand_R', 'hand_L', 'back', 'head'] as const;
export type SocketName = (typeof SOCKET_NAMES)[number];

export type CosmeticSlot = 'hair' | 'top' | 'bottom' | 'shoes' | 'eyes' | 'accessory';

/** How the character's art is delivered. */
export type CharacterSourceKind = 'gltf' | 'spritesheet';

export interface GltfSource {
  kind: 'gltf';
  url: string;
  /** Corrective scale if the rig was not exported in metres. */
  scale?: number;
  /** Corrective yaw in degrees if the rig does not face +Z. */
  yawOffset?: number;
  /** Corrective vertical offset if the feet are not at the origin. */
  yOffset?: number;
}

/** One rectangular region of a sprite atlas, in pixels. */
export interface SpriteFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Pivot within the frame, normalised (0,0 = top-left, 1,1 = bottom-right).
   * Characters should pivot at the feet: {x: 0.5, y: 1}.
   */
  pivot?: { x: number; y: number };
}

export interface SpriteAnimation {
  /** Frame keys into `frames`, played in order. */
  frames: string[];
  fps?: number;
  loop?: boolean;
  /**
   * Optional turnaround set for a third-person camera that can orbit.
   *
   * Five frame keys ordered front → back as the viewer walks around the
   * character's right side: `[front, front34, side, back34, back]`. The left
   * half of the circle is covered by mirroring, which is why only five are
   * needed. When present, this overrides `frames` for a static pose.
   */
  directions?: [string, string, string, string, string];
}

export interface SpritesheetSource {
  kind: 'spritesheet';
  /** Atlas texture. Must have a real alpha channel — see the loader's warning. */
  url: string;
  /** Named rectangles within the atlas. */
  frames: Record<string, SpriteFrame>;
  /** Canonical clip name → sprite animation. */
  animations?: Partial<Record<ClipName, SpriteAnimation>>;
  /**
   * World height of the character in metres. The quad is sized from this and
   * the frame's aspect ratio, so art resolution never affects world scale.
   */
  worldHeight?: number;
  /**
   * `billboard` keeps the quad facing the camera (classic 2D-in-3D).
   * `upright` keeps it aligned to the surface normal and only yaws — correct
   * for a spherical world, where a pure billboard shears as you cross a hill.
   */
  facing?: 'billboard' | 'upright';
}

export type CharacterSource = GltfSource | SpritesheetSource;

export interface CharacterDefinition {
  id: string;
  displayName: string;
  source: CharacterSource;
  /** Character height in metres. Drives capsule sizing and socket placement. */
  height: number;
  /** OUR clip name → THEIR clip name (glTF) or unused (spritesheet). */
  clips?: Partial<Record<ClipName, string>>;
  /** OUR socket name → THEIR bone or node name. */
  sockets?: Partial<Record<SocketName, string>>;
  /** Cosmetic slot → mesh name on the shared skeleton. */
  cosmeticSlots?: Partial<Record<CosmeticSlot, string>>;
  materials?: {
    outline?: boolean;
    celBands?: number;
    rimStrength?: number;
  };
  /**
   * Graceful degradation: OUR clip name → another OUR clip name to substitute.
   * This is what lets a partial rig (idle/walk/run only) still run the game
   * instead of throwing on the first glide.
   */
  fallback?: {
    clips?: Partial<Record<ClipName, ClipName>>;
  };
  /** Free-form notes carried from the art brief. Never read by code. */
  notes?: Record<string, string>;
}

/** Structural validation with actionable messages. Returns problems found. */
export function validateCharacterDefinition(def: CharacterDefinition): string[] {
  const problems: string[] = [];

  if (!def.id) problems.push('missing "id"');
  if (!def.height || def.height <= 0) problems.push('"height" must be a positive number of metres');

  if (!def.source) {
    problems.push('missing "source"');
    return problems;
  }

  if (def.source.kind === 'gltf') {
    if (!def.source.url) problems.push('gltf source needs a "url"');
  } else if (def.source.kind === 'spritesheet') {
    if (!def.source.url) problems.push('spritesheet source needs a "url"');
    if (!def.source.frames || Object.keys(def.source.frames).length === 0) {
      problems.push('spritesheet source needs at least one entry in "frames"');
    }
    for (const [name, anim] of Object.entries(def.source.animations ?? {})) {
      for (const frame of anim?.frames ?? []) {
        if (!def.source.frames?.[frame]) {
          problems.push(`animation "${name}" references unknown frame "${frame}"`);
        }
      }
    }
  } else {
    problems.push(`unknown source kind "${(def.source as { kind: string }).kind}"`);
  }

  return problems;
}
