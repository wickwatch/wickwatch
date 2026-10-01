<script setup lang="ts">
import type { LogLine, LogPeriod } from "@wickwatch/core";
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, downloadFile } from "../api";
import AppIcon from "./AppIcon.vue";
import AppModal from "./AppModal.vue";
import IconButton from "./IconButton.vue";
import LogView, { type LogState } from "./LogView.vue";
import MenuButton, { type MenuItem } from "./MenuButton.vue";

/**
 * The live log of an instance, with a larger view and a download. One stream feeds both views.
 * `running`: the container runs. A stopped container sends its last lines and then ends the stream.
 */
const props = defineProps<{ instanceRef: string; running: boolean }>();
const { t } = useI18n();

/** As many as the server replays on connect; older lines are in the download. */
const MAX_LINES = 1000;
const PERIODS: LogPeriod[] = ["24h", "7d", "all"];

/** `seq` numbers the lines as they arrive: a stable key while old lines are dropped at the top. */
const lines = ref<(LogLine & { seq: number })[]>([]);
let seq = 0;
const state = ref<LogState>("connecting");
let source: EventSource | undefined;

function connect(ref: string) {
  source?.close();
  lines.value = [];
  state.value = "connecting";
  source = new EventSource(api.logStreamUrl(ref, MAX_LINES));
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
    lines.value.push({ ...(JSON.parse((event as MessageEvent<string>).data) as LogLine), seq: ++seq });
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
const shown = computed<LogState>(() => (props.running ? state.value : "stopped"));
onUnmounted(() => source?.close());

const expanded = ref(false);
const downloads = computed<MenuItem[]>(() => PERIODS.map((p) => ({ id: p, label: t(`log.periods.${p}`) })));
const download = (period: string) => downloadFile(api.logDownloadUrl(props.instanceRef, period as LogPeriod));
</script>

<template>
  <div class="log-panel">
    <LogView :lines="lines" :state="shown">
      <template #actions>
        <MenuButton :label="$t('log.download')" :items="downloads" @select="download">
          <AppIcon name="download" />
        </MenuButton>
        <IconButton icon="expand" :label="$t('log.expand')" variant="ghost" @click="expanded = true" />
      </template>
    </LogView>
    <AppModal :open="expanded" :title="$t('instance.liveLog')" full @close="expanded = false">
      <LogView :lines="lines" :state="shown" large>
        <template #actions>
          <MenuButton :label="$t('log.download')" :items="downloads" @select="download">
            <AppIcon name="download" />
          </MenuButton>
        </template>
      </LogView>
    </AppModal>
  </div>
</template>

<style scoped>
.log-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
</style>
