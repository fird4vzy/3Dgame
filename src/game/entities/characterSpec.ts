/**
 * Character specifications.
 *
 * The humanoid builder is one piece of geometry code driven by these: palette,
 * proportions and a few feature switches. Adding a character is a spec, not a
 * second copy of the rig — which is also what lets the villagers stop being
 * capsules without duplicating anything.
 */

export interface CharacterPalette {
  skin: string;
  hair: string;
  /** Secondary hair tone; the sheets draw hair as two values, not one. */
  hairLift: string;
  jacket: string;
  jacketDark: string;
  /** The one bright note in the outfit. Never lifted — see PALETTE_LIFT. */
  accent: string;
  /** Emissive companion to `accent`, for lenses and trim. */
  glow: string;
  shirt: string;
  pants: string;
  boots: string;
  metal: string;
  leather: string;
}

export interface CharacterProportions {
  torsoLen: number;
  neckY: number;
  headR: number;
  shoulderX: number;
  upperArm: number;
  foreArm: number;
  hipX: number;
  thigh: number;
  shin: number;
  footLen: number;
}

export type HairStyle = 'swept' | 'long';
export type PackStyle = 'satchel' | 'backpack' | 'none';

export interface CharacterSpec {
  id: string;
  displayName: string;
  /** Overall height in metres, from the sheet. */
  height: number;
  palette: CharacterPalette;
  proportions: CharacterProportions;
  hair: HairStyle;
  pack: PackStyle;
  glasses: boolean;
  /** How brightly the lenses glow. Ren's are tech; Aria's are just glass. */
  lensGlow: number;
  /** Belt-mounted vials — Aria's silhouette detail from the sheet. */
  vials: boolean;
}

// ── Aria Chen ─────────────────────────────────────────────────────────────
// Relic Technician & Scout, 165 cm. Palette read from the concept sheet: a
// cool near-black hair mass, slate blue-grey layers, and one saturated teal
// running through jacket trim, knee pads, boots and gloves.

const ARIA_PALETTE: CharacterPalette = {
  skin: '#f0c9a8',
  hair: '#17161c',
  hairLift: '#2f2e3b',
  jacket: '#39434f',
  jacketDark: '#252c36',
  accent: '#3fd0cc',
  glow: '#7ff5ee',
  shirt: '#6f7681',
  pants: '#333c47',
  boots: '#1f242c',
  metal: '#8a9098',
  leather: '#3a3a44',
};

/**
 * 165 cm and lighter-framed than Ren.
 *
 * Not a uniform scale of the 180 cm rig: shrinking everything equally gives a
 * child's proportions. The limbs shorten more than the head, and the shoulders
 * narrow more than the hips.
 */
const ARIA_PROPORTIONS: CharacterProportions = {
  torsoLen: 0.47,
  neckY: 0.47,
  headR: 0.107,
  shoulderX: 0.152,
  upperArm: 0.275,
  foreArm: 0.255,
  hipX: 0.092,
  thigh: 0.365,
  shin: 0.345,
  footLen: 0.225,
};

export const ARIA_SPEC: CharacterSpec = {
  id: 'aria_chen',
  displayName: 'Aria Chen',
  height: 1.65,
  palette: ARIA_PALETTE,
  proportions: ARIA_PROPORTIONS,
  hair: 'long',
  pack: 'backpack',
  glasses: true,
  // Ordinary glasses catch a highlight; they are not a visor.
  lensGlow: 0.35,
  vials: true,
};

// ── Ren 'Cypher' Kairo ────────────────────────────────────────────────────
// Kept so the earlier character still builds from the same code path.

const REN_SHEET_PALETTE: CharacterPalette = {
  skin: '#d9a882',
  hair: '#241d19',
  hairLift: '#3b2d25',
  jacket: '#2b3430',
  jacketDark: '#1d2422',
  accent: '#3f9e73',
  glow: '#7dffc0',
  shirt: '#151918',
  pants: '#2a3230',
  boots: '#161a19',
  metal: '#6a7176',
  leather: '#4c3b2b',
};

const REN_PROPORTIONS: CharacterProportions = {
  torsoLen: 0.52,
  neckY: 0.52,
  headR: 0.113,
  shoulderX: 0.175,
  upperArm: 0.31,
  foreArm: 0.29,
  hipX: 0.095,
  thigh: 0.4,
  shin: 0.38,
  footLen: 0.25,
};

export const REN_SPEC: CharacterSpec = {
  id: 'ren_cypher',
  displayName: "Ren 'Cypher' Kairo",
  height: 1.8,
  palette: REN_SHEET_PALETTE,
  proportions: REN_PROPORTIONS,
  hair: 'swept',
  pack: 'satchel',
  glasses: true,
  lensGlow: 1.0,
  vials: false,
};

// ── the residents of Fennwick ─────────────────────────────────────────────
// Villagers were capsules with a cone for a nose. They are now the same rig as
// the player, which is the payoff for making the builder spec-driven: giving
// six people distinct silhouettes costs six palettes, not six models.

/** Vary a base palette without restating all twelve swatches. */
function recolour(base: CharacterPalette, over: Partial<CharacterPalette>): CharacterPalette {
  return { ...base, ...over };
}

const VILLAGER_BASE: CharacterPalette = {
  skin: '#e8bb95',
  hair: '#2a2119',
  hairLift: '#463629',
  jacket: '#5a5346',
  jacketDark: '#3e3930',
  accent: '#c98a4b',
  glow: '#ffcf8f',
  shirt: '#8d8375',
  pants: '#4a4438',
  boots: '#2e2a22',
  metal: '#7b7a74',
  leather: '#5a4432',
};

/**
 * Shorter and stockier than the couriers, so residents read as a different
 * *kind* of person at a glance rather than as recoloured protagonists.
 */
const VILLAGER_PROPORTIONS: CharacterProportions = {
  torsoLen: 0.44,
  neckY: 0.44,
  headR: 0.115,
  shoulderX: 0.165,
  upperArm: 0.26,
  foreArm: 0.24,
  hipX: 0.1,
  thigh: 0.34,
  shin: 0.32,
  footLen: 0.22,
};

interface VillagerLook {
  id: string;
  displayName: string;
  height: number;
  hair: HairStyle;
  pack: PackStyle;
  glasses: boolean;
  palette: Partial<CharacterPalette>;
}

/** One entry per named resident, matched to how they read in the dialogue. */
const VILLAGER_LOOKS: VillagerLook[] = [
  {
    id: 'odd',
    displayName: 'Postmaster Odd',
    height: 1.72,
    hair: 'swept',
    pack: 'satchel',
    glasses: true,
    palette: { jacket: '#4a5a68', jacketDark: '#33404b', accent: '#e0a24e', hair: '#6a6258' },
  },
  {
    id: 'mara',
    displayName: 'Mara',
    height: 1.63,
    hair: 'long',
    pack: 'none',
    glasses: false,
    palette: { jacket: '#7d4f42', jacketDark: '#5a382e', accent: '#e8a86a', hair: '#3d2418' },
  },
  {
    id: 'wren',
    displayName: 'Wren',
    height: 1.58,
    hair: 'long',
    pack: 'none',
    glasses: false,
    palette: { jacket: '#4e6b4f', jacketDark: '#374c39', accent: '#9ed77f', hair: '#20301f' },
  },
  {
    id: 'finn',
    displayName: 'Finn',
    height: 1.76,
    hair: 'swept',
    pack: 'backpack',
    glasses: true,
    palette: { jacket: '#4a5c66', jacketDark: '#33434b', accent: '#5ec8c0', hair: '#2b2b30' },
  },
  {
    id: 'sol',
    displayName: 'Sol',
    height: 1.68,
    hair: 'long',
    pack: 'none',
    glasses: false,
    palette: { jacket: '#4b5878', jacketDark: '#343e57', accent: '#8fb4e8', hair: '#4a4a52' },
  },
  {
    id: 'bea',
    displayName: 'Bea',
    height: 1.55,
    hair: 'swept',
    pack: 'none',
    glasses: true,
    palette: { jacket: '#6e6250', jacketDark: '#4d4438', accent: '#f0d9a8', hair: '#b9b2a4' },
  },
];

export const VILLAGER_SPECS: Record<string, CharacterSpec> = Object.fromEntries(
  VILLAGER_LOOKS.map((look) => [
    look.id,
    {
      id: `villager_${look.id}`,
      displayName: look.displayName,
      height: look.height,
      palette: recolour(VILLAGER_BASE, look.palette),
      proportions: VILLAGER_PROPORTIONS,
      hair: look.hair,
      pack: look.pack,
      glasses: look.glasses,
      // Residents are not tech scouts; their glasses are just glass.
      lensGlow: 0.15,
      vials: false,
    } satisfies CharacterSpec,
  ]),
);

