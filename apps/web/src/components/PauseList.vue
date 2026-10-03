<script setup lang="ts">
import type { PauseWindow } from "@wickwatch/core";
import { useI18n } from "vue-i18n";
import { formatWhen } from "../format";

/** Pauses of a schedule, in the viewer's time: when, why, and the holidays and news behind them. */
defineProps<{ windows: PauseWindow[] }>();
const { t, locale } = useI18n();

const why = (w: PauseWindow) => [w.reasons.map((r) => t(`schedules.reasons.${r}`)).join(", "), ...w.labels].join(" · ");
</script>

<template>
  <p v-if="!windows.length" class="muted">{{ $t("schedules.noPauses") }}</p>
  <ul v-else class="pauses">
    <li v-for="w in windows" :key="w.start">
      <span class="mono">{{ formatWhen(locale, w.start) }} – {{ formatWhen(locale, w.end) }}</span>
      <!-- News titles come from the calendar feed: text, never markup. -->
      <span class="muted">{{ why(w) }}</span>
    </li>
  </ul>
</template>

<style scoped>
.pauses {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-1);
  margin: 0;
  padding: 0;
  font-size: var(--ww-size-sm);
  list-style: none;
}

.pauses li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-1) var(--ww-space-3);
}
</style>
