import { computed, ref, watch } from "vue";

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

const darkQuery =
  typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : undefined;
const systemDark = ref(darkQuery?.matches ?? false);
darkQuery?.addEventListener("change", (event) => (systemDark.value = event.matches));

/** The theme shown: the choice, or the system's under `system`; for what CSS cannot style, e.g. a canvas. */
export const appliedTheme = computed(() =>
  themeMode.value === "system" ? (systemDark.value ? "dark" : "light") : themeMode.value,
);
