import type { AccountSummary } from "@wickwatch/core";
import { computed, ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorKey } from "../api";
import { accountLabel } from "../format";
import type { Notice } from "./notice";

/**
 * Only offered when there is something to stop: a running instance, an open position or a pending order. It also
 * closes positions and cancels orders, so it stays useful after the bots are stopped.
 */
export const hasSomethingToStop = (account: AccountSummary) =>
  account.instances.running > 0 || account.openPositions > 0 || (account.pendingOrders ?? 0) > 0;

/** Emergency stop of an account after confirmation, the same on the overview and the account page. */
export function useEmergencyStop(notice: Ref<Notice | undefined>, refresh: () => Promise<unknown>) {
  const { t } = useI18n();
  const confirming = ref<AccountSummary>();
  /** Account number while its stop runs. */
  const running = ref<string>();
  const message = computed(() =>
    confirming.value ? t("confirm.emergencyStop", { account: accountLabel(confirming.value) }) : "",
  );

  async function stop() {
    const account = confirming.value;
    confirming.value = undefined;
    if (!account) return;
    running.value = account.number;
    try {
      const report = await api.emergencyStop(account.number);
      const done = t("emergencyStop.done", {
        account: account.number,
        instances: report.stoppedInstances.length,
        closed: report.closed,
        cancelled: report.cancelled,
      });
      const partial = report.failedInstances.length
        ? ` ${t("emergencyStop.partial", { names: report.failedInstances.join(", ") })}`
        : "";
      notice.value = { tone: partial ? "negative" : "positive", text: done + partial };
    } catch (e) {
      notice.value = {
        tone: "negative",
        text: t("emergencyStop.failed", { account: account.number, reason: t(errorKey(e)) }),
      };
    } finally {
      running.value = undefined;
      await refresh();
    }
  }

  return { confirming, running, message, stop };
}
