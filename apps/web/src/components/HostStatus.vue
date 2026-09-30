<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { usePolling } from "../composables/usePolling";
import { formatGigabytes, formatPercent } from "../format";

const { locale } = useI18n();
const { data } = usePolling(api.host, 30_000);
/** Signed seconds with one decimal, e.g. "+3.2 s". */
const seconds = (ms: number) =>
  `${new Intl.NumberFormat(locale.value, { signDisplay: "always", maximumFractionDigits: 1 }).format(ms / 1000)} s`;
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
    <!-- Measured against an external time source when the runtime cannot see the host's NTP (Docker). -->
    <li
      v-if="data.clockOffsetMs !== undefined"
      :class="data.ntpSynced ? 'tone-positive' : 'tone-negative'"
      :data-tooltip="$t('host.clockTooltip', { offset: seconds(data.clockOffsetMs) })"
    >
      {{ data.ntpSynced ? $t("host.clockOk") : $t("host.clockOff", { offset: seconds(data.clockOffsetMs) }) }}
    </li>
    <li v-else-if="data.ntpSynced !== undefined" :class="data.ntpSynced ? 'tone-positive' : 'tone-negative'">
      {{ data.ntpSynced ? $t("host.ntpSynced") : $t("host.ntpNotSynced") }}
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
</style>
