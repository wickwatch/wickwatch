<script setup lang="ts">
import type { LogLine } from "@wickwatch/core";
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { formatDateTime } from "../format";

/** `running`: the container runs. A stopped container sends its last lines and then ends the stream. */
const props = defineProps<{ instanceRef: string; running: boolean }>();
const { locale } = useI18n();

const MAX_LINES = 500;
type Filter = "all" | "problems" | "setups";
type State = "connecting" | "live" | "reconnecting" | "stopped";

const lines = ref<LogLine[]>([]);
const filter = ref<Filter>("all");
const follow = ref(true);
const state = ref<State>("connecting");
const box = ref<HTMLDivElement>();
let source: EventSource | undefined;

function connect(ref: string) {
  source?.close();
  lines.value = [];
  state.value = "connecting";
  source = new EventSource(api.logStreamUrl(ref));
  source.addEventListener("open", () => {
    // The server replays the tail on every (re)connect.
    lines.value = [];
    state.value = "live";
  });
  source.addEventListener("error", () => {
    // Without a running container the end of the stream is expected: keep the lines, do not retry every few seconds.
    if (!props.running) source?.close();
    state.value = "reconnecting";
  });
  source.addEventListener("log", (event) => {
    lines.value.push(JSON.parse((event as MessageEvent<string>).data) as LogLine);
    if (lines.value.length > MAX_LINES) lines.value.splice(0, lines.value.length - MAX_LINES);
  });
}

watch(() => props.instanceRef, connect, { immediate: true });
// Started again: follow the new output.
watch(
  () => props.running,
  (running) => {
    if (running && source?.readyState === EventSource.CLOSED) connect(props.instanceRef);
  },
);
/** The container state wins over the connection state: a stopped container has no live log. */
const shown = computed<State>(() => (props.running ? state.value : "stopped"));
onUnmounted(() => source?.close());

const visible = computed(() =>
  lines.value.filter((l) =>
    filter.value === "problems"
      ? l.level === "warn" || l.level === "error"
      : filter.value === "setups"
        ? !!l.setup
        : true,
  ),
);

watch(
  () => visible.value.length,
  async () => {
    if (!follow.value) return;
    await nextTick();
    box.value?.scrollTo({ top: box.value.scrollHeight });
  },
);
</script>

<template>
  <div class="log">
    <div class="log__bar">
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
      <span
        class="log__state"
        :class="shown === 'live' ? 'tone-positive' : shown === 'stopped' ? 'tone-muted' : 'tone-warning'"
        role="status"
      >
        {{ $t(`log.state.${shown}`) }}
      </span>
    </div>
    <div ref="box" class="log__lines mono" tabindex="0" :aria-label="$t('instance.liveLog')">
      <p v-if="!visible.length" class="muted">{{ $t("log.empty") }}</p>
      <!-- Bot output is shown as is, never translated. -->
      <div
        v-for="(line, i) in visible"
        :key="i"
        class="log__line"
        :class="line.level ? `log__line--${line.level}` : ''"
      >
        <time :datetime="line.time">{{ formatDateTime(locale, line.time, "time") }}</time>
        <span v-if="line.level === 'warn' || line.level === 'error'" class="log__level">{{
          $t(`log.level.${line.level}`)
        }}</span>
        <span class="log__text">{{ line.text }}</span>
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

.log__bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  align-items: center;
}

.log__filters {
  display: flex;
  gap: var(--ww-space-1);
}

.log__follow {
  display: flex;
  gap: var(--ww-space-1);
  align-items: center;
  font-size: var(--ww-size-sm);
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

.log__line--warn .log__level,
.log__line--warn .log__text {
  color: var(--ww-warning);
}

.log__line--error .log__level,
.log__line--error .log__text {
  color: var(--ww-negative);
}
</style>
