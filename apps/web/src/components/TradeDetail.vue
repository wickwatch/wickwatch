<script setup lang="ts">
import type { AccountOrder, AccountPosition, PositionChange, TradeDeal } from "@wickwatch/core";
import { dealResult } from "@wickwatch/core/money";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorKey } from "../api";
import { durationParts, formatDateTime, formatNumber, formatPercentValue, formatPrice } from "../format";
import SignedValue from "./SignedValue.vue";

export type TradeItem =
  | { kind: "position"; value: AccountPosition }
  | { kind: "order"; value: AccountOrder }
  | { kind: "deal"; value: TradeDeal };

/** Everything known about one position, order or closed trade; shown in the drawer next to TradeTables. */
const props = defineProps<{
  item: TradeItem;
  now: number;
  /** The account the trade is on; without it a position's changes are not asked for. */
  account?: string | undefined;
}>();
const { t, locale } = useI18n();

const price = (value: number | undefined) =>
  value === undefined ? t("format.none") : formatPrice(locale.value, value);
const date = (iso: string | undefined) => (iso ? formatDateTime(locale.value, iso) : t("format.none"));
const held = (from: string | undefined, to: number) => {
  if (!from) return t("format.none");
  const { key, params } = durationParts(from, to);
  return t(key, params);
};

const deal = computed(() => (props.item.kind === "deal" ? props.item.value : undefined));
const net = computed(() => (deal.value ? dealResult(deal.value) : 0));

/** The position whose changes are shown: the open one, or the one a closed trade was. */
const positionId = computed(() => (props.item.kind === "position" ? props.item.value.id : deal.value?.positionId));
/** Undefined while loading and for an order. */
const changes = ref<PositionChange[]>();
const changesError = ref<string>();
watch(
  [() => props.account, positionId],
  async ([account, id], _, onCleanup) => {
    changes.value = undefined;
    changesError.value = undefined;
    if (!account || !id) return;
    // Another trade may be shown by the time the answer is there.
    let current = true;
    onCleanup(() => (current = false));
    try {
      const loaded = await api.positionChanges(account, id);
      if (current) changes.value = loaded;
    } catch (e) {
      if (current) changesError.value = errorKey(e);
    }
  },
  { immediate: true },
);
const CHANGE_LABEL = { volume: "trade.lots", entry: "trade.entry", sl: "trade.sl", tp: "trade.tp" } as const;
/** Lots as a number, everything else as a price. */
const shown = (change: PositionChange, value: number | undefined) =>
  change.field === "volume" && value !== undefined ? formatNumber(locale.value, value) : price(value);
/** An open position always says whether something changed; a closed trade only when wickwatch saw a change. */
const showChanges = computed(
  () =>
    changesError.value !== undefined || (changes.value && (props.item.kind === "position" || changes.value.length > 0)),
);
</script>

<template>
  <dl class="facts">
    <template v-if="item.kind === 'position'">
      <dt>{{ $t("trade.symbol") }}</dt>
      <dd class="mono">{{ item.value.symbol }}</dd>
      <dt>{{ $t("trade.side") }}</dt>
      <dd>{{ $t(`trade.${item.value.side}`) }}</dd>
      <dt>{{ $t("trade.lots") }}</dt>
      <dd class="mono">{{ formatNumber(locale, item.value.volume) }}</dd>
      <dt>{{ $t("trade.entry") }}</dt>
      <dd class="mono">{{ price(item.value.entry) }}</dd>
      <dt>{{ $t("trade.sl") }}</dt>
      <dd class="mono">{{ price(item.value.sl) }}</dd>
      <dt>{{ $t("trade.tp") }}</dt>
      <dd class="mono">{{ price(item.value.tp) }}</dd>
      <dt>{{ $t("trade.pnl") }}</dt>
      <dd><SignedValue :value="item.value.pnl" /></dd>
      <dt>{{ $t("trade.opened") }}</dt>
      <dd class="mono">{{ date(item.value.openedAt) }}</dd>
      <dt>{{ $t("trade.held") }}</dt>
      <dd>{{ held(item.value.openedAt, now) }}</dd>
    </template>

    <template v-else-if="item.kind === 'order'">
      <dt>{{ $t("trade.symbol") }}</dt>
      <dd class="mono">{{ item.value.symbol }}</dd>
      <dt>{{ $t("trade.type") }}</dt>
      <dd>{{ $t(`trade.orderType.${item.value.type}`) }}</dd>
      <dt>{{ $t("trade.side") }}</dt>
      <dd>{{ $t(`trade.${item.value.side}`) }}</dd>
      <dt>{{ $t("trade.lots") }}</dt>
      <dd class="mono">{{ formatNumber(locale, item.value.volume) }}</dd>
      <dt>{{ $t("trade.price") }}</dt>
      <dd class="mono">{{ price(item.value.price) }}</dd>
      <dt>{{ $t("trade.sl") }}</dt>
      <dd class="mono">{{ price(item.value.sl) }}</dd>
      <dt>{{ $t("trade.tp") }}</dt>
      <dd class="mono">{{ price(item.value.tp) }}</dd>
      <dt>{{ $t("trade.expires") }}</dt>
      <dd class="mono">{{ item.value.expiresAt ? date(item.value.expiresAt) : $t("trade.noExpiry") }}</dd>
    </template>

    <template v-else-if="deal">
      <dt>{{ $t("trade.symbol") }}</dt>
      <dd class="mono">{{ deal.symbol }}</dd>
      <dt>{{ $t("trade.side") }}</dt>
      <dd>{{ $t(`trade.${deal.side}`) }}</dd>
      <dt>{{ $t("trade.lots") }}</dt>
      <dd class="mono">{{ formatNumber(locale, deal.volume) }}</dd>
      <dt>{{ $t("trade.entry") }}</dt>
      <dd class="mono">{{ price(deal.entryPrice) }}</dd>
      <dt>{{ $t("trade.exit") }}</dt>
      <dd class="mono">{{ price(deal.price) }}</dd>
      <dt>{{ $t("trade.initialSl") }}</dt>
      <dd class="mono">{{ price(deal.initialStopLoss) }}</dd>
      <dt>{{ $t("trade.opened") }}</dt>
      <dd class="mono">{{ date(deal.openedAt) }}</dd>
      <dt>{{ $t("trade.closed") }}</dt>
      <dd class="mono">{{ date(deal.time) }}</dd>
      <dt>{{ $t("trade.held") }}</dt>
      <dd>{{ held(deal.openedAt, Date.parse(deal.time)) }}</dd>
      <dt>{{ $t("trade.gross") }}</dt>
      <dd><SignedValue :value="deal.pnl" /></dd>
      <dt>{{ $t("trade.commission") }}</dt>
      <dd><SignedValue :value="deal.commission ?? 0" /></dd>
      <dt>{{ $t("trade.swap") }}</dt>
      <dd><SignedValue :value="deal.swap ?? 0" /></dd>
      <dt>{{ $t("trade.net") }}</dt>
      <dd><SignedValue :value="net" /></dd>
      <dt>{{ $t("trade.risk") }}</dt>
      <dd class="mono">
        <template v-if="deal.risk !== undefined">
          {{ formatNumber(locale, deal.risk) }}
          <span v-if="deal.riskPct !== undefined" class="muted">{{
            $t("trade.riskShare", { pct: formatPercentValue(locale, deal.riskPct) })
          }}</span>
        </template>
        <template v-else>{{ $t("format.none") }}</template>
      </dd>
      <dt>{{ $t("trade.r") }}</dt>
      <dd><SignedValue :value="deal.r" :digits="1" unit="R" /></dd>
    </template>

    <!-- Identification last: needed for support and the broker, rarely for reading. -->
    <dt>{{ $t("trade.label") }}</dt>
    <dd class="mono">{{ item.value.label ?? $t("format.none") }}</dd>
    <template v-if="item.kind !== 'deal' && item.value.instance !== undefined">
      <dt>{{ $t("table.instance") }}</dt>
      <dd class="mono">{{ item.value.instance }}</dd>
    </template>
    <template v-if="deal">
      <dt>{{ $t("trade.positionId") }}</dt>
      <dd class="mono">{{ deal.positionId }}</dd>
    </template>
    <dt>{{ $t("trade.id") }}</dt>
    <dd class="mono">{{ item.value.id }}</dd>
  </dl>

  <section v-if="showChanges" class="changes" aria-labelledby="trade-changes-title">
    <h3 id="trade-changes-title">{{ $t("trade.changes") }}</h3>
    <p v-if="changesError" class="tone-negative" role="alert">{{ $t(changesError) }}</p>
    <p v-else-if="!changes?.length" class="muted">{{ $t("trade.noChanges") }}</p>
    <ol v-else>
      <li v-for="(change, index) in changes" :key="index">
        <span class="mono muted">{{ date(change.at) }}</span>
        <span>{{ $t(CHANGE_LABEL[change.field]) }}</span>
        <span class="mono">{{
          $t("format.fromTo", { from: shown(change, change.from), to: shown(change, change.to) })
        }}</span>
      </li>
    </ol>
    <p class="field__hint">{{ $t("trade.changesHint") }}</p>
  </section>
</template>

<style scoped>
.facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--ww-space-2) var(--ww-space-5);
  margin: 0;
  font-size: var(--ww-size-sm);
}

.facts dt {
  color: var(--ww-text-muted);
}

.facts dd {
  margin: 0;
  text-align: right;
  overflow-wrap: anywhere;
}

.changes {
  margin-top: var(--ww-space-5);
  font-size: var(--ww-size-sm);
}

.changes h3 {
  margin: 0 0 var(--ww-space-2);
  font-size: var(--ww-size-sm);
}

.changes ol {
  display: grid;
  grid-template-columns: max-content max-content minmax(0, 1fr);
  gap: var(--ww-space-2) var(--ww-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.changes li {
  display: contents;
}

.changes li > :last-child {
  text-align: right;
}

.changes p {
  margin: 0;
}

.changes .field__hint {
  margin-top: var(--ww-space-3);
}
</style>
