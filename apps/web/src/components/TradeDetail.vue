<script setup lang="ts">
import type { AccountOrder, AccountPosition, PositionChange, TradeDeal } from "@wickwatch/core";
import { dealResult, positionCosts, positionGross } from "@wickwatch/core/money";
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorKey } from "../api";
import { durationParts, formatDateTime, formatNumber, formatPercentValue, formatPrice } from "../format";
import { system } from "../system";
import AppIcon from "./AppIcon.vue";
import SignedValue from "./SignedValue.vue";

// The chart library loads with the first chart shown, not with the page.
const TradeChart = defineAsyncComponent(() => import("./TradeChart.vue"));

export type TradeItem =
  | { kind: "position"; value: AccountPosition }
  | { kind: "order"; value: AccountOrder }
  | { kind: "deal"; value: TradeDeal };

/** Everything known about one position, order or closed trade; shown in the drawer next to TradeTables. */
const props = defineProps<{
  item: TradeItem;
  now: number;
  /** The account the trade is on; without it a position's changes and chart are not asked for. */
  account?: string | undefined;
  /** The period of the trade's instance, for its chart. */
  period?: string | undefined;
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
const position = computed(() => (props.item.kind === "position" ? props.item.value : undefined));

/** The position whose changes are shown: the open one, or the one a closed trade was. */
const positionId = computed(() => position.value?.id ?? deal.value?.positionId);
/** Undefined while loading and for an order. */
const changes = ref<PositionChange[]>();
const changesError = ref<string>();
/** Indexes of the runs whose steps are shown. */
const openRuns = ref(new Set<number>());
watch(
  [() => props.account, positionId],
  async ([account, id], _, onCleanup) => {
    changes.value = undefined;
    changesError.value = undefined;
    openRuns.value = new Set();
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
/** What the chart shows: an open position or a closed trade whose opening is known. */
const chart = computed(() => {
  const account = props.account;
  if (!account || !system.value?.charts) return undefined;
  const common = { account, period: props.period };
  const p = position.value;
  if (p) {
    return {
      ...common,
      positionId: p.id,
      symbol: p.symbol,
      side: p.side,
      openedAt: p.openedAt,
      entry: p.entry,
      initialStopLoss: p.initialStopLoss,
      sl: p.sl,
      tp: p.tp,
    };
  }
  const d = deal.value;
  if (!d?.openedAt) return undefined;
  return {
    ...common,
    positionId: d.positionId,
    symbol: d.symbol,
    side: d.side,
    openedAt: d.openedAt,
    closedAt: d.time,
    entry: d.entryPrice,
    initialStopLoss: d.initialStopLoss,
  };
});
const CHANGE_LABEL = { volume: "trade.lots", entry: "trade.entry", sl: "trade.sl", tp: "trade.tp" } as const;
/** Lots as a number, everything else as a price. */
const shown = (change: PositionChange, value: number | undefined) =>
  change.field === "volume" && value !== undefined ? formatNumber(locale.value, value) : price(value);
/** A run of changes shown as one line: the first `from`, the last `to`; `steps` has more than one when combined. */
interface ChangeRun {
  change: PositionChange;
  steps: PositionChange[];
}
const direction = (change: PositionChange) =>
  change.from === undefined || change.to === undefined ? 0 : Math.sign(change.to - change.from);
/**
 * A trailing stop moves the stop every minute or so; listed one by one, a manual change would drown in them.
 * Consecutive changes of the same field in the same direction make one line, its steps shown on request.
 */
const runs = computed(() =>
  (changes.value ?? []).reduce<ChangeRun[]>((all, change) => {
    const run = all.at(-1);
    const previous = run?.steps.at(-1);
    if (
      run &&
      previous?.field === change.field &&
      direction(change) !== 0 &&
      direction(change) === direction(previous)
    ) {
      run.steps.push(change);
      // Both ends are set: only a change between two values has a direction.
      run.change = { ...run.change, ...(change.to !== undefined && { to: change.to }) };
    } else {
      all.push({ change, steps: [change] });
    }
    return all;
  }, []),
);
const toggleRun = (index: number) => {
  const open = new Set(openRuns.value);
  if (!open.delete(index)) open.add(index);
  openRuns.value = open;
};
/** When a run's last change was noticed, for a run of several: the time of day if on the day it started. */
const runEnd = ({ change, steps }: ChangeRun) => {
  const last = steps.at(-1)?.at ?? change.at;
  const sameDay = formatDateTime(locale.value, change.at, "day") === formatDateTime(locale.value, last, "day");
  return sameDay ? formatDateTime(locale.value, last, "clock") : date(last);
};
/** An open position always says whether something changed; a closed trade only when wickwatch saw a change. */
const showChanges = computed(
  () =>
    changesError.value !== undefined || (changes.value && (props.item.kind === "position" || changes.value.length > 0)),
);
</script>

<template>
  <TradeChart v-if="chart" :key="chart.positionId" v-bind="chart" />
  <dl class="facts">
    <template v-if="position">
      <dt>{{ $t("trade.symbol") }}</dt>
      <dd class="mono">{{ position.symbol }}</dd>
      <dt>{{ $t("trade.side") }}</dt>
      <dd>{{ $t(`trade.${position.side}`) }}</dd>
      <dt>{{ $t("trade.lots") }}</dt>
      <dd class="mono">{{ formatNumber(locale, position.volume) }}</dd>
      <dt>{{ $t("trade.entry") }}</dt>
      <dd class="mono">{{ price(position.entry) }}</dd>
      <dt>{{ $t("trade.currentPrice") }}</dt>
      <dd class="mono">{{ price(position.price) }}</dd>
      <dt>{{ $t("trade.sl") }}</dt>
      <dd class="mono">{{ price(position.sl) }}</dd>
      <dt>{{ $t("trade.tp") }}</dt>
      <dd class="mono">{{ price(position.tp) }}</dd>
      <dt>{{ $t("trade.initialSl") }}</dt>
      <dd class="mono">{{ price(position.initialStopLoss) }}</dd>
      <dt>{{ $t("trade.opened") }}</dt>
      <dd class="mono">{{ date(position.openedAt) }}</dd>
      <dt>{{ $t("trade.held") }}</dt>
      <dd>{{ held(position.openedAt, now) }}</dd>
      <!-- Split like a closed trade's only when the broker reports the costs, not as 0. -->
      <template v-if="positionCosts(position) !== undefined">
        <dt>{{ $t("trade.gross") }}</dt>
        <dd><SignedValue :value="positionGross(position)" /></dd>
        <dt>{{ $t("trade.commission") }}</dt>
        <dd><SignedValue :value="position.commission" /></dd>
        <dt>{{ $t("trade.swap") }}</dt>
        <dd><SignedValue :value="position.swap" /></dd>
        <dt>{{ $t("trade.net") }}</dt>
      </template>
      <dt v-else>{{ $t("trade.pnl") }}</dt>
      <dd><SignedValue :value="position.pnl" /></dd>
      <dt>{{ $t("trade.r") }}</dt>
      <dd><SignedValue :value="position.r" :digits="1" unit="R" /></dd>
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
      <template v-for="(run, index) in runs" :key="index">
        <li>
          <!-- End and step count go on a line of their own, so the values keep their room in the narrow drawer. -->
          <span class="mono muted">
            {{ date(run.change.at) }}
            <template v-if="run.steps.length > 1"><br />{{ $t("trade.changeUntil", { time: runEnd(run) }) }}</template>
          </span>
          <button
            v-if="run.steps.length > 1"
            type="button"
            class="changes__toggle"
            :aria-expanded="openRuns.has(index)"
            @click="toggleRun(index)"
          >
            <AppIcon name="chevronDown" class="changes__chevron" :size="16" />
            <span>
              {{ $t(CHANGE_LABEL[run.change.field]) }}<br /><span class="muted">{{
                $t("trade.changeSteps", run.steps.length)
              }}</span>
            </span>
          </button>
          <span v-else>{{ $t(CHANGE_LABEL[run.change.field]) }}</span>
          <span class="mono">{{
            $t("format.fromTo", { from: shown(run.change, run.change.from), to: shown(run.change, run.change.to) })
          }}</span>
        </li>
        <template v-if="run.steps.length > 1 && openRuns.has(index)">
          <li v-for="(step, stepIndex) in run.steps" :key="`${index}-${stepIndex}`" class="changes__step">
            <span class="mono muted">{{ date(step.at) }}</span>
            <span class="muted">{{ $t(CHANGE_LABEL[step.field]) }}</span>
            <span class="mono muted">{{
              $t("format.fromTo", { from: shown(step, step.from), to: shown(step, step.to) })
            }}</span>
          </li>
        </template>
      </template>
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

.changes__toggle {
  display: flex;
  gap: var(--ww-space-1);
  align-items: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.changes__chevron {
  flex: none;
  margin-top: 2px;
  transform: rotate(-90deg);
  transition: transform 0.15s;
}

.changes__toggle[aria-expanded="true"] .changes__chevron {
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .changes__chevron {
    transition: none;
  }
}

.changes__step > :nth-child(2) {
  padding-left: calc(16px + var(--ww-space-1));
}

.changes .field__hint {
  margin-top: var(--ww-space-3);
}
</style>
