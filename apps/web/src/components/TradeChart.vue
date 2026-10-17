<script setup lang="ts">
import type { Side, TradeChart } from "@wickwatch/core";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  LineType,
  TickMarkType,
  type IChartApi,
  type SeriesMarkerBar,
  type SeriesMarkerBarPosition,
  type SeriesMarkerShape,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorKey } from "../api";
import { formatDateTime, formatPrice } from "../format";
import { appliedTheme } from "../theme";
import { tradeLines, type LinePoint } from "../trade-chart";
import AppModal from "./AppModal.vue";
import AppSpinner from "./AppSpinner.vue";
import IconButton from "./IconButton.vue";

/**
 * Candles around one position, open or closed, with its entry and its stop loss and take profit over its life (a
 * stop moved to break even shows as a step). Shown in the trade details; loaded when they open. "Show larger" draws
 * the same candles almost full screen, without asking the broker again.
 */
const props = defineProps<{
  account: string;
  positionId: string;
  symbol: string;
  side: Side;
  /** The instance's period; without it the server picks one the trade fits. */
  period?: string | undefined;
  openedAt: string;
  /** Missing while the position is open. */
  closedAt?: string | undefined;
  entry?: number | undefined;
  initialStopLoss?: number | undefined;
  /** An open position's stop loss and take profit now. */
  sl?: number | undefined;
  tp?: number | undefined;
}>();
const { t, locale } = useI18n();

const el = ref<HTMLDivElement>();
const bigEl = ref<HTMLDivElement>();
const expanded = ref(false);
const data = ref<TradeChart>();
const error = ref<string>();
let chart: IChartApi | undefined;

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const seconds = (iso: string) => (Date.parse(iso) / 1000) as UTCTimestamp;
const iso = (time: Time) => new Date((time as number) * 1000).toISOString();

function draw() {
  chart?.remove();
  chart = undefined;
  const loaded = data.value;
  // One chart at a time: while enlarged the small one stays empty under the modal.
  const target = expanded.value ? bigEl.value : el.value;
  if (!target || !loaded?.candles.length) return;
  const up = token("--ww-positive");
  const down = token("--ww-negative");
  const accent = token("--ww-accent");
  const c = createChart(target, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: token("--ww-text-muted"),
      fontFamily: token("--ww-font-mono"),
      fontSize: 11,
    },
    grid: { vertLines: { color: token("--ww-border") }, horzLines: { color: token("--ww-border") } },
    rightPriceScale: { borderColor: token("--ww-border-strong") },
    timeScale: {
      borderColor: token("--ww-border-strong"),
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time: Time, type: TickMarkType) =>
        formatDateTime(locale.value, iso(time), type === TickMarkType.Time ? "clock" : "date"),
    },
    // Local time like everywhere in the UI; the candles come in UTC.
    localization: {
      locale: locale.value,
      priceFormatter: (price: number) => formatPrice(locale.value, price),
      timeFormatter: (time: Time) => formatDateTime(locale.value, iso(time)),
    },
    handleScroll: true,
    handleScale: true,
  });
  chart = c;

  const candles = c.addSeries(CandlestickSeries, {
    upColor: up,
    downColor: down,
    borderUpColor: up,
    borderDownColor: down,
    wickUpColor: up,
    wickDownColor: down,
    priceLineVisible: false,
  });
  const bars = loaded.candles.map((candle) => seconds(candle.time));
  candles.setData(loaded.candles.map((candle, i) => ({ ...candle, time: bars[i] as UTCTimestamp })));

  const lines = tradeLines({
    bars,
    side: props.side,
    entry: props.entry,
    openedAt: props.openedAt,
    closedAt: props.closedAt,
    initialStopLoss: props.initialStopLoss,
    levels: loaded.levels,
    current: { sl: props.sl, tp: props.tp },
  });
  if (!lines) return;
  const open = props.closedAt === undefined;
  // Titles name each line on the price axis: colour never carries the meaning alone. An open position's stops now
  // run across the whole chart and carry the label; the steps show where they were before.
  const level = (points: LinePoint[], color: string, title: string, style: LineStyle, labelled = true) => {
    if (!points.some((p) => p.value !== undefined)) return;
    c.addSeries(LineSeries, {
      color,
      title: labelled ? title : "",
      lastValueVisible: labelled,
      lineWidth: 2,
      lineStyle: style,
      lineType: LineType.WithSteps,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    }).setData(points.map((p) => ({ ...p, time: p.time as UTCTimestamp })));
  };
  level(lines.sl, down, t("trade.sl"), LineStyle.Dashed, !open);
  level(lines.tp, up, t("trade.tp"), LineStyle.Dashed, !open);
  const now = (price: number | undefined, color: string, title: string) => {
    if (open && price !== undefined) {
      candles.createPriceLine({
        price,
        color,
        title,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
      });
    }
  };
  now(props.sl, down, t("trade.sl"));
  now(props.tp, up, t("trade.tp"));
  if (props.entry !== undefined) {
    const entry = props.entry;
    level(
      lines.sl.map((p) => ({ time: p.time, value: entry })),
      accent,
      t("trade.entry"),
      LineStyle.Solid,
    );
  }

  // Opening and break even on the side the trade went in, the exit on the other.
  const buy = props.side === "buy";
  const entrySide = buy ? "belowBar" : "aboveBar";
  const exitSide = buy ? "aboveBar" : "belowBar";
  const markers: [number | undefined, SeriesMarkerBarPosition, SeriesMarkerShape, string][] = [
    [lines.opened, entrySide, buy ? "arrowUp" : "arrowDown", t(`trade.${props.side}`)],
    [lines.breakEven, entrySide, "square", t("trade.chartBreakEven")],
    [lines.closed, exitSide, "circle", t("trade.exit")],
  ];
  createSeriesMarkers(
    candles,
    markers
      .flatMap(([time, position, shape, text]): SeriesMarkerBar<Time>[] =>
        time === undefined ? [] : [{ time: time as UTCTimestamp, position, shape, color: accent, text }],
      )
      .sort((a, b) => (a.time as number) - (b.time as number)),
  );
  c.timeScale().fitContent();
}

/** Stepping through trades in the details skips the ones passed by: each would cost the broker a call. */
const SETTLE_MS = 250;
let mounted = true;

async function load() {
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  if (!mounted) return;
  try {
    data.value = await api.tradeChart(props.account, props.positionId, {
      symbol: props.symbol,
      from: props.openedAt,
      to: props.closedAt,
      period: props.period,
    });
  } catch (e) {
    error.value = errorKey(e);
  }
}

const status = computed(() =>
  error.value ? "error" : !data.value ? "loading" : data.value.candles.length ? "ready" : "empty",
);
/**
 * The chart's period, and why when it is not the instance's: the trade was too long for it, or there is none. The
 * server answers in the broker's spelling, a container label may differ in case.
 */
const periodHint = computed(() => {
  const shown = data.value?.period ?? "";
  const hint = t("trade.chartPeriod", { period: shown });
  if (!props.period) return `${hint} · ${t("trade.chartPeriodChosen")}`;
  if (shown.toLowerCase() === props.period.toLowerCase()) return hint;
  return `${hint} · ${t("trade.chartPeriodLonger", { instance: props.period })}`;
});
const title = computed(() => t("trade.chartTitle", { symbol: props.symbol, period: data.value?.period ?? "" }));
const label = computed(() =>
  t("trade.chartLabel", { symbol: props.symbol, period: data.value?.period ?? props.period ?? "" }),
);

// The details show a snapshot of the row, remounted per trade: the props do not change while mounted.
onMounted(() => void load());
onBeforeUnmount(() => {
  mounted = false;
  chart?.remove();
});
watch([data, locale], draw, { flush: "post" });
// On the next frame: after the theme's tokens apply, and after the modal is shown (drawn into a hidden one, the chart
// fits the candles into no width and keeps that spacing).
watch([appliedTheme, expanded], () => requestAnimationFrame(draw));
</script>

<template>
  <section class="trade-chart">
    <!-- Always laid out, so the chart knows its width when it is drawn; the states lie over it. -->
    <div class="trade-chart__frame">
      <div ref="el" class="trade-chart__plot" role="img" :aria-label="label" />
      <div v-if="status === 'loading'" class="trade-chart__state"><AppSpinner /></div>
      <p v-else-if="error" class="trade-chart__state tone-negative" role="alert">{{ $t(error) }}</p>
      <p v-else-if="status === 'empty'" class="trade-chart__state muted">{{ $t("trade.chartEmpty") }}</p>
    </div>
    <div v-if="status === 'ready'" class="trade-chart__foot">
      <p class="field__hint">{{ periodHint }}</p>
      <IconButton icon="expand" :label="$t('modal.expand')" variant="ghost" small @click="expanded = true" />
    </div>
    <AppModal :open="expanded" :title="title" size="large" @close="expanded = false">
      <div ref="bigEl" class="trade-chart__plot trade-chart__plot--big" role="img" :aria-label="label" />
      <p class="field__hint">{{ periodHint }}</p>
    </AppModal>
  </section>
</template>

<style scoped>
.trade-chart {
  margin-bottom: var(--ww-space-5);
}

.trade-chart__frame {
  position: relative;
  height: 260px;
}

.trade-chart__plot {
  height: 100%;
}

.trade-chart__state {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  font-size: var(--ww-size-sm);
}

.trade-chart__foot {
  display: flex;
  gap: var(--ww-space-3);
  justify-content: space-between;
  align-items: center;
  margin-top: var(--ww-space-2);
}

.trade-chart .field__hint {
  margin: 0;
}

/* Fills the full modal; its body is a column that does not scroll. */
.trade-chart__plot--big {
  flex: 1;
  min-height: 0;
}

.trade-chart__plot--big + .field__hint {
  margin-top: var(--ww-space-3);
}
</style>
