<script setup lang="ts">
import type { LogLine } from "@wickwatch/core";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { formatDateTime } from "../format";
import AppIcon from "./AppIcon.vue";

export type LogState = "connecting" | "live" | "reconnecting" | "stopped";

/**
 * Log lines with filters and "follow". The panel next to the chart and its larger view (`large`, with a search) show the
 * same lines, each with its own filter and scroll position. Buttons for the bar come in the `actions` slot.
 */
const props = defineProps<{ lines: readonly (LogLine & { seq: number })[]; state: LogState; large?: boolean }>();
const { locale } = useI18n();

type Filter = "all" | "problems" | "setups";
const filter = ref<Filter>("all");
const follow = ref(true);
const query = ref("");
const box = ref<HTMLDivElement>();

/** The search as a pattern, case ignored; its group makes `split` return the matches at the odd places. */
const pattern = computed(() => {
  const q = props.large ? query.value.trim() : "";
  return q ? new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i") : undefined;
});
const visible = computed(() =>
  props.lines.filter(
    (l) =>
      (filter.value === "problems"
        ? l.level === "warn" || l.level === "error"
        : filter.value === "setups"
          ? !!l.setup
          : true) &&
      (!pattern.value || l.text.search(pattern.value) !== -1),
  ),
);
const parts = (text: string) => (pattern.value ? text.split(pattern.value) : [text]);

function toEnd() {
  box.value?.scrollTo({ top: box.value.scrollHeight });
}
onMounted(() => {
  if (follow.value) toEnd();
});
// The newest line, not the count: once the buffer is full, a new line drops the oldest and the count stays.
watch(
  () => visible.value.at(-1)?.seq,
  async () => {
    if (!follow.value) return;
    await nextTick();
    toEnd();
  },
);
</script>

<template>
  <div class="log" :class="{ 'log--large': large }">
    <div class="log__bar">
      <label v-if="large" class="search">
        <span class="visually-hidden">{{ $t("log.search") }}</span>
        <AppIcon name="search" :size="16" />
        <input
          v-model="query"
          type="search"
          class="input"
          :placeholder="$t('log.searchPlaceholder')"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <div class="log__filters" role="group" :aria-label="$t('log.filter')">
        <button
          v-for="f in ['all', 'problems', 'setups'] as const"
          :key="f"
          type="button"
          class="btn btn--ghost btn--small"
          :aria-pressed="filter === f"
          @click="filter = f"
        >
          {{ $t(`log.filters.${f}`) }}
        </button>
      </div>
      <label class="log__follow">
        <input v-model="follow" type="checkbox" />
        {{ $t("log.follow") }}
      </label>
      <span v-if="pattern" class="muted log__matches" role="status">{{ $t("log.matches", visible.length) }}</span>
      <span
        class="log__state"
        :class="state === 'live' ? 'tone-positive' : state === 'stopped' ? 'tone-muted' : 'tone-warning'"
        role="status"
      >
        {{ $t(`log.state.${state}`) }}
      </span>
      <div v-if="$slots.actions" class="log__actions"><slot name="actions" /></div>
    </div>
    <div ref="box" class="log__lines mono" tabindex="0" :aria-label="$t('instance.liveLog')">
      <p v-if="!visible.length" class="muted">{{ $t("log.empty") }}</p>
      <!-- Bot output is shown as is, never translated. -->
      <div
        v-for="line in visible"
        :key="line.seq"
        class="log__line"
        :class="line.level ? `log__line--${line.level}` : ''"
      >
        <time :datetime="line.time">{{ formatDateTime(locale, line.time, "time") }}</time>
        <span v-if="line.level === 'warn' || line.level === 'error'" class="log__level">{{
          $t(`log.level.${line.level}`)
        }}</span>
        <span class="log__text"
          ><template v-for="(part, i) in parts(line.text)" :key="i"
            ><mark v-if="i % 2">{{ part }}</mark
            ><template v-else>{{ part }}</template></template
          ></span
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
.log {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-3);
  min-width: 0;
}

/* In the large view the lines take the height of the window. */
.log--large {
  flex: 1;
  min-height: 0;
}

.log__bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  align-items: center;
}

.log__filters,
.log__actions {
  display: flex;
  gap: var(--ww-space-1);
}

.log__follow {
  display: flex;
  gap: var(--ww-space-1);
  align-items: center;
  font-size: var(--ww-size-sm);
}

.log__matches {
  font-size: var(--ww-size-xs);
}

.log__state {
  margin-left: auto;
  font-size: var(--ww-size-xs);
  font-weight: 600;
}

.log__lines {
  height: 360px;
  overflow: auto;
  padding: var(--ww-space-3);
  border-radius: var(--ww-radius-md);
  background: var(--ww-inset);
  font-size: var(--ww-size-xs);
  line-height: 1.6;
}

.log--large .log__lines {
  flex: 1;
  height: auto;
  min-height: 0;
  overscroll-behavior: contain;
}

.log__lines p {
  margin: 0;
}

.log__line {
  display: flex;
  gap: var(--ww-space-2);
}

.log__line time {
  flex: none;
  color: var(--ww-text-muted);
}

.log__level {
  flex: none;
  font-weight: 600;
}

.log__text {
  white-space: pre-wrap;
  word-break: break-word;
}

/* A search match: background and weight, so it does not depend on the colour alone. */
.log__text mark {
  border-radius: 2px;
  background: var(--ww-warning-bg);
  color: inherit;
  font-weight: 700;
}

.log__line--warn .log__level,
.log__line--warn .log__text {
  color: var(--ww-warning);
}

.log__line--error .log__level,
.log__line--error .log__text {
  color: var(--ww-negative);
}
</style>
