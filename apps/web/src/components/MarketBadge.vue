<script setup lang="ts">
import type { MarketHours } from "@wickwatch/core";
import { CLOSING_SOON_MS, marketState, weekStart } from "@wickwatch/core/market-hours";
import { computed, useId } from "vue";
import { useI18n } from "vue-i18n";
import { formatDateTime } from "../format";

/**
 * Whether the market of an instance's symbol is open, next to its status or in a column of its own: "Läuft · Markt
 * geschlossen" explains a bot that does not trade. Hovering the badge shows the weekly hours in local time and the next
 * change; a click or tap pins them open (`data-tooltip-pin`, tooltip.ts), as touch has no hover. Only the broker's
 * weekly schedule: holidays are not in it.
 */
const props = defineProps<{
  hours: MarketHours;
  now: number;
  /** "Open" instead of "Market open", under a column head that already says "Market". */
  short?: boolean;
}>();
const { t, locale } = useI18n();
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
const DAY_MS = 86_400_000;

/** Changes once a week, so the schedule below is not worked out again on every tick of `now`. */
const week = computed(() => weekStart(new Date(props.now)));

/**
 * The weekly hours in local time. Sessions within a day: the days with the same hours in one line, e.g.
 * "Mo–Fr 00:05–22:50". Sessions over midnight (forex, say) read better as the trading week and its daily break:
 * "So 23:00 – Fr 22:29" and "Täglich Pause 22:29–23:00".
 */
const schedule = computed(() => {
  const sessions = props.hours.sessions.map((s) => ({
    from: new Date(week.value + s.start * 1000),
    to: new Date(week.value + s.end * 1000),
  }));
  const first = sessions[0];
  const last = sessions.at(-1);
  if (!first || !last) return [];
  if (sessions.some((s) => s.to.toDateString() !== s.from.toDateString())) {
    const gaps = sessions.slice(1).map((s, i) => s.from.getTime() - (sessions[i] as { to: Date }).to.getTime());
    const gap = gaps[0];
    if (gap !== undefined && gap > 0 && gap < DAY_MS && gaps.every((g) => g === gap)) {
      return [
        t("market.span", { from: when(first.from), to: when(last.to) }),
        t("market.dailyBreak", { from: time(first.to), to: time(new Date(first.to.getTime() + gap)) }),
      ];
    }
    return sessions.map((s) => t("market.span", { from: when(s.from), to: when(s.to) }));
  }
  const lines = new Map<string, Date[]>();
  for (const s of sessions) {
    const hours = t("market.range", { from: time(s.from), to: time(s.to) });
    lines.set(hours, [...(lines.get(hours) ?? []), s.from]);
  }
  return [...lines].map(([hours, days]) => `${dayList(days)} ${hours}`);
});

/** Consecutive days as a range ("Mo–Fr"), others listed ("Mo, Mi"); the sessions come sorted. */
function dayList(days: Date[]): string {
  // Rounded, so a change to or from summer time within the week still counts as one day.
  const consecutive = days.every(
    (d, i) => i === 0 || Math.round((d.getTime() - (days[i - 1] as Date).getTime()) / DAY_MS) === 1,
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
  <!-- A button, so keyboard and touch reach the hours too; it still looks like the status badge next to it, colour
       plus text. The hours show as its tooltip; screen readers get them as its description. -->
  <span>
    <button
      type="button"
      class="pill market__badge"
      :class="TONES[kind]"
      :data-tooltip="detail"
      data-tooltip-wrap
      data-tooltip-pin
      :aria-describedby="detailId"
    >
      {{ $t(short ? `market.short.${kind}` : `market.${kind}`) }}
    </button>
    <span :id="detailId" class="visually-hidden">{{ detail }}</span>
  </span>
</template>

<style scoped>
.market__badge {
  border: 0;
  font-family: inherit;
  cursor: help;
}
</style>
