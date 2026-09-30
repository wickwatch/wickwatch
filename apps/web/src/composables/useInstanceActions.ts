import type { InstanceSummary } from "@wickwatch/core";
import { reactive, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorKey, type InstanceAction } from "../api";
import type { Notice } from "./notice";

/**
 * Start, stop and restart from an instance table, the same on the overview and the account page. `busy` holds the
 * refs of the instances being worked on; a failure goes to `notice`.
 */
export function useInstanceActions(notice: Ref<Notice | undefined>, refresh: () => Promise<unknown>) {
  const { t } = useI18n();
  const busy = reactive(new Set<string>());

  async function runAction(instance: InstanceSummary, action: InstanceAction) {
    busy.add(instance.ref);
    notice.value = undefined;
    try {
      await api.instanceAction(instance.ref, action);
    } catch (e) {
      notice.value = {
        tone: "negative",
        text: t("notice.actionFailed", { action: t(`action.${action}`), name: instance.name, reason: t(errorKey(e)) }),
      };
    } finally {
      busy.delete(instance.ref);
      await refresh();
    }
  }

  return { busy, runAction };
}
