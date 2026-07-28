/**
 * Content types and the shipped content set.
 *
 * Adding a district, contract or NPC must require zero code changes — that is
 * the test for whether the architecture actually delivered on "easy to expand"
 * (docs/05-folder-structure.md, rule 5). Everything below is data; the systems
 * in `game/systems` interpret it.
 *
 * Positions are authored as latitude/longitude in degrees. Nobody can hand-edit
 * a Cartesian point on a sphere, and lat/lon diffs are readable in review.
 */

export type DistrictId = 'landing' | 'bramblewood' | 'coil' | 'tidebreak' | 'spire';
export type Rating = 'bright' | 'warm' | 'cool';
export type ParcelWeight = 'light' | 'heavy';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface DistrictDef {
  id: DistrictId;
  displayName: string;
  centre: GeoPoint;
  /** Angular radius in degrees; districts claim the nearest centre. */
  radius: number;
  /** Colour the district settles to once lit. */
  litColour: string;
  /** Colour while dormant — desaturated, cooler. */
  darkColour: string;
  /** Music stem enabled on ignition. */
  stem: string;
  /** How many street lamps to scatter. */
  lampCount: number;
}

export interface NpcDef {
  id: string;
  displayName: string;
  at: GeoPoint;
  district: DistrictId;
  /** Tint for the placeholder NPC body, so they read apart at a glance. */
  colour: string;
}

export interface DialogueNode {
  speaker: string;
  text: string;
}

export interface ContractDef {
  id: string;
  title: string;
  /** One-line hint shown on the contract card. */
  hint: string;
  giver: string;
  recipient: string;
  district: DistrictId;
  parcel: { weight: ParcelWeight; warmthSeconds: number; colour: string };
  prerequisites: string[];
  onAccept: DialogueNode[];
  onDeliver: DialogueNode[];
}

// ── districts ─────────────────────────────────────────────────────────────
// Spread around the sphere so any two are roughly a 90-second walk apart.

export const DISTRICTS: DistrictDef[] = [
  {
    id: 'landing',
    displayName: 'The Landing',
    centre: { lat: 62, lon: 30 },
    radius: 42,
    litColour: '#e8a33a',
    darkColour: '#3d4155',
    stem: 'bass',
    lampCount: 7,
  },
  {
    id: 'bramblewood',
    displayName: 'Bramblewood',
    centre: { lat: 14, lon: 96 },
    radius: 44,
    litColour: '#6fbf73',
    darkColour: '#2f4440',
    stem: 'guitar',
    lampCount: 6,
  },
  {
    id: 'coil',
    displayName: 'The Coil',
    centre: { lat: -22, lon: 170 },
    radius: 44,
    litColour: '#5ec8c0',
    darkColour: '#33404a',
    stem: 'arp',
    lampCount: 8,
  },
  {
    id: 'tidebreak',
    displayName: 'Tidebreak',
    centre: { lat: -46, lon: -110 },
    radius: 46,
    litColour: '#69a5d8',
    darkColour: '#2e3b4d',
    stem: 'strings',
    lampCount: 6,
  },
  {
    id: 'spire',
    displayName: 'The Spire',
    centre: { lat: 76, lon: -128 },
    radius: 40,
    litColour: '#f6e0b0',
    darkColour: '#3a3d52',
    stem: 'choir',
    lampCount: 5,
  },
];

// ── cast ──────────────────────────────────────────────────────────────────

export const NPCS: NpcDef[] = [
  { id: 'odd', displayName: 'Postmaster Odd', at: { lat: 64, lon: 26 }, district: 'landing', colour: '#d8c58c' },
  { id: 'mara', displayName: 'Mara', at: { lat: 55, lon: 44 }, district: 'landing', colour: '#c8956f' },
  { id: 'wren', displayName: 'Wren', at: { lat: 16, lon: 92 }, district: 'bramblewood', colour: '#8fc98f' },
  { id: 'finn', displayName: 'Finn', at: { lat: -20, lon: 166 }, district: 'coil', colour: '#7fb8c8' },
  { id: 'sol', displayName: 'Sol', at: { lat: -44, lon: -114 }, district: 'tidebreak', colour: '#9aa8d8' },
  { id: 'bea', displayName: 'Bea', at: { lat: 74, lon: -124 }, district: 'spire', colour: '#e8d8a8' },
];

// ── contracts ─────────────────────────────────────────────────────────────
// Five deliveries, one per district, each a self-contained vignette. Dialogue
// is two or three lines: staging carries the story, not walls of text.

export const CONTRACTS: ContractDef[] = [
  {
    id: 'c01_landing',
    title: 'A lamp for the plaza',
    hint: 'Mara is waiting by the mailboxes.',
    giver: 'odd',
    recipient: 'mara',
    district: 'landing',
    parcel: { weight: 'light', warmthSeconds: 240, colour: '#e8a33a' },
    prerequisites: [],
    onAccept: [
      { speaker: 'Postmaster Odd', text: 'You came. Good. The star is going out and nobody has told the kettle.' },
      { speaker: 'Postmaster Odd', text: 'Take this lumen to Mara, by the mailboxes. Walk slow. It keeps better warm.' },
    ],
    onDeliver: [
      { speaker: 'Mara', text: 'Oh — you carried it all the way? It is still warm.' },
      { speaker: 'Mara', text: 'Watch the plaza. It remembers what it looked like.' },
    ],
  },
  {
    id: 'c02_bramblewood',
    title: 'A letter that must be read aloud',
    hint: 'Wren is under the round trees.',
    giver: 'odd',
    recipient: 'wren',
    district: 'bramblewood',
    parcel: { weight: 'light', warmthSeconds: 220, colour: '#6fbf73' },
    prerequisites: ['c01_landing'],
    onAccept: [
      { speaker: 'Postmaster Odd', text: 'This one is for Wren, in the wood. She cannot read it herself.' },
      { speaker: 'Postmaster Odd', text: 'So you will have to. That is the delivery.' },
    ],
    onDeliver: [
      { speaker: 'Wren', text: 'Read it? Ah. You do not have to pretend it says something kinder.' },
      { speaker: 'Wren', text: '...It does say that? Then read it twice.' },
    ],
  },
  {
    id: 'c03_coil',
    title: 'The parcel is the fuel',
    hint: 'Finn is down among the pipes.',
    giver: 'odd',
    recipient: 'finn',
    district: 'coil',
    parcel: { weight: 'heavy', warmthSeconds: 200, colour: '#5ec8c0' },
    prerequisites: ['c02_bramblewood'],
    onAccept: [
      { speaker: 'Postmaster Odd', text: 'Heavy, this one. Finn needs it at the core before the pressure drops.' },
      { speaker: 'Postmaster Odd', text: 'You will not be able to glide with it. Sorry.' },
    ],
    onDeliver: [
      { speaker: 'Finn', text: 'You brought the whole cell up here on foot. On foot!' },
      { speaker: 'Finn', text: 'Stand back. The Coil wakes up loud.' },
    ],
  },
  {
    id: 'c04_tidebreak',
    title: 'For someone who already left',
    hint: 'Sol is on the boardwalk over the sea.',
    giver: 'odd',
    recipient: 'sol',
    district: 'tidebreak',
    parcel: { weight: 'light', warmthSeconds: 260, colour: '#69a5d8' },
    prerequisites: ['c03_coil'],
    onAccept: [
      { speaker: 'Postmaster Odd', text: 'The address on this one moved away four winters ago.' },
      { speaker: 'Postmaster Odd', text: 'Sol still walks that boardwalk every evening. Use your judgement.' },
    ],
    onDeliver: [
      { speaker: 'Sol', text: 'That is not my name on it.' },
      { speaker: 'Sol', text: '...but I will keep the light. She would have wanted the pier lit.' },
    ],
  },
  {
    id: 'c05_spire',
    title: 'The last lumen',
    hint: 'Bea is at the top of the old lighthouse.',
    giver: 'odd',
    recipient: 'bea',
    district: 'spire',
    parcel: { weight: 'light', warmthSeconds: 300, colour: '#f6e0b0' },
    prerequisites: ['c04_tidebreak'],
    onAccept: [
      { speaker: 'Postmaster Odd', text: 'Last one. The Spire, and the long climb.' },
      { speaker: 'Postmaster Odd', text: 'When it catches, the whole planet will see it. Go on.' },
    ],
    onDeliver: [
      { speaker: 'Bea', text: 'I kept the wick trimmed for eleven years waiting for you.' },
      { speaker: 'Bea', text: 'Look down. Look at what you did on the way here.' },
    ],
  },
];

export const districtById = (id: DistrictId): DistrictDef =>
  DISTRICTS.find((d) => d.id === id) ?? DISTRICTS[0]!;

export const npcById = (id: string): NpcDef | undefined => NPCS.find((n) => n.id === id);
