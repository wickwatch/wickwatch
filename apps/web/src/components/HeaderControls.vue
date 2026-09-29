<script setup lang="ts">
import flagDe from "@assets/flags/de.svg";
import flagEn from "@assets/flags/gb-us.svg";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LOCALES, setLocale, type Locale } from "../i18n";
import type { IconName } from "../icons";
import { THEME_MODES, themeMode, type ThemeMode } from "../theme";
import AppIcon from "./AppIcon.vue";
import MenuButton, { type MenuItem } from "./MenuButton.vue";

const { locale, t } = useI18n();

const FLAGS: Record<Locale, string> = { en: flagEn, de: flagDe };
const THEME_ICONS: Record<ThemeMode, IconName> = { system: "monitor", light: "sun", dark: "moon" };

// Language names stay in their own language ("Deutsch", "English"), whatever the active locale.
const languages = computed<MenuItem[]>(() =>
  LOCALES.map((l) => ({ id: l, label: t(`language.${l}`), image: FLAGS[l], checked: locale.value === l, lang: l })),
);
const themes = computed<MenuItem[]>(() =>
  THEME_MODES.map((m) => ({ id: m, label: t(`theme.${m}`), icon: THEME_ICONS[m], checked: themeMode.value === m })),
);
const current = computed(() => locale.value as Locale);
</script>

<template>
  <div class="controls">
    <MenuButton
      :label="$t('language.current', { language: $t(`language.${current}`) })"
      :items="languages"
      @select="setLocale($event as Locale)"
    >
      <img :src="FLAGS[current]" alt="" class="flag" />
    </MenuButton>
    <MenuButton
      :label="$t('theme.current', { theme: $t(`theme.${themeMode}`) })"
      :items="themes"
      @select="themeMode = $event as ThemeMode"
    >
      <AppIcon :name="THEME_ICONS[themeMode]" />
    </MenuButton>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  gap: var(--ww-space-1);
  align-items: center;
}

.flag {
  width: 22px;
  height: 16.5px;
  border-radius: 2px;
  box-shadow: 0 0 0 1px var(--ww-border-strong);
}
</style>
