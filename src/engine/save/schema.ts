/** Bump this whenever the shape of SaveData changes, and add a migration. */
export const SAVE_VERSION = 2;

export const SAVE_KEY = 'lumenpost.save';

export interface SettingsData {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  qualityTier: 'auto' | 'low' | 'medium' | 'high';
  invertY: boolean;
  cameraSensitivity: number;
  reduceMotion: boolean;
  cameraShake: boolean;
  uiScale: number;
  subtitles: boolean;
  language: string;
}

export interface ProgressData {
  completedContracts: string[];
  litDistricts: string[];
  enabledStems: string[];
  collectedShards: string[];
  currentContract: string | null;
}

export interface StatsData {
  totalPlaySeconds: number;
  runsCompleted: number;
  bestRunSeconds: number | null;
  deliveriesMade: number;
}

export interface SaveData {
  schemaVersion: number;
  progress: ProgressData;
  settings: SettingsData;
  stats: StatsData;
  cosmetics: Record<string, string>;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: SettingsData = {
  masterVolume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.9,
  ambienceVolume: 0.6,
  qualityTier: 'auto',
  invertY: false,
  cameraSensitivity: 1,
  reduceMotion: false,
  cameraShake: true,
  uiScale: 1,
  subtitles: true,
  language: 'en',
};

export function createDefaultSave(): SaveData {
  return {
    schemaVersion: SAVE_VERSION,
    progress: {
      completedContracts: [],
      litDistricts: [],
      enabledStems: [],
      collectedShards: [],
      currentContract: null,
    },
    settings: { ...DEFAULT_SETTINGS },
    stats: {
      totalPlaySeconds: 0,
      runsCompleted: 0,
      bestRunSeconds: null,
      deliveriesMade: 0,
    },
    cosmetics: {},
    updatedAt: Date.now(),
  };
}
