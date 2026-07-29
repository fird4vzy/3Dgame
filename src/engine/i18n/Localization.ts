import en from './locales/en.json';

type Locale = Record<string, string>;

const locales: Record<string, Locale> = { en: en as Locale };
let current = 'en';

/**
 * String lookup.
 *
 * Every player-visible string lives in a locale file from the start —
 * retrofitting i18n means auditing every template literal in the codebase, and
 * it never gets done properly after the fact.
 *
 * A missing key returns the key itself rather than throwing or rendering blank:
 * a visible `menu.settings` is a fixable bug, an empty button is a mystery.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let value = locales[current]?.[key] ?? locales.en?.[key];

  if (value === undefined) {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key "${key}"`);
    return key;
  }

  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      value = value.split(`{${name}}`).join(String(replacement));
    }
  }
  return value;
}

export function setLocale(code: string): void {
  if (locales[code]) current = code;
  else if (import.meta.env?.DEV) console.warn(`[i18n] locale "${code}" not loaded`);
}

export const getLocale = (): string => current;

/** Register a locale loaded at runtime. */
export function registerLocale(code: string, table: Locale): void {
  locales[code] = table;
}

export const availableLocales = (): string[] => Object.keys(locales);
