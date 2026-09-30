<script setup lang="ts">
import type { HostStatus } from "@wickwatch/core";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { usePolling } from "../composables/usePolling";
import { formatGigabytes, formatPercent } from "../format";
import type { IconName } from "../icons";
import AppIcon from "./AppIcon.vue";

const { t, locale } = useI18n();
const { data } = usePolling(api.host, 30_000);

/** Up to 1 s is fine, up to 2 s worth watching; beyond that the server raises an alert (CLOCK_TOLERANCE_MS). */
const WATCH_MS = 1000;
const ALERT_MS = 2000;
const LEVELS = {
  ok: { icon: "clock", tone: "tone-positive" },
  warning: { icon: "clockWarning", tone: "tone-warning" },
  error: { icon: "clockError", tone: "tone-negative" },
  unknown: { icon: "clockUnknown", tone: "tone-muted" },
} satisfies Record<string, { icon: IconName; tone: string }>;

/**
 * The server time as an icon; what it means is in the tooltip and, for screen readers, in hidden text. The finding
 * comes first, the explanation on its own line.
 */
const clock = computed(() => {
  const host: HostStatus | undefined = data.value;
  if (!host) return undefined;
  const why = t("host.clock.why");
  if (host.clockOffsetMs !== undefined) {
    const off = Math.abs(host.clockOffsetMs);
    const level = off <= WATCH_MS ? "ok" : off <= ALERT_MS ? "warning" : "error";
    const amount = `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(off / 1000)} s`;
    const drift = t(host.clockOffsetMs >= 0 ? "host.clock.ahead" : "host.clock.behind", { offset: amount });
    return { ...LEVELS[level], text: `${t(`host.clock.${level}`, { drift })}\n${why} ${t("host.clock.source")}` };
  }
  // Only when a check is set up but failed lately; with CLOCK_CHECK_URL=off there is no icon at all.
  if (host.clockCheck) return { ...LEVELS.unknown, text: `${t("host.clock.unavailable")}\n${why}` };
  if (host.ntpSynced === undefined) return undefined;
  const level = host.ntpSynced ? "ok" : "error";
  return { ...LEVELS[level], text: `${t(host.ntpSynced ? "host.clock.ntpOk" : "host.clock.ntpOff")}\n${why}` };
});
</script>

<template>
  <ul v-if="data" class="host mono" :aria-label="$t('header.serverStatus')">
    <li>{{ $t("host.cpu", { value: formatPercent(locale, data.cpu) }) }}</li>
    <li>
      {{
        $t("host.ram", {
          used: formatGigabytes(locale, data.memUsed),
          total: `${formatGigabytes(locale, data.memTotal)} GB`,
        })
      }}
    </li>
    <li>{{ $t("host.disk", { value: formatPercent(locale, data.diskUsed / data.diskTotal) }) }}</li>
    <!-- Focusable, so the tooltip also opens from the keyboard. -->
    <li v-if="clock" class="clock" :class="clock.tone" :data-tooltip="clock.text" data-tooltip-wrap tabindex="0">
      <AppIcon :name="clock.icon" :size="16" />
      <span class="visually-hidden">{{ clock.text }}</span>
    </li>
  </ul>
</template>

<style scoped>
.host {
  display: flex;
  gap: var(--ww-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
  white-space: nowrap;
}

.clock {
  display: inline-flex;
  align-items: center;
}
</style>
