/**
 * Everything there is to do on the planet besides the five deliveries.
 *
 * Data only, like `content.ts`: a new stamp, keepsake, postcard or course is an
 * entry here and nothing else. Positions are latitude and longitude; anything
 * that lands in the sea is moved to the nearest dry ground when the world is
 * built, so a point only has to be roughly right.
 *
 * The frame for all of it is the festival. The courier has arrived on the day
 * of the lantern festival to find the valley's lights out; the deliveries
 * relight it, and the journal — the stamp book every traveller carries — is
 * what she fills on the way.
 */
import type { DistrictId, GeoPoint } from './content';

/** A stamp stand at a place worth having been to. */
export interface StampDef {
  id: string;
  /** The place, as the journal names it. */
  name: string;
  /** The character cut into the stamp. */
  seal: string;
  at: GeoPoint;
  district: DistrictId;
  /** One line in the journal before it is found. */
  hint: string;
  /** One line once it is. */
  note: string;
}

export const STAMPS: StampDef[] = [
  {
    id: 'stamp_post',
    name: 'The Post Office',
    seal: '郵',
    at: { lat: 66.2, lon: 22.5 },
    district: 'landing',
    hint: 'Where every journey on this planet starts.',
    note: 'Odd has stamped every letter here for forty years. He let you do your own.',
  },
  {
    id: 'stamp_shrine',
    name: 'Bramblewood Shrine',
    seal: '社',
    at: { lat: 13.2, lon: 98.2 },
    district: 'bramblewood',
    hint: 'Through three red gates, under the maples.',
    note: 'The gates get smaller as you walk in. It makes the path feel longer than it is.',
  },
  {
    id: 'stamp_spring',
    name: 'The Coil Springs',
    seal: '湯',
    at: { lat: -19.5, lon: 173.5 },
    district: 'coil',
    hint: 'Follow the steam.',
    note: 'The water comes up warm from the core. Finn says it has never once been cold.',
  },
  {
    id: 'stamp_shore',
    name: 'Tidebreak Shore',
    seal: '海',
    at: { lat: -47.5, lon: -106.5 },
    district: 'tidebreak',
    hint: 'Where the gate stands in the water.',
    note: 'At low tide you could walk out to the gate. Nobody does. It is not for walking through.',
  },
  {
    id: 'stamp_light',
    name: 'The Old Lighthouse',
    seal: '灯',
    at: { lat: 72.5, lon: -133 },
    district: 'spire',
    hint: 'The tallest thing on the planet.',
    note: 'Bea trims the wick every evening, lit or not.',
  },
  {
    id: 'stamp_view',
    name: 'The Mountain Lookout',
    seal: '山',
    at: { lat: 38, lon: 62 },
    district: 'landing',
    hint: 'Between the village and the wood, on open ground.',
    note: 'Nobody here has been to the mountain. Everybody knows which way it is.',
  },
];

/** A keepsake somebody mislaid. */
export interface SouvenirDef {
  id: string;
  name: string;
  /** What it is, for the journal. */
  note: string;
  /** A nudge toward it, shown until it is found. */
  hint: string;
  at: GeoPoint;
  /** Which of the simple shapes it is drawn as. */
  shape: 'daruma' | 'cat' | 'kokeshi' | 'chime' | 'charm' | 'fan' | 'top' | 'fox';
  colour: string;
}

export const SOUVENIRS: SouvenirDef[] = [
  {
    id: 'omiyage_daruma',
    name: 'Daruma',
    note: 'One eye painted in. Somebody made a wish and has not finished it yet.',
    hint: 'Behind the post office, where the grass is long.',
    at: { lat: 67.5, lon: 31 },
    shape: 'daruma',
    colour: '#d6402f',
  },
  {
    id: 'omiyage_cat',
    name: 'Beckoning Cat',
    note: 'It waves at nobody in particular. The cats here ignore it.',
    hint: 'A shop without its lucky cat, at the edge of the village.',
    at: { lat: 52, lon: 20 },
    shape: 'cat',
    colour: '#f3ede0',
  },
  {
    id: 'omiyage_kokeshi',
    name: 'Kokeshi Doll',
    note: 'Turned from one piece of maple. No arms, no legs, perfectly content.',
    hint: 'Left at the foot of the innermost gate.',
    at: { lat: 17.5, lon: 99.5 },
    shape: 'kokeshi',
    colour: '#e9c9a0',
  },
  {
    id: 'omiyage_chime',
    name: 'Wind Chime',
    note: 'Glass, with a paper tail. It only rings when you are not listening for it.',
    hint: 'It blew down from somewhere in the wood, to the east.',
    at: { lat: 6, lon: 112 },
    shape: 'chime',
    colour: '#8fd0e0',
  },
  {
    id: 'omiyage_charm',
    name: 'Travel Charm',
    note: 'For safe roads. Whoever dropped it was a long way from home.',
    hint: 'By the hottest spring in the Coil.',
    at: { lat: -25.5, lon: 165 },
    shape: 'charm',
    colour: '#c9463a',
  },
  {
    id: 'omiyage_fan',
    name: 'Paper Fan',
    note: 'Painted with a wave. It has been opened and closed ten thousand times.',
    hint: 'On the sand, above the tide line.',
    at: { lat: -41, lon: -120 },
    shape: 'fan',
    colour: '#f4e6c8',
  },
  {
    id: 'omiyage_top',
    name: 'Spinning Top',
    note: 'Still painted in three colours that become one when it spins.',
    hint: 'Halfway up the long climb to the lighthouse.',
    at: { lat: 80, lon: -110 },
    shape: 'top',
    colour: '#e0a030',
  },
  {
    id: 'omiyage_fox',
    name: 'Fox Mask',
    note: 'For the festival. It was waiting to be worn tonight.',
    hint: 'Out in the wild ground, where nobody lives.',
    at: { lat: -5, lon: 40 },
    shape: 'fox',
    colour: '#f6f1ea',
  },
];

/** A picture worth sending home. */
export interface PostcardDef {
  id: string;
  title: string;
  /** What to point the camera at, as the journal asks for it. */
  brief: string;
  /** What must be in frame. */
  subject:
    | { kind: 'mountain' }
    | { kind: 'landmark'; landmark: 'lighthouse' | 'seaTorii' | 'shrine' }
    | { kind: 'cat' }
    | { kind: 'resident'; npc: string };
  /** Metres within which the subject must be, for anything on the planet. */
  within?: number;
}

export const POSTCARDS: PostcardDef[] = [
  { id: 'card_mountain', title: 'The Mountain', brief: 'Fuji, with nothing in the way.', subject: { kind: 'mountain' } },
  {
    id: 'card_lighthouse',
    title: 'The Lighthouse',
    brief: 'The whole tower in one picture.',
    subject: { kind: 'landmark', landmark: 'lighthouse' },
    within: 45,
  },
  {
    id: 'card_torii',
    title: 'The Gate in the Sea',
    brief: 'The red gate, standing in the water.',
    subject: { kind: 'landmark', landmark: 'seaTorii' },
    within: 40,
  },
  {
    id: 'card_shrine',
    title: 'The Shrine',
    brief: 'The hall at the end of the gates.',
    subject: { kind: 'landmark', landmark: 'shrine' },
    within: 30,
  },
  { id: 'card_cat', title: 'A Local', brief: 'Any cat that will hold still.', subject: { kind: 'cat' }, within: 7 },
  {
    id: 'card_odd',
    title: 'The Postmaster',
    brief: 'Odd, at his post.',
    subject: { kind: 'resident', npc: 'odd' },
    within: 9,
  },
];

/** A timed course: light a line of lanterns before they go out. */
export interface CourseDef {
  id: string;
  name: string;
  /** Where the starting bell stands. */
  start: GeoPoint;
  /** The lanterns, in order. */
  gates: GeoPoint[];
  /** Seconds for each medal. */
  gold: number;
  silver: number;
  bronze: number;
}

export const COURSES: CourseDef[] = [
  {
    id: 'course_village',
    name: 'The Lamplighter’s Round',
    start: { lat: 60, lon: 34 },
    gates: [
      { lat: 56, lon: 50 },
      { lat: 47, lon: 44 },
      { lat: 45, lon: 28 },
      { lat: 52, lon: 12 },
      { lat: 63, lon: 6 },
      { lat: 70, lon: 24 },
      { lat: 61.5, lon: 36 },
    ],
    gold: 34,
    silver: 44,
    bronze: 60,
  },
];

export type Medal = 'gold' | 'silver' | 'bronze';

export function medalFor(course: CourseDef, seconds: number): Medal | null {
  if (seconds <= course.gold) return 'gold';
  if (seconds <= course.silver) return 'silver';
  if (seconds <= course.bronze) return 'bronze';
  return null;
}

/** What a resident says when there is no parcel between you. */
export interface SmallTalk {
  /** Before their own district is lit. */
  dark: string[];
  /** After. */
  lit: string[];
}

export const SMALL_TALK: Record<string, SmallTalk> = {
  odd: {
    dark: [
      'Lanterns out on festival day. In forty years, never.',
      'Take your time between rounds. The stamp book in your bag is not for decoration.',
    ],
    lit: [
      'Look at that. The plaza remembers.',
      'There is a round the old lamplighter used to run — ring the bell east of here, if your legs are up to it.',
    ],
  },
  mara: {
    dark: ['I sort the mail by feel when the lamps are out. I am usually right.'],
    lit: ['I can read the addresses again. Half of them were wrong all along.'],
  },
  wren: {
    dark: ['The wood is loud when it is dark. You get used to it.'],
    lit: ['The gates look red again. I had been telling the children they were grey.'],
  },
  finn: {
    dark: ['Pressure is dropping. Do not stand on anything that hisses.'],
    lit: ['Warm pipes, warm water, warm feet. That is the whole of engineering.'],
  },
  sol: {
    dark: ['I walk the boards every evening. Somebody has to.'],
    lit: ['You can see the gate from here now. She always said you would.'],
  },
  bea: {
    dark: ['It is a long way up for a short conversation. Sit a minute.'],
    lit: ['From the gallery you can count every lamp on the planet. I have.'],
  },
};

/** The courier's standing, by how full the journal is. */
export interface RankDef {
  /** Journal entries needed. */
  at: number;
  title: string;
  /** What reaching it gives her, if anything. */
  reward?: { id: 'compass' | 'geta'; name: string; note: string };
}

export const RANKS: RankDef[] = [
  { at: 0, title: 'New Arrival' },
  {
    at: 5,
    title: 'Courier',
    reward: {
      id: 'compass',
      name: 'Lumen Compass',
      note: 'Shards and keepsakes now show on your dial.',
    },
  },
  {
    at: 12,
    title: 'Trusted Courier',
    reward: {
      id: 'geta',
      name: 'Wind Sandals',
      note: 'You walk and run a little faster.',
    },
  },
  { at: 20, title: 'Lantern Bearer' },
];
