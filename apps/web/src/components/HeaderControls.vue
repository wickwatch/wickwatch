<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { LOCALES, setLocale } from "../i18n";
import { THEME_MODES, themeMode } from "../theme";

const { locale } = useI18n();
</script>

<template>
  <div class="controls">
    <div class="segmented" role="group" :aria-label="$t('language.label')">
      <button
        v-for="l in LOCALES"
        :key="l"
        type="button"
        class="btn btn--ghost btn--small"
        :aria-pressed="locale === l"
        :lang="l"
        :title="$t(`language.${l}`)"
        @click="setLocale(l)"
      >
        {{ l.toUpperCase() }}
      </button>
    </div>
    <label class="theme">
      <span class="visually-hidden">{{ $t("theme.label") }}</span>
      <select v-model="themeMode" class="btn btn--small">
        <option v-for="mode in THEME_MODES" :key="mode" :value="mode">{{ $t(`theme.${mode}`) }}</option>
      </select>
    </label>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  gap: var(--ww-space-2);
  align-items: center;
}

.segmented {
  display: flex;
  border: 1px solid var(--ww-border);
  border-radius: var(--ww-radius-md);
  overflow: hidden;
}

.segmented .btn {
  border: 0;
  border-radius: 0;
}

.theme select {
  appearance: auto;
}
</style>
