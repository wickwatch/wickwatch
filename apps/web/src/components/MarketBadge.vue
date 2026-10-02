<script setup lang="ts">
import type { MarketHours } from "@wickwatch/core";
import { CLOSING_SOON_MS, marketState, weekStart } from "@wickwatch/core/market-hours";
import { computed, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import { formatDateTime } from "../format";

/**
 * Whether the market of an instance's symbol is open, next to its status or in a column of its own: "Läuft · Markt
 * geschlossen" explains a bot that does not trade. Hovering the badge lists the weekly hours in local time and the next
 * change; a click shows them below, as touch has no hover. Only the broker's weekly schedule: holidays are not in it.
 */
const props = defineProps<{
  hours: MarketHours;
  now: number;
  /** "Open" instead of "Market open", under a column head that already says "Market". */
  short?: boolean;
}>();
const { t, locale } = useI18n();
const open = ref(false);
const detailId = useId();

const state = computed(() => marketState(props.hours, new Date(props.now)));
const kind = computed(() =>
  !state.value.open
    ? "closed"
    : state.value.next && state.value.next.getTime() - props.now <= CLOSING_SOON_MS
      ? "closingSoon"
      : "open",
);
const TONES = { open: "tone-positive", closingSoon: "tone-warning", closed: "tone-muted" } as const;

const time = (d: Date) => formatDateTime(locale.value, d.toISOString(), "clock");
const weekday = (d: Date) => formatDateTime(locale.value, d.toISOString(), "weekday");
const when = (d: Date) => `${weekday(d)} ${time(d)}`;

/** Changes once a week, so the schedule below is not worked out again on every tick of `now`. */
const week = computed(() => weekStart(new Date(props.now)));

/** Days of the week with the same local hours in one line, e.g. "Mo–Fr 00:05–22:50". */
const schedule = computed(() => {
  const lines = new Map<string, Date[]>();
  for (const s of props.hours.sessions) {
    const from = new Date(week.value + s.start * 1000);
    const to = new Date(week.value + s.end * 1000);
    const key = to.toDateString() !== from.toDateString() ? "market.overnight" : "market.range";
    const hours = t(key, { from: time(from), to: time(to) });
    lines.set(hours, [...(lines.get(hours) ?? []), from]);
  }
  return [...lines].map(([hours, days]) => `${dayList(days)} ${hours}`);
});

/** Consecutive days as a range ("Mo–Fr"), others listed ("Mo, Mi"); the sessions come sorted. */
function dayList(days: Date[]): string {
  // Rounded, so a change to or from summer time within the week still counts as one day.
  const consecutive = days.every(
    (d, i) => i === 0 || Math.round((d.getTime() - (days[i - 1] as Date).getTime()) / 86_400_000) === 1,
  );
  if (!consecutive || days.length < 3) return days.map(weekday).join(", ");
  return `${weekday(days[0] as Date)}–${weekday(days[days.length - 1] as Date)}`;
}

const nextText = computed(() => {
  const next = state.value.next;
  if (!next) return undefined;
  if (kind.value === "closingSoon")
    return t("market.closesIn", { minutes: Math.max(1, Math.ceil((next.getTime() - props.now) / 60_000)) });
  return t(state.value.open ? "market.closesAt" : "market.opensAt", { time: when(next) });
});

const detail = computed(() =>
  props.hours.alwaysOpen
    ? t("market.alwaysOpen")
    : [t("market.hoursTitle"), ...schedule.value, nextText.value, t("market.source")].filter(Boolean).join("\n"),
);
</script>

<template>
  <span class="market">
    <!-- A button, so keyboard and touch reach the hours too; it still looks like the status badge next to it, colour
         plus text. -->
    <button
      type="button"
      class="pill market__badge"
      :class="TONES[kind]"
      :data-tooltip="detail"
      data-tooltip-wrap
      :aria-expanded="open"
      :aria-controls="detailId"
      @click="open = !open"
    >
      {{ $t(short ? `market.short.${kind}` : `market.${kind}`) }}
    </button>
    <span v-show="open" :id="detailId" class="muted market__detail">{{ detail }}</span>
  </span>
</template>

<style scoped>
.market {
  display: inline-flex;
  flex-direction: column;
  gap: var(--ww-space-1);
  align-items: flex-start;
  min-width: 0;
}

.market__badge {
  border: 0;
  font-family: inherit;
  cursor: help;
}

.market__detail {
  font-size: var(--ww-size-xs);
  white-space: pre-line;
}
</style>
