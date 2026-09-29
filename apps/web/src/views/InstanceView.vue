<script setup lang="ts">
import type { PendingOrder, Position } from "@wickwatch/core";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { api, errorKey, type InstanceAction, type ManagedInstanceDetail } from "../api";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import KpiTiles from "../components/KpiTiles.vue";
import LogPanel from "../components/LogPanel.vue";
import PnlChart from "../components/PnlChart.vue";
import StatusBadge from "../components/StatusBadge.vue";
import TradeTables from "../components/TradeTables.vue";
import { usePolling } from "../composables/usePolling";
import { durationParts, formatDateTime, formatPrice } from "../format";
import { isAdmin } from "../session";

const RANGES = [7, 30, 90] as const;
const LONGEST = 90;
type Range = (typeof RANGES)[number] | "all";
const DAY_MS = 24 * 60 * 60 * 1000;

const route = useRoute();
const { t, locale } = useI18n();
const instanceRef = computed(() => String(route.params["ref"]));
const days = ref<Range>(30);

const { data, error, now, refresh } = usePolling(() => api.instance(instanceRef.value, days.value), 30_000);
watch([instanceRef, days], () => void refresh());

/** Set when Wickwatch manages this instance's configuration. */
const managed = ref<ManagedInstanceDetail>();
watch(
  instanceRef,
  (ref) => {
    managed.value = undefined;
    api.managedInstance(ref).then(
      (m) => (managed.value = m),
      () => undefined,
    );
  },
  { immediate: true },
);

/** "All" only when the instance traded before the longest range. */
const ranges = computed<Range[]>(() => {
  const d = data.value;
  const older = d?.firstTradeAt && Date.parse(d.time) - Date.parse(d.firstTradeAt) > LONGEST * DAY_MS;
  return older || days.value === "all" ? [...RANGES, "all"] : [...RANGES];
});

const busy = reactive(new Set<string>());
const notice = ref<{ tone: "positive" | "negative"; text: string }>();
const closing = ref<Position>();
const cancelling = ref<PendingOrder>();

const meta = computed(() => {
  const d = data.value;
  if (!d) return "";
  const i = d.instance;
  const account = d.account ? `${d.account.displayName} · ${d.account.number}` : i.account;
  return [account, i.symbol, i.period, i.image].filter(Boolean).join(" · ");
});

const uptime = computed(() => {
  const i = data.value?.instance;
  if (!i || i.status !== "running" || !i.startedAt) return undefined;
  const { key, params } = durationParts(i.startedAt, now.value);
  return t("instance.runningFor", { duration: t(key, params) });
});

async function act(action: InstanceAction) {
  busy.add("instance");
  notice.value = undefined;
  try {
    await api.instanceAction(instanceRef.value, action);
  } catch (e) {
    const name = data.value?.instance.name ?? instanceRef.value;
    notice.value = {
      tone: "negative",
      text: t("notice.actionFailed", { action: t(`action.${action}`), name, reason: t(errorKey(e)) }),
    };
  } finally {
    busy.delete("instance");
    await refresh();
  }
}

/** Removes a position (and its deals) from this instance, or restores it. */
async function toggleAttribution(positionId: string, restore: boolean) {
  const account = data.value?.account?.number;
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
    await refresh();
  }
}

async function cancelOrder() {
  const order = cancelling.value;
  const account = data.value?.account?.number;
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
    await refresh();
  }
}

async function closePosition() {
  const position = closing.value;
  const account = data.value?.account?.number;
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
    await refresh();
  }
}
</script>

<template>
  <div class="detail">
    <RouterLink to="/" class="back">{{ $t("instance.back") }}</RouterLink>

    <p v-if="error && !data" class="tone-negative" role="alert">{{ $t(errorKey(error)) }}</p>
    <p v-else-if="!data" class="muted">{{ $t("overview.loading") }}</p>

    <template v-if="data">
      <section class="head">
        <div class="head__title">
          <div class="head__name">
            <h1 class="mono">{{ data.instance.name }}</h1>
            <StatusBadge :instance="data.instance.status" :connection-lost="!!data.instance.connectionLostSince" />
          </div>
          <p class="muted">
            {{ meta }}
            <template v-if="uptime"> · {{ uptime }}</template>
            <template v-if="data.instance.restartCount">
              · {{ $t("instance.restarts", { count: data.instance.restartCount }) }}
            </template>
          </p>
        </div>
        <div v-if="isAdmin" class="head__actions">
          <button
            v-if="data.instance.status === 'running' || data.instance.status === 'restarting'"
            type="button"
            class="btn"
            :disabled="busy.has('instance')"
            @click="act('stop')"
          >
            {{ $t("action.stop") }}
          </button>
          <button v-else type="button" class="btn" :disabled="busy.has('instance')" @click="act('start')">
            {{ $t("action.start") }}
          </button>
          <button type="button" class="btn" :disabled="busy.has('instance')" @click="act('restart')">
            {{ $t("action.restart") }}
          </button>
        </div>
      </section>

      <p class="notice" :class="notice ? `tone-${notice.tone}` : ''" role="status" aria-live="polite">
        {{ notice?.text }}
      </p>
      <p v-if="data.instance.connectionLostSince" class="tone-warning" role="alert">
        {{ $t("instance.connectionLost", { since: formatDateTime(locale, data.instance.connectionLostSince) }) }}
      </p>
      <div v-if="data.instance.crashes" class="tone-negative crashes" role="alert">
        <p>
          {{
            $t("instance.crashes", {
              count: data.instance.crashes.count,
              last: formatDateTime(locale, data.instance.crashes.lastAt),
            })
          }}
        </p>
        <!-- Bot output stays untranslated. -->
        <p class="mono crashes__line">{{ data.instance.crashes.lastText }}</p>
      </div>
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
          @click="days = r"
        >
          {{ r === "all" ? $t("instance.allTime") : $t("instance.days", { days: r }) }}
        </button>
      </div>

      <KpiTiles :stats="data.stats" />

      <div class="columns">
        <div class="column">
          <section class="panel card" aria-labelledby="pnl-title">
            <h2 id="pnl-title">{{ $t("chart.pnlTitle") }}</h2>
            <p class="muted card__hint">{{ $t("chart.pnlHint") }}</p>
            <PnlChart
              :deals="data.deals"
              :from="data.range.from"
              :to="data.range.to"
              :currency="data.account?.currency"
            />
          </section>

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
                  {{
                    $t("attribution.excludedTitle", {
                      count: data.excludedPositions.length + data.excludedDeals.length,
                    })
                  }}
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
        </div>

        <div class="column">
          <section class="panel card" aria-labelledby="log-title">
            <h2 id="log-title">{{ $t("instance.liveLog") }}</h2>
            <LogPanel :instance-ref="instanceRef" />
          </section>

          <section class="panel card" aria-labelledby="labels-title">
            <h2 id="labels-title">{{ $t("instance.labels") }}</h2>
            <p class="muted card__hint">
              <RouterLink v-if="managed" :to="{ name: 'instance-config', params: { ref: managed.name } }">
                {{ $t("instance.configLink", { version: managed.config.version }) }}
              </RouterLink>
              <template v-else>{{ $t("instance.externallyManaged") }}</template>
            </p>
            <dl class="labels mono">
              <template v-for="(value, key) in data.instance.labels" :key="key">
                <dt>{{ key }}</dt>
                <dd>{{ value }}</dd>
              </template>
            </dl>
          </section>
        </div>
      </div>
    </template>

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
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-5);
  min-width: 0;
  padding: var(--ww-space-6) var(--ww-space-10) var(--ww-space-10);
}

.back {
  align-self: flex-start;
  font-size: var(--ww-size-sm);
}

.head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-4);
  justify-content: space-between;
  align-items: flex-start;
}

.head__name {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  align-items: center;
}

h1 {
  font-size: var(--ww-size-3xl);
  letter-spacing: -0.02em;
  word-break: break-all;
}

.head__title p {
  margin: var(--ww-space-1) 0 0;
  font-size: var(--ww-size-sm);
}

.head__actions,
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

.crashes {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-1);
}

.crashes p {
  margin: 0;
}

.crashes__line {
  overflow-wrap: anywhere;
  font-size: var(--ww-size-sm);
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: var(--ww-space-5);
  align-items: start;
}

.column {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-5);
  min-width: 0;
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

.labels {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--ww-space-1) var(--ww-space-4);
  margin: 0;
  font-size: var(--ww-size-xs);
}

.labels dt {
  color: var(--ww-text-muted);
}

.labels dd {
  margin: 0;
  word-break: break-all;
}

@media (max-width: 1100px) {
  .columns {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .detail {
    padding: var(--ww-space-4);
  }
}
</style>
