import { ref, type Ref } from "vue";
import { errorKey } from "../api";

interface RunOptions<T> {
  /** The success message, made once the action (and `reload`) succeeded; it goes to `notice`. */
  done?: ((result: T) => string) | undefined;
  /** Where a failure goes instead of `error`, e.g. the error line of an open modal. */
  error?: Ref<string | undefined>;
  /** Names the action while it runs (`running`), for a view whose buttons share `busy` but should not all spin. */
  as?: string;
}

/**
 * One action at a time: `busy` while it runs; a failure leaves its i18n key in `error`, shown with `$t(error)`.
 * With `reload`, each successful action is followed by it (e.g. fetching the page's rows again). An action that
 * resolves to `false` stops there: no reload, no notice (e.g. a form that did not validate).
 * The button that started the action shows it with `:aria-busy`: `busy` where it is the only one, else `running === as`.
 */
export function useAsyncAction(options: { reload?: () => Promise<unknown> } = {}) {
  const busy = ref(false);
  const running = ref<string>();
  const error = ref<string>();
  /** The last success message; cleared when the next action starts. */
  const notice = ref<string>();

  async function run<T>(
    action: () => Promise<T>,
    { done, error: failure = error, as }: RunOptions<Exclude<T, false>> = {},
  ) {
    busy.value = true;
    running.value = as;
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
      running.value = undefined;
    }
  }

  return { busy, running, error, notice, run };
}
