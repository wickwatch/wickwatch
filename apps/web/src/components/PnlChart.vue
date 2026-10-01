<script setup lang="ts">
import type { Deal } from "@wickwatch/core";
import { dealResult, round2 } from "@wickwatch/core/money";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CURVES, chartCurve, smoothPath, steppedPath } from "../chart-path";
import { formatDateTime, formatNumber, formatSigned } from "../format";

const props = defineProps<{ deals: Deal[]; from: string; to: string; currency?: string | undefined }>();
const { t, locale } = useI18n();

/** The plot fills the height its card gets (next to the log), never less than this. */
const MIN_HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 28, left: 64 };

const plot = ref<HTMLDivElement>();
const width = ref(720);
const height = ref(MIN_HEIGHT);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    width.value = Math.max(280, Math.round(entry.contentRect.width));
    height.value = Math.max(MIN_HEIGHT, Math.round(entry.contentRect.height));
  });
  if (plot.value) observer.observe(plot.value);
});
// The plot only exists while there are trades.
watch(plot, (element, previous) => {
  if (previous) observer?.unobserve(previous);
  if (element) observer?.observe(element);
});
onUnmounted(() => observer?.disconnect());

/** Cumulative realised P&L after each deal, starting at 0 at the range start. */
const points = computed(() => {
  let total = 0;
  return props.deals.map((deal) => {
    total += dealResult(deal);
    return { time: Date.parse(deal.time), value: round2(total), deal };
  });
});

function niceStep(span: number): number {
  const raw = span / 4;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  return ([1, 2, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
}

const scale = computed(() => {
  const values = [0, ...points.value.map((p) => p.value)];
  const step = niceStep(Math.max(...values) - Math.min(...values) || 1);
  const min = Math.floor(Math.min(...values) / step) * step;
  const max = Math.ceil(Math.max(...values) / step) * step || step;
  const x0 = Date.parse(props.from);
  const x1 = Date.parse(props.to);
  const innerW = width.value - PAD.left - PAD.right;
  const innerH = height.value - PAD.top - PAD.bottom;
  const x = (time: number) => PAD.left + ((time - x0) / (x1 - x0 || 1)) * innerW;
  const y = (value: number) => PAD.top + (1 - (value - min) / (max - min || 1)) * innerH;
  const yTicks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) yTicks.push(round2(v));
  // Fewer dates on narrow charts, so the labels do not collide.
  const count = width.value < 480 ? 3 : 5;
  const xTicks = Array.from({ length: count }, (_, i) => x0 + ((x1 - x0) * i) / (count - 1));
  return { x, y, yTicks, xTicks, x0, x1 };
});

/**
 * The realised P&L only changes when a deal closes: the step line shows exactly that, the smooth
 * one reads more easily over many trades.
 */
const linePath = computed(() => {
  const { x, y, x0, x1 } = scale.value;
  const line = [
    { x: x(x0), y: y(0) },
    ...points.value.map((p) => ({ x: x(p.time), y: y(p.value) })),
    { x: x(x1), y: y(points.value.at(-1)?.value ?? 0) },
  ];
  return chartCurve.value === "smooth" ? smoothPath(line) : steppedPath(line);
});
const areaPath = computed(() => {
  const { x, y, x0 } = scale.value;
  return `${linePath.value} V${y(0)} H${x(x0)} Z`;
});

const active = ref<number>();
const activePoint = computed(() => (active.value === undefined ? undefined : points.value[active.value]));

/** The x position of each point; deals come oldest first, so these never decrease. */
const xs = computed(() => points.value.map((p) => scale.value.x(p.time)));
/** Index of the first point at or right of `at`. */
function firstFrom(at: number): number {
  let lo = 0;
  let hi = xs.value.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((xs.value[mid] ?? Infinity) < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The point nearest to the pointer; of points equally near, the earliest. */
function onPointer(event: PointerEvent) {
  const svg = event.currentTarget as SVGSVGElement;
  const px = event.clientX - svg.getBoundingClientRect().left;
  const count = xs.value.length;
  const right = firstFrom(px);
  const leftX = xs.value[right - 1];
  if (!count) active.value = undefined;
  else if (leftX === undefined) active.value = 0;
  else {
    // The first of the points at the same position as the one left of the pointer.
    const left = firstFrom(leftX);
    const rightX = xs.value[right];
    active.value = rightX === undefined || px - leftX <= rightX - px ? left : right;
  }
}

function onKey(event: KeyboardEvent) {
  if (!points.value.length) return;
  const last = points.value.length - 1;
  if (event.key === "ArrowRight") active.value = Math.min(last, (active.value ?? -1) + 1);
  else if (event.key === "ArrowLeft") active.value = Math.max(0, (active.value ?? last + 1) - 1);
  else if (event.key === "Escape") active.value = undefined;
  else return;
  event.preventDefault();
}

const summary = computed(() => {
  const last = points.value.at(-1)?.value ?? 0;
  return t("chart.pnlSummary", { value: formatSigned(locale.value, last), trades: points.value.length });
});
</script>

<template>
  <div class="chart">
    <p v-if="!points.length" class="muted chart__empty">{{ $t("chart.noTrades") }}</p>
    <template v-else>
      <div class="curve" role="group" :aria-label="$t('chart.curve')">
        <button
          v-for="c in CURVES"
          :key="c"
          type="button"
          class="btn btn--ghost btn--small"
          :aria-pressed="chartCurve === c"
          @click="chartCurve = c"
        >
          {{ $t(`chart.curves.${c}`) }}
        </button>
      </div>
      <div ref="plot" class="plot">
        <svg
          :width="width"
          :height="height"
          :viewBox="`0 0 ${width} ${height}`"
          role="img"
          :aria-label="summary"
          tabindex="0"
          @pointermove="onPointer"
          @pointerleave="active = undefined"
          @keydown="onKey"
          @blur="active = undefined"
        >
          <g class="grid">
            <line
              v-for="tick in scale.yTicks"
              :key="`y${tick}`"
              :x1="PAD.left"
              :x2="width - PAD.right"
              :y1="scale.y(tick)"
              :y2="scale.y(tick)"
              :class="{ grid__zero: tick === 0 }"
            />
          </g>
          <g class="axis">
            <text
              v-for="tick in scale.yTicks"
              :key="`yl${tick}`"
              :x="PAD.left - 8"
              :y="scale.y(tick) + 4"
              text-anchor="end"
            >
              {{ formatNumber(locale, tick, 0) }}
            </text>
            <text
              v-for="(tick, i) in scale.xTicks"
              :key="`x${tick}`"
              :x="scale.x(tick)"
              :y="height - 8"
              :text-anchor="i === 0 ? 'start' : i === scale.xTicks.length - 1 ? 'end' : 'middle'"
            >
              {{ formatDateTime(locale, new Date(tick).toISOString(), "date") }}
            </text>
          </g>
          <path class="area" :d="areaPath" />
          <path class="line" :d="linePath" />
          <g v-if="activePoint">
            <line
              class="crosshair"
              :x1="scale.x(activePoint.time)"
              :x2="scale.x(activePoint.time)"
              :y1="PAD.top"
              :y2="height - PAD.bottom"
            />
            <circle class="marker" :cx="scale.x(activePoint.time)" :cy="scale.y(activePoint.value)" r="4" />
          </g>
        </svg>
      </div>
      <div
        v-if="activePoint"
        class="tooltip panel"
        :style="{
          left: `${Math.min(scale.x(activePoint.time) + 12, width - 190)}px`,
          top: `${Math.max(0, scale.y(activePoint.value) - 64)}px`,
        }"
        aria-hidden="true"
      >
        <strong class="mono">{{ formatSigned(locale, activePoint.value) }} {{ currency }}</strong>
        <span class="muted">{{ formatDateTime(locale, activePoint.deal.time) }}</span>
        <span class="muted">
          {{ $t("chart.deal") }} <span class="mono">{{ formatSigned(locale, dealResult(activePoint.deal)) }}</span>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Grows in a flex column (the P&L card), so the plot can take the height the log next to it gives the row. */
.chart {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.chart__empty {
  margin: 0;
  padding: var(--ww-space-8) 0;
  text-align: center;
}

.curve {
  display: flex;
  justify-content: flex-end;
  gap: var(--ww-space-1);
  margin-bottom: var(--ww-space-2);
}

/* The svg sits on top, so its own height never holds the card open when the row gets lower. */
.plot {
  position: relative;
  flex: 1;
  min-height: 220px; /* MIN_HEIGHT */
}

svg {
  position: absolute;
  inset: 0 auto auto 0;
  display: block;
  touch-action: pan-y;
}

svg:focus-visible {
  outline: 2px solid var(--ww-focus);
  outline-offset: 2px;
}

.grid line {
  stroke: var(--ww-border);
  stroke-width: 1;
}

.grid .grid__zero {
  stroke: var(--ww-border-strong);
}

.axis text {
  fill: var(--ww-text-muted);
  font-family: var(--ww-font-mono);
  font-size: 11px;
}

.line {
  fill: none;
  stroke: var(--ww-info);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.area {
  fill: var(--ww-info);
  opacity: 0.1;
}

.crosshair {
  stroke: var(--ww-text-muted);
  stroke-width: 1;
}

.marker {
  fill: var(--ww-info);
  stroke: var(--ww-surface);
  stroke-width: 2;
}

.tooltip {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 170px;
  padding: var(--ww-space-2) var(--ww-space-3);
  border-radius: var(--ww-radius-md);
  font-size: var(--ww-size-xs);
  pointer-events: none;
}

.tooltip strong {
  color: var(--ww-text);
  font-size: var(--ww-size-md);
}
</style>
