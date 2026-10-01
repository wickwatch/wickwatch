import type { LogLine } from "@wickwatch/core";
import { computed, onUnmounted, ref, watch } from "vue";
import { api } from "../api";
import type { LogState } from "../components/LogView.vue";

/** As many as the server replays on connect; older lines are in the download. */
const MAX_LINES = 1000;

/**
 * The live log of an instance over SSE, for the log panel and the larger view. `target` gives the instance to follow,
 * or nothing to close the stream (a dialog that is not open). `running`: the container runs; a stopped container sends
 * its last lines and then ends the stream.
 */
export function useLogStream(target: () => { ref: string; running: boolean } | undefined) {
  /** `seq` numbers the lines as they arrive: a stable key while old lines are dropped at the top. */
  const lines = ref<(LogLine & { seq: number })[]>([]);
  let seq = 0;
  const state = ref<LogState>("connecting");
  let source: EventSource | undefined;

  function close() {
    source?.close();
    source = undefined;
  }

  function connect(instanceRef: string) {
    close();
    lines.value = [];
    state.value = "connecting";
    const current = new EventSource(api.logStreamUrl(instanceRef, MAX_LINES));
    source = current;
    current.addEventListener("open", () => {
      // The server replays the tail on every (re)connect.
      lines.value = [];
      state.value = "live";
    });
    current.addEventListener("error", () => {
      // Without a running container the end of the stream is expected: keep the lines, do not retry every few seconds.
      if (!target()?.running) current.close();
      state.value = "reconnecting";
    });
    current.addEventListener("log", (event) => {
      lines.value.push({ ...(JSON.parse((event as MessageEvent<string>).data) as LogLine), seq: ++seq });
      if (lines.value.length > MAX_LINES) lines.value.splice(0, lines.value.length - MAX_LINES);
    });
  }

  watch(
    () => target()?.ref,
    (instanceRef) => (instanceRef ? connect(instanceRef) : close()),
    { immediate: true },
  );
  // Started again: follow the new output.
  watch(
    () => target()?.running,
    (running) => {
      const instanceRef = target()?.ref;
      if (running && instanceRef && source?.readyState === EventSource.CLOSED) connect(instanceRef);
    },
  );
  onUnmounted(close);

  /** The container state wins over the connection state: a stopped container has no live log. */
  const shown = computed<LogState>(() => (target()?.running === false ? "stopped" : state.value));

  return { lines, state: shown };
}
