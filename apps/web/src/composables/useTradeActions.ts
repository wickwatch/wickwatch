import type { PendingOrder, Position } from "@wickwatch/core";
import { computed, reactive, ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorKey } from "../api";
import { formatPrice } from "../format";
import type { Notice } from "./notice";

/** What runs on a position or order; its button spins. */
export type TradeAction = "close" | "cancel" | "attribution";

/**
 * Closing a position and cancelling an order after confirmation, the same on the instance and the account page.
 * `busy` maps the ids being worked on to the running action; `account` is the account number the trades are on.
 */
export function useTradeActions(
  account: () => string | undefined,
  notice: Ref<Notice | undefined>,
  refresh: () => unknown,
) {
  const { t, locale } = useI18n();
  const busy = reactive(new Map<string, TradeAction>());
  const closing = ref<Position>();
  const cancelling = ref<PendingOrder>();

  const closeMessage = computed(() =>
    closing.value ? t("instance.closeConfirm", { id: closing.value.id, symbol: closing.value.symbol }) : "",
  );
  const cancelMessage = computed(() => {
    const o = cancelling.value;
    return o
      ? t("instance.cancelConfirm", {
          id: o.id,
          type: t(`trade.orderType.${o.type}`),
          side: t(`trade.${o.side}`),
          symbol: o.symbol,
          price: formatPrice(locale.value, o.price),
        })
      : "";
  });

  async function closePosition() {
    const position = closing.value;
    const number = account();
    closing.value = undefined;
    if (!position || !number) return;
    busy.set(position.id, "close");
    try {
      await api.closePosition(number, position.id);
      notice.value = { tone: "positive", text: t("instance.positionClosed", { id: position.id }) };
    } catch (e) {
      notice.value = { tone: "negative", text: t("instance.closeFailed", { id: position.id, reason: t(errorKey(e)) }) };
    } finally {
      busy.delete(position.id);
      await refresh();
    }
  }

  async function cancelOrder() {
    const order = cancelling.value;
    const number = account();
    cancelling.value = undefined;
    if (!order || !number) return;
    busy.set(order.id, "cancel");
    try {
      await api.cancelOrder(number, order.id);
      notice.value = { tone: "positive", text: t("instance.orderCancelled", { id: order.id }) };
    } catch (e) {
      notice.value = { tone: "negative", text: t("instance.cancelFailed", { id: order.id, reason: t(errorKey(e)) }) };
    } finally {
      busy.delete(order.id);
      await refresh();
    }
  }

  return { busy, closing, cancelling, closeMessage, cancelMessage, closePosition, cancelOrder };
}
