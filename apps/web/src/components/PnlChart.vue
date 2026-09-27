<script setup lang="ts">
import type { Deal } from "@wickwatch/core";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { formatDateTime, formatNumber, formatSigned } from "../format";

const props = defineProps<{ deals: Deal[]; from: string; to: string; currency?: string | undefined }>();
const { t, locale } = useI18n();

const HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 28, left: 64 };

const container = ref<HTMLDivElement>();
const width = ref(720);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (entry) width.value = Math.max(280, Math.round(entry.contentRect.width));
  });
  if (container.value) observer.observe(container.value);
});
onUnmounted(() => observer?.disconnect());

const result = (d: Deal) => d.pnl + (d.commission ?? 0) + (d.swap ?? 0);

/** Cumulative realised P&L after each deal, starting at 0 at the range start. */
const points = computed(() => {
  let total = 0;
  return props.deals.map((deal) => {
    total += result(deal);
    return { time: Date.parse(deal.time), value: Math.round(total * 100) / 100, deal };
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
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (time: number) => PAD.left + ((time - x0) / (x1 - x0 || 1)) * innerW;
  const y = (value: number) => PAD.top + (1 - (value - min) / (max - min || 1)) * innerH;
  const yTicks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) yTicks.push(Math.round(v * 100) / 100);
  // Fewer dates on narrow charts, so the labels do not collide.
  const count = width.value < 480 ? 3 : 5;
  const xTicks = Array.from({ length: count }, (_, i) => x0 + ((x1 - x0) * i) / (count - 1));
  return { x, y, yTicks, xTicks, x0, x1 };
});

/** Step line: the realised P&L only changes when a deal closes. */
const linePath = computed(() => {
  const { x, y, x0, x1 } = scale.value;
  let d = `M${x(x0)},${y(0)}`;
  let last = 0;
  for (const p of points.value) {
    d += ` H${x(p.time)} V${y(p.value)}`;
    last = p.value;
  }
  return `${d} H${x(x1)} V${y(last)}`;
});
const areaPath = computed(() => {
  const { x, y, x0 } = scale.value;
  return `${linePath.value} V${y(0)} H${x(x0)} Z`;
});

const active = ref<number>();
const activePoint = computed(() => (active.value === undefined ? undefined : points.value[active.value]));

function onPointer(event: PointerEvent) {
  const svg = event.currentTarget as SVGSVGElement;
  const px = event.clientX - svg.getBoundingClientRect().left;
  let best: number | undefined;
  let distance = Infinity;
  points.value.forEach((p, i) => {
    const d = Math.abs(scale.value.x(p.time) - px);
    if (d < distance) [best, distance] = [i, d];
  });
  active.value = best;
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
  <div ref="container" class="chart">
    <p v-if="!points.length" class="muted chart__empty">{{ $t("chart.noTrades") }}</p>
    <template v-else>
      <svg
        :width="width"
        :height="HEIGHT"
        :viewBox="`0 0 ${width} ${HEIGHT}`"
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
            :y="HEIGHT - 8"
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
            :y2="HEIGHT - PAD.bottom"
          />
          <circle class="marker" :cx="scale.x(activePoint.time)" :cy="scale.y(activePoint.value)" r="4" />
        </g>
      </svg>
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
          {{ $t("chart.deal") }} <span class="mono">{{ formatSigned(locale, result(activePoint.deal)) }}</span>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  min-width: 0;
}

.chart__empty {
  margin: 0;
  padding: var(--ww-space-8) 0;
  text-align: center;
}

svg {
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
