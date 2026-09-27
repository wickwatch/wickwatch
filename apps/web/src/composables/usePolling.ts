import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";

/**
 * Loads data now and every `intervalMs`, and again when the tab becomes visible.
 * Keeps the last good data on errors and flags it as stale once it is older than two intervals.
 */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number) {
  const data = shallowRef<T>();
  const error = shallowRef<unknown>();
  const updatedAt = ref<number>();
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | undefined;
  let clock: ReturnType<typeof setInterval> | undefined;
  let inFlight: Promise<void> | undefined;

  const refresh = () =>
    (inFlight ??= load()
      .then((value) => {
        data.value = value;
        error.value = undefined;
        updatedAt.value = Date.now();
      })
      .catch((e: unknown) => {
        error.value = e;
      })
      .finally(() => {
        inFlight = undefined;
      }));

  const onVisible = () => {
    if (document.visibilityState === "visible") void refresh();
  };

  onMounted(() => {
    void refresh();
    timer = setInterval(() => void refresh(), intervalMs);
    clock = setInterval(() => (now.value = Date.now()), 1000);
    document.addEventListener("visibilitychange", onVisible);
  });
  onUnmounted(() => {
    clearInterval(timer);
    clearInterval(clock);
    document.removeEventListener("visibilitychange", onVisible);
  });

  const stale = computed(() => updatedAt.value !== undefined && now.value - updatedAt.value > 2 * intervalMs);
  return { data, error, updatedAt, now, stale, refresh };
}
