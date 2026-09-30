import { ref } from "vue";
import { errorKey } from "../api";

/** One action at a time: `busy` while it runs; a failure leaves its i18n key in `error`, shown with `$t(error)`. */
export function useAsyncAction() {
  const busy = ref(false);
  const error = ref<string>();

  async function run(action: () => Promise<void>) {
    busy.value = true;
    error.value = undefined;
    try {
      await action();
    } catch (e) {
      error.value = errorKey(e);
    } finally {
      busy.value = false;
    }
  }

  return { busy, error, run };
}
