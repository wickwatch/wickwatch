<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { usePolling } from "../composables/usePolling";
import { formatGigabytes, formatPercent } from "../format";

const { locale } = useI18n();
const { data } = usePolling(api.host, 30_000);
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
    <li v-if="data.ntpSynced !== undefined" :class="data.ntpSynced ? 'tone-positive' : 'tone-negative'">
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
