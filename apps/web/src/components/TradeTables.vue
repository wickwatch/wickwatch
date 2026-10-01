<script setup lang="ts">
import type { AccountOrder, AccountPosition, InstanceSummary, TradeDeal } from "@wickwatch/core";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { TradeAction } from "../composables/useTradeActions";
import { formatDateTime, formatNumber, formatPercentValue, formatPrice } from "../format";
import AppModal from "./AppModal.vue";
import IconButton from "./IconButton.vue";
import InstanceName from "./InstanceName.vue";
import SignedValue from "./SignedValue.vue";
import TradeDetail, { type TradeItem } from "./TradeDetail.vue";

const props = defineProps<{
  kind: "positions" | "orders" | "deals";
  positions?: AccountPosition[];
  orders?: AccountOrder[];
  deals?: TradeDeal[];
  canClose?: boolean;
  /** Offer "cancel order" on pending orders. */
  canCancel?: boolean;
  /** Offer "not from this bot" (or "restore" when `excluded`). */
  canAttribute?: boolean;
  excluded?: boolean;
  busy?: ReadonlyMap<string, TradeAction>;
  /** Adds an "Instance" column (account page): each trade's `instance`, linked to its page. */
  instances?: InstanceSummary[] | undefined;
}>();
defineEmits<{ close: [position: AccountPosition]; cancel: [order: AccountOrder]; attribution: [positionId: string] }>();
const { t, locale } = useI18n();

const price = (value: number | undefined) =>
  value === undefined ? t("format.none") : formatPrice(locale.value, value);
/** The expiry column only when an order has one. */
const expiring = computed(() => props.orders?.some((o) => o.expiresAt) ?? false);
const COLLAPSED_ROWS = 10;
const showAll = ref(false);
/** Newest first in the table; the chart shows the same deals oldest first. */
const allDeals = computed(() => [...(props.deals ?? [])].reverse());
const dealRows = computed(() => (showAll.value ? allDeals.value : allDeals.value.slice(0, COLLAPSED_ROWS)));
const costs = (d: TradeDeal) => (d.commission ?? 0) + (d.swap ?? 0);
/** Risk and R columns only when at least one trade knows its initial stop. */
const withRisk = computed(() => props.deals?.some((d) => d.risk !== undefined) ?? false);
const refOf = (name: string | undefined) => props.instances?.find((i) => i.name === name)?.ref;

/** The row shown in the details drawer, with the time it was opened (for the holding time of open positions). */
const selected = ref<{ item: TradeItem; now: number }>();
const show = (item: TradeItem) => (selected.value = { item, now: Date.now() });
const detailTitle = computed(() => {
  const item = selected.value?.item;
  return item ? `${t(`trade.kind.${item.kind}`)} · ${item.value.symbol}` : "";
});
</script>

<template>
  <div class="table-wrap">
    <table v-if="kind === 'positions'" class="table">
      <thead>
        <tr>
          <th v-if="instances" scope="col">{{ $t("table.instance") }}</th>
          <th scope="col">{{ $t("trade.opened") }}</th>
          <th scope="col">{{ $t("trade.side") }}</th>
          <th scope="col" class="num">{{ $t("trade.lots") }}</th>
          <th scope="col" class="num">{{ $t("trade.entry") }}</th>
          <th scope="col" class="num">{{ $t("trade.sl") }}</th>
          <th scope="col" class="num">{{ $t("trade.tp") }}</th>
          <th scope="col" class="num">{{ $t("trade.pnl") }}</th>
          <th scope="col">
            <span class="visually-hidden">{{ $t("table.actions") }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in positions" :key="p.id">
          <td v-if="instances"><InstanceName :name="p.instance" :instance-ref="refOf(p.instance)" /></td>
          <td class="mono">{{ formatDateTime(locale, p.openedAt) }}</td>
          <td>{{ $t(`trade.${p.side}`) }}</td>
          <td class="mono num">{{ formatNumber(locale, p.volume) }}</td>
          <td class="mono num">{{ price(p.entry) }}</td>
          <td class="mono num">{{ price(p.sl) }}</td>
          <td class="mono num">{{ price(p.tp) }}</td>
          <td class="num"><SignedValue :value="p.pnl" /></td>
          <td class="num">
            <div class="actions">
              <IconButton
                icon="info"
                :label="$t('trade.details')"
                variant="ghost"
                small
                @click="show({ kind: 'position', value: p })"
              />
              <IconButton
                v-if="canAttribute"
                :icon="excluded ? 'restore' : 'exclude'"
                :label="excluded ? $t('attribution.restore') : $t('attribution.exclude')"
                variant="ghost"
                small
                :disabled="busy?.has(p.id)"
                :aria-busy="busy?.get(p.id) === 'attribution'"
                @click="$emit('attribution', p.id)"
              />
              <IconButton
                v-if="canClose && !excluded"
                icon="close"
                :label="$t('action.closePosition')"
                variant="danger"
                small
                :disabled="busy?.has(p.id)"
                :aria-busy="busy?.get(p.id) === 'close'"
                @click="$emit('close', p)"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <table v-else-if="kind === 'orders'" class="table">
      <thead>
        <tr>
          <th v-if="instances" scope="col">{{ $t("table.instance") }}</th>
          <th scope="col">{{ $t("trade.type") }}</th>
          <th scope="col">{{ $t("trade.side") }}</th>
          <th scope="col" class="num">{{ $t("trade.lots") }}</th>
          <th scope="col" class="num">{{ $t("trade.price") }}</th>
          <th scope="col" class="num">{{ $t("trade.sl") }}</th>
          <th scope="col" class="num">{{ $t("trade.tp") }}</th>
          <th v-if="expiring" scope="col">{{ $t("trade.expires") }}</th>
          <th scope="col">
            <span class="visually-hidden">{{ $t("table.actions") }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="o in orders" :key="o.id">
          <td v-if="instances"><InstanceName :name="o.instance" :instance-ref="refOf(o.instance)" /></td>
          <td>{{ $t(`trade.orderType.${o.type}`) }}</td>
          <td>{{ $t(`trade.${o.side}`) }}</td>
          <td class="mono num">{{ formatNumber(locale, o.volume) }}</td>
          <td class="mono num">{{ price(o.price) }}</td>
          <td class="mono num">{{ price(o.sl) }}</td>
          <td class="mono num">{{ price(o.tp) }}</td>
          <td v-if="expiring" class="mono">
            {{ o.expiresAt ? formatDateTime(locale, o.expiresAt) : $t("format.none") }}
          </td>
          <td class="num">
            <div class="actions">
              <IconButton
                icon="info"
                :label="$t('trade.details')"
                variant="ghost"
                small
                @click="show({ kind: 'order', value: o })"
              />
              <IconButton
                v-if="canCancel"
                icon="close"
                :label="$t('action.cancelOrder')"
                variant="danger"
                small
                :disabled="busy?.has(o.id)"
                :aria-busy="busy?.get(o.id) === 'cancel'"
                @click="$emit('cancel', o)"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <table v-else class="table">
      <thead>
        <tr>
          <th scope="col">{{ $t("trade.time") }}</th>
          <th scope="col">{{ $t("trade.side") }}</th>
          <th scope="col" class="num">{{ $t("trade.lots") }}</th>
          <th scope="col" class="num">{{ $t("trade.price") }}</th>
          <th scope="col" class="num">{{ $t("trade.pnl") }}</th>
          <th scope="col" class="num">{{ $t("trade.costs") }}</th>
          <th v-if="withRisk" scope="col" class="num">{{ $t("trade.risk") }}</th>
          <th v-if="withRisk" scope="col" class="num">{{ $t("trade.r") }}</th>
          <th scope="col">
            <span class="visually-hidden">{{ $t("table.actions") }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in dealRows" :key="d.id">
          <td class="mono">{{ formatDateTime(locale, d.time) }}</td>
          <td>{{ $t(`trade.${d.side}`) }}</td>
          <td class="mono num">{{ formatNumber(locale, d.volume) }}</td>
          <td class="mono num">{{ price(d.price) }}</td>
          <td class="num"><SignedValue :value="d.pnl" /></td>
          <td class="num"><SignedValue :value="costs(d)" /></td>
          <td v-if="withRisk" class="mono num">
            <span v-if="d.risk !== undefined" :data-tooltip="formatNumber(locale, d.risk)">{{
              d.riskPct === undefined ? formatNumber(locale, d.risk) : formatPercentValue(locale, d.riskPct)
            }}</span>
            <template v-else>{{ $t("format.none") }}</template>
          </td>
          <td v-if="withRisk" class="num"><SignedValue :value="d.r" :digits="1" unit="R" /></td>
          <td class="num">
            <div class="actions">
              <IconButton
                icon="info"
                :label="$t('trade.details')"
                variant="ghost"
                small
                @click="show({ kind: 'deal', value: d })"
              />
              <IconButton
                v-if="canAttribute"
                :icon="excluded ? 'restore' : 'exclude'"
                :label="excluded ? $t('attribution.restore') : $t('attribution.exclude')"
                variant="ghost"
                small
                :disabled="busy?.has(d.positionId)"
                :aria-busy="busy?.get(d.positionId) === 'attribution'"
                @click="$emit('attribution', d.positionId)"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <button
      v-if="kind === 'deals' && allDeals.length > COLLAPSED_ROWS"
      type="button"
      class="btn btn--ghost btn--small more"
      @click="showAll = !showAll"
    >
      {{ showAll ? $t("trade.showLess") : $t("trade.showAll", { count: allDeals.length }) }}
    </button>
    <AppModal :open="selected !== undefined" :title="detailTitle" drawer @close="selected = undefined">
      <TradeDetail v-if="selected" :item="selected.item" :now="selected.now" />
    </AppModal>
  </div>
</template>

<style scoped>
.table-wrap {
  /* Positioned, so visually hidden headers stay inside the scroll box. */
  position: relative;
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ww-size-sm);
}

th,
td {
  padding: var(--ww-space-2) var(--ww-space-3);
  border-bottom: 1px solid var(--ww-border);
  text-align: left;
  white-space: nowrap;
}

tbody tr:last-child > * {
  border-bottom: 0;
}

thead th {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
  font-weight: 600;
}

.num {
  text-align: right;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--ww-space-2);
}

.more {
  margin-top: var(--ww-space-2);
}
</style>
