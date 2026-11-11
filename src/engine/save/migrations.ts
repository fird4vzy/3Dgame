import { DEFAULT_SETTINGS, SAVE_VERSION, emptyJournal, type SaveData } from './schema';

type AnySave = Record<string, unknown>;

/**
 * Migration chain, applied in order from the save's version up to current.
 *
 * Shipping without this guarantees a save-wipe on the first content patch,
 * which is the kind of bug players remember. Each entry takes the shape at
 * version N and returns the shape at version N+1.
 */
export const migrations: Record<number, (save: AnySave) => AnySave> = {
  // v1 → v2: stem state used to be derived from lit districts, which broke as
  // soon as a district had more than one stem. It is now stored explicitly.
  1: (save) => {
    const progress = (save.progress ?? {}) as AnySave;
    const lit = Array.isArray(progress.litDistricts) ? (progress.litDistricts as string[]) : [];
    return {
      ...save,
      schemaVersion: 2,
      progress: {
        ...progress,
        enabledStems: Array.isArray(progress.enabledStems) ? progress.enabledStems : [...lit],
        collectedShards: Array.isArray(progress.collectedShards) ? progress.collectedShards : [],
      },
    };
  },
  // v2 → v3: the journal. Nothing to convert — a save from before it existed
  // simply has an empty one, and `fill` supplies it. Two settings that were
  // never connected to anything (camera shake, subtitles) are dropped.
  2: (save) => {
    const settings = { ...((save.settings ?? {}) as AnySave) };
    delete settings.cameraShake;
    delete settings.subtitles;
    return { ...save, schemaVersion: 3, settings };
  },
};

export interface MigrationResult {
  save: SaveData;
  migrated: boolean;
  fromVersion: number;
}

/**
 * Bring a save up to the current schema.
 *
 * Throws if a version in the chain has no migration — better to fail loudly and
 * fall back to a fresh save than to hand corrupt state to the game.
 */
export function migrate(raw: AnySave): MigrationResult {
  const fromVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;

  if (fromVersion > SAVE_VERSION) {
    throw new Error(
      `[Save] schema v${fromVersion} is newer than this build (v${SAVE_VERSION}). ` +
        'The player likely opened an older build; refusing to downgrade their save.',
    );
  }

  let working: AnySave = raw;
  for (let version = fromVersion; version < SAVE_VERSION; version++) {
    const step = migrations[version];
    if (!step) throw new Error(`[Save] no migration from v${version} to v${version + 1}`);
    working = step(working);
  }

  return {
    save: fill(working),
    migrated: fromVersion !== SAVE_VERSION,
    fromVersion,
  };
}

function fillJournal(value: unknown): SaveData['progress']['journal'] {
  const journal = (typeof value === 'object' && value !== null ? value : {}) as AnySave;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const best: Record<string, number> = {};
  if (typeof journal.courseBest === 'object' && journal.courseBest !== null) {
    for (const [id, seconds] of Object.entries(journal.courseBest as AnySave)) {
      if (typeof seconds === 'number' && Number.isFinite(seconds)) best[id] = seconds;
    }
  }
  return {
    ...emptyJournal(),
    stamps: strings(journal.stamps),
    souvenirs: strings(journal.souvenirs),
    postcards: strings(journal.postcards),
    catFriends: strings(journal.catFriends),
    courseBest: best,
    introSeen: journal.introSeen === true,
  };
}

/**
 * Backfill anything missing with defaults.
 *
 * A migration only has to describe what *changed*; this guarantees the result
 * is structurally complete even if a save was hand-edited or truncated.
 */
function fill(save: AnySave): SaveData {
  const progress = (save.progress ?? {}) as AnySave;
  const stats = (save.stats ?? {}) as AnySave;
  const settings = (save.settings ?? {}) as AnySave;

  const stringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  return {
    schemaVersion: SAVE_VERSION,
    progress: {
      completedContracts: stringArray(progress.completedContracts),
      litDistricts: stringArray(progress.litDistricts),
      enabledStems: stringArray(progress.enabledStems),
      collectedShards: stringArray(progress.collectedShards),
      currentContract:
        typeof progress.currentContract === 'string' ? progress.currentContract : null,
      journal: fillJournal(progress.journal),
    },
    settings: { ...DEFAULT_SETTINGS, ...(settings as object) },
    stats: {
      totalPlaySeconds: num(stats.totalPlaySeconds, 0),
      runsCompleted: num(stats.runsCompleted, 0),
      bestRunSeconds:
        typeof stats.bestRunSeconds === 'number' ? stats.bestRunSeconds : null,
      deliveriesMade: num(stats.deliveriesMade, 0),
    },
    cosmetics:
      typeof save.cosmetics === 'object' && save.cosmetics !== null
        ? (save.cosmetics as Record<string, string>)
        : {},
    updatedAt: num(save.updatedAt, Date.now()),
  };
}
