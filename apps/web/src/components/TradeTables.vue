<script setup lang="ts">
import type { Deal, PendingOrder, Position } from "@wickwatch/core";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { formatDateTime, formatNumber, formatPrice } from "../format";
import IconButton from "./IconButton.vue";
import SignedValue from "./SignedValue.vue";

const props = defineProps<{
  kind: "positions" | "orders" | "deals";
  positions?: Position[];
  orders?: PendingOrder[];
  deals?: Deal[];
  canClose?: boolean;
  /** Offer "cancel order" on pending orders. */
  canCancel?: boolean;
  /** Offer "not from this bot" (or "restore" when `excluded`). */
  canAttribute?: boolean;
  excluded?: boolean;
  busy?: ReadonlySet<string>;
}>();
defineEmits<{ close: [position: Position]; cancel: [order: PendingOrder]; attribution: [positionId: string] }>();
const { locale } = useI18n();

const price = (value: number | undefined) => (value === undefined ? "–" : formatPrice(locale.value, value));
/** The expiry column only when an order has one. */
const expiring = computed(() => props.orders?.some((o) => o.expiresAt) ?? false);
const COLLAPSED_ROWS = 10;
const showAll = ref(false);
/** Newest first in the table; the chart shows the same deals oldest first. */
const allDeals = computed(() => [...(props.deals ?? [])].reverse());
const dealRows = computed(() => (showAll.value ? allDeals.value : allDeals.value.slice(0, COLLAPSED_ROWS)));
const costs = (d: Deal) => (d.commission ?? 0) + (d.swap ?? 0);
</script>

<template>
  <div class="table-wrap">
    <table v-if="kind === 'positions'" class="table">
      <thead>
        <tr>
          <th scope="col">{{ $t("trade.opened") }}</th>
          <th scope="col">{{ $t("trade.side") }}</th>
          <th scope="col" class="num">{{ $t("trade.lots") }}</th>
          <th scope="col" class="num">{{ $t("trade.entry") }}</th>
          <th scope="col" class="num">{{ $t("trade.sl") }}</th>
          <th scope="col" class="num">{{ $t("trade.tp") }}</th>
          <th scope="col" class="num">{{ $t("trade.pnl") }}</th>
          <th v-if="canClose || canAttribute" scope="col">
            <span class="visually-hidden">{{ $t("table.actions") }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in positions" :key="p.id">
          <td class="mono">{{ formatDateTime(locale, p.openedAt) }}</td>
          <td>{{ $t(`trade.${p.side}`) }}</td>
          <td class="mono num">{{ formatNumber(locale, p.volume) }}</td>
          <td class="mono num">{{ price(p.entry) }}</td>
          <td class="mono num">{{ price(p.sl) }}</td>
          <td class="mono num">{{ price(p.tp) }}</td>
          <td class="num"><SignedValue :value="p.pnl" /></td>
          <td v-if="canClose || canAttribute" class="num">
            <div class="actions">
              <IconButton
                v-if="canAttribute"
                :icon="excluded ? 'restore' : 'exclude'"
                :label="excluded ? $t('attribution.restore') : $t('attribution.exclude')"
                variant="ghost"
                small
                :disabled="busy?.has(p.id)"
                @click="$emit('attribution', p.id)"
              />
              <IconButton
                v-if="canClose && !excluded"
                icon="close"
                :label="$t('action.closePosition')"
                show-label
                variant="danger"
                small
                :disabled="busy?.has(p.id)"
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
          <th scope="col">{{ $t("trade.type") }}</th>
          <th scope="col">{{ $t("trade.side") }}</th>
          <th scope="col" class="num">{{ $t("trade.lots") }}</th>
          <th scope="col" class="num">{{ $t("trade.price") }}</th>
          <th scope="col" class="num">{{ $t("trade.sl") }}</th>
          <th scope="col" class="num">{{ $t("trade.tp") }}</th>
          <th v-if="expiring" scope="col">{{ $t("trade.expires") }}</th>
          <th v-if="canCancel" scope="col">
            <span class="visually-hidden">{{ $t("table.actions") }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="o in orders" :key="o.id">
          <td>{{ $t(`trade.orderType.${o.type}`) }}</td>
          <td>{{ $t(`trade.${o.side}`) }}</td>
          <td class="mono num">{{ formatNumber(locale, o.volume) }}</td>
          <td class="mono num">{{ price(o.price) }}</td>
          <td class="mono num">{{ price(o.sl) }}</td>
          <td class="mono num">{{ price(o.tp) }}</td>
          <td v-if="expiring" class="mono">{{ o.expiresAt ? formatDateTime(locale, o.expiresAt) : "–" }}</td>
          <td v-if="canCancel" class="num">
            <IconButton
              icon="close"
              :label="$t('action.cancelOrder')"
              show-label
              variant="danger"
              small
              :disabled="busy?.has(o.id)"
              @click="$emit('cancel', o)"
            />
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
          <th v-if="canAttribute" scope="col">
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
          <td v-if="canAttribute" class="num">
            <IconButton
              :icon="excluded ? 'restore' : 'exclude'"
              :label="excluded ? $t('attribution.restore') : $t('attribution.exclude')"
              variant="ghost"
              small
              :disabled="busy?.has(d.positionId)"
              @click="$emit('attribution', d.positionId)"
            />
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
