<script setup lang="ts">
import type { InstanceDetail, PendingOrder, Position } from "@wickwatch/core";
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorKey } from "../api";
import { formatPrice } from "../format";
import { isAdmin } from "../session";
import ConfirmDialog from "./ConfirmDialog.vue";
import KpiTiles from "./KpiTiles.vue";
import LogPanel from "./LogPanel.vue";
import PnlChart from "./PnlChart.vue";
import TradeTables from "./TradeTables.vue";

export type Range = 7 | 30 | 90 | "all";
const RANGES = [7, 30, 90] as const;
const LONGEST = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The "Overview" tab of an instance: figures, chart, live log and trades. */
const props = defineProps<{ data: InstanceDetail; days: Range }>();
const emit = defineEmits<{ "update:days": [days: Range]; refresh: [] }>();
const { t, locale } = useI18n();

/** "All" only when the instance traded before the longest range. */
const ranges = computed<Range[]>(() => {
  const d = props.data;
  const older = d.firstTradeAt && Date.parse(d.time) - Date.parse(d.firstTradeAt) > LONGEST * DAY_MS;
  return older || props.days === "all" ? [...RANGES, "all"] : [...RANGES];
});

const busy = reactive(new Set<string>());
const notice = ref<{ tone: "positive" | "negative"; text: string }>();
const closing = ref<Position>();
const cancelling = ref<PendingOrder>();

/** Removes a position (and its deals) from this instance, or restores it. */
async function toggleAttribution(positionId: string, restore: boolean) {
  const account = props.data.account?.number;
  if (!account) return;
  busy.add(positionId);
  notice.value = undefined;
  try {
    if (restore) await api.clearAttribution(account, positionId);
    else await api.setAttribution(account, positionId, null);
    const key = restore ? "attribution.restored" : "attribution.excluded";
    notice.value = { tone: "positive", text: t(key, { id: positionId }) };
  } catch (e) {
    notice.value = { tone: "negative", text: t(errorKey(e)) };
  } finally {
    busy.delete(positionId);
    emit("refresh");
  }
}

async function cancelOrder() {
  const order = cancelling.value;
  const account = props.data.account?.number;
  cancelling.value = undefined;
  if (!order || !account) return;
  busy.add(order.id);
  try {
    await api.cancelOrder(account, order.id);
    notice.value = { tone: "positive", text: t("instance.orderCancelled", { id: order.id }) };
  } catch (e) {
    notice.value = { tone: "negative", text: t("instance.cancelFailed", { id: order.id, reason: t(errorKey(e)) }) };
  } finally {
    busy.delete(order.id);
    emit("refresh");
  }
}

async function closePosition() {
  const position = closing.value;
  const account = props.data.account?.number;
  closing.value = undefined;
  if (!position || !account) return;
  busy.add(position.id);
  try {
    await api.closePosition(account, position.id);
    notice.value = { tone: "positive", text: t("instance.positionClosed", { id: position.id }) };
  } catch (e) {
    notice.value = { tone: "negative", text: t("instance.closeFailed", { id: position.id, reason: t(errorKey(e)) }) };
  } finally {
    busy.delete(position.id);
    emit("refresh");
  }
}
</script>

<template>
  <div class="tab">
    <p class="notice" :class="notice ? `tone-${notice.tone}` : ''" role="status" aria-live="polite">
      {{ notice?.text }}
    </p>
    <p v-if="data.brokerError" class="tone-negative" role="alert">
      {{ $t("instance.brokerError", { reason: $t(`error.adapter.${data.brokerError}`) }) }}
    </p>

    <div class="range" role="group" :aria-label="$t('instance.range')">
      <button
        v-for="r in ranges"
        :key="r"
        type="button"
        class="btn btn--ghost btn--small"
        :aria-pressed="days === r"
        @click="$emit('update:days', r)"
      >
        {{ r === "all" ? $t("instance.allTime") : $t("instance.days", { days: r }) }}
      </button>
    </div>

    <KpiTiles :stats="data.stats" />

    <!-- Chart and log side by side; the trade tables below get the full width, so their columns and buttons fit. -->
    <div class="columns">
      <section class="panel card" aria-labelledby="pnl-title">
        <h2 id="pnl-title">{{ $t("chart.pnlTitle") }}</h2>
        <p class="muted card__hint">{{ $t("chart.pnlHint") }}</p>
        <PnlChart :deals="data.deals" :from="data.range.from" :to="data.range.to" :currency="data.account?.currency" />
      </section>

      <section class="panel card" aria-labelledby="log-title">
        <h2 id="log-title">{{ $t("instance.liveLog") }}</h2>
        <LogPanel
          :instance-ref="data.instance.ref"
          :running="data.instance.status === 'running' || data.instance.status === 'restarting'"
        />
      </section>
    </div>

    <section class="panel card" aria-labelledby="positions-title">
      <h2 id="positions-title">{{ $t("instance.positions") }}</h2>
      <p v-if="!data.positions.length" class="muted">{{ $t("instance.noPositions") }}</p>
      <TradeTables
        v-else
        kind="positions"
        :positions="data.positions"
        :can-close="isAdmin"
        :can-attribute="isAdmin"
        :busy="busy"
        @close="closing = $event"
        @attribution="toggleAttribution($event, false)"
      />
    </section>

    <section class="panel card" aria-labelledby="orders-title">
      <h2 id="orders-title">{{ $t("instance.pendingOrders") }}</h2>
      <p v-if="!data.pendingOrders.length" class="muted">{{ $t("instance.noOrders") }}</p>
      <TradeTables
        v-else
        kind="orders"
        :orders="data.pendingOrders"
        :can-cancel="isAdmin"
        :busy="busy"
        @cancel="cancelling = $event"
      />
    </section>

    <section class="panel card" aria-labelledby="history-title">
      <h2 id="history-title">{{ $t("instance.history") }}</h2>
      <p v-if="!data.deals.length" class="muted">{{ $t("chart.noTrades") }}</p>
      <TradeTables
        v-else
        kind="deals"
        :deals="data.deals"
        :can-attribute="isAdmin"
        :busy="busy"
        @attribution="toggleAttribution($event, false)"
      />
    </section>

    <section
      v-if="data.excludedPositions.length || data.excludedDeals.length"
      class="panel card"
      aria-labelledby="excluded-title"
    >
      <details>
        <summary>
          <h2 id="excluded-title" class="inline-heading">
            {{ $t("attribution.excludedTitle", { count: data.excludedPositions.length + data.excludedDeals.length }) }}
          </h2>
        </summary>
        <p class="muted card__hint">{{ $t("attribution.excludedHint") }}</p>
        <TradeTables
          v-if="data.excludedPositions.length"
          kind="positions"
          :positions="data.excludedPositions"
          :can-attribute="isAdmin"
          excluded
          :busy="busy"
          @attribution="toggleAttribution($event, true)"
        />
        <TradeTables
          v-if="data.excludedDeals.length"
          kind="deals"
          :deals="data.excludedDeals"
          :can-attribute="isAdmin"
          excluded
          :busy="busy"
          @attribution="toggleAttribution($event, true)"
        />
      </details>
    </section>

    <ConfirmDialog
      :open="closing !== undefined"
      :title="$t('instance.closeTitle')"
      :message="closing ? $t('instance.closeConfirm', { id: closing.id, symbol: closing.symbol }) : ''"
      :confirm-label="$t('action.closePosition')"
      @confirm="closePosition"
      @cancel="closing = undefined"
    />
    <ConfirmDialog
      :open="cancelling !== undefined"
      :title="$t('instance.cancelTitle')"
      :message="
        cancelling
          ? $t('instance.cancelConfirm', {
              id: cancelling.id,
              type: $t(`trade.orderType.${cancelling.type}`),
              side: $t(`trade.${cancelling.side}`),
              symbol: cancelling.symbol,
              price: formatPrice(locale, cancelling.price),
            })
          : ''
      "
      :confirm-label="$t('action.cancelOrder')"
      @confirm="cancelOrder"
      @cancel="cancelling = undefined"
    />
  </div>
</template>

<style scoped>
.tab {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-5);
  min-width: 0;
}

.range {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}

.notice {
  margin: 0;
  font-weight: 600;
}

.notice:empty {
  display: none;
}

p[role="alert"] {
  margin: 0;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: var(--ww-space-5);
  align-items: start;
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-3);
  min-width: 0;
  padding: var(--ww-space-5);
}

.card p {
  margin: 0;
}

.card__hint {
  font-size: var(--ww-size-xs);
}

.inline-heading {
  display: inline;
}

details summary {
  cursor: pointer;
}

details[open] summary {
  margin-bottom: var(--ww-space-3);
}

@media (max-width: 1100px) {
  .columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
