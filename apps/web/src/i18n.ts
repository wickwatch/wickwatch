import { createI18n } from "vue-i18n";
import de from "@i18n/de.json";
import en from "@i18n/en.json";

export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];
type MessageSchema = typeof en;

const STORAGE_KEY = "ww-locale";

const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

function storedLocale(): Locale | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function browserLocale(): Locale | undefined {
  return navigator.languages.map((l) => l.slice(0, 2).toLowerCase()).find(isLocale);
}

// Typing both catalogues with the English schema makes a missing German key a compile error.
export const i18n = createI18n<[MessageSchema], Locale, false>({
  legacy: false,
  locale: storedLocale() ?? browserLocale() ?? "en",
  fallbackLocale: "en",
  messages: { en, de },
});

export function setLocale(locale: Locale, persist = true): void {
  i18n.global.locale.value = locale;
  document.documentElement.lang = locale;
  if (!persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Private mode: the choice lasts for this page view only.
  }
}

/** The server default applies only if the user has no stored choice and the browser language is unsupported. */
export function applyServerDefault(locale: string): void {
  if (!storedLocale() && !browserLocale() && isLocale(locale)) setLocale(locale, false);
}

document.documentElement.lang = i18n.global.locale.value;
