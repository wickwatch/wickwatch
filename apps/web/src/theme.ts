import { ref, watch } from "vue";

export const THEME_MODES = ["system", "dark", "light"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

const STORAGE_KEY = "ww-theme";

function stored(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return THEME_MODES.includes(value as ThemeMode) ? (value as ThemeMode) : "system";
  } catch {
    return "system";
  }
}

/** Theme choice; `system` follows prefers-color-scheme, the others set data-theme on <html> (see BRAND.md). */
export const themeMode = ref<ThemeMode>(stored());

watch(
  themeMode,
  (mode) => {
    const root = document.documentElement;
    if (mode === "system") delete root.dataset["theme"];
    else root.dataset["theme"] = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Not persisted in private mode.
    }
  },
  { immediate: true },
);
