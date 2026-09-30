import { ref, type Ref } from "vue";
import { errorKey } from "../api";

interface RunOptions<T> {
  /** The success message, made once the action (and `reload`) succeeded; it goes to `notice`. */
  done?: ((result: T) => string) | undefined;
  /** Where a failure goes instead of `error`, e.g. the error line of an open modal. */
  error?: Ref<string | undefined>;
}

/**
 * One action at a time: `busy` while it runs; a failure leaves its i18n key in `error`, shown with `$t(error)`.
 * With `reload`, each successful action is followed by it (e.g. fetching the page's rows again). An action that
 * resolves to `false` stops there: no reload, no notice (e.g. a form that did not validate).
 */
export function useAsyncAction(options: { reload?: () => Promise<unknown> } = {}) {
  const busy = ref(false);
  const error = ref<string>();
  /** The last success message; cleared when the next action starts. */
  const notice = ref<string>();

  async function run<T>(
    action: () => Promise<T>,
    { done, error: failure = error }: RunOptions<Exclude<T, false>> = {},
  ) {
    busy.value = true;
    failure.value = undefined;
    notice.value = undefined;
    try {
      const result = await action();
      if (result === false) return;
      await options.reload?.();
      if (done) notice.value = done(result as Exclude<T, false>);
    } catch (e) {
      failure.value = errorKey(e);
    } finally {
      busy.value = false;
    }
  }

  return { busy, error, notice, run };
}
