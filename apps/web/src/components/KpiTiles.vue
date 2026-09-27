<script setup lang="ts">
import type { DealStats } from "@wickwatch/core";
import { useI18n } from "vue-i18n";
import { formatNumber, formatPercent } from "../format";
import SignedValue from "./SignedValue.vue";

defineProps<{ stats: DealStats }>();
const { locale } = useI18n();
</script>

<template>
  <dl class="kpis">
    <div class="kpi panel">
      <dt>{{ $t("kpi.trades") }}</dt>
      <dd>{{ stats.trades }}</dd>
    </div>
    <div class="kpi panel">
      <dt>{{ $t("kpi.winRate") }}</dt>
      <dd>{{ stats.winRate === undefined ? $t("format.none") : formatPercent(locale, stats.winRate) }}</dd>
    </div>
    <div class="kpi panel">
      <dt>{{ $t("kpi.profitFactor") }}</dt>
      <dd>{{ stats.profitFactor === undefined ? $t("format.none") : formatNumber(locale, stats.profitFactor) }}</dd>
    </div>
    <div class="kpi panel">
      <dt>{{ $t("kpi.averageWin") }}</dt>
      <dd><SignedValue :value="stats.averageWin" /></dd>
    </div>
    <div class="kpi panel">
      <dt>{{ $t("kpi.averageLoss") }}</dt>
      <dd><SignedValue :value="stats.averageLoss" /></dd>
    </div>
    <div class="kpi panel">
      <dt>{{ $t("kpi.net") }}</dt>
      <dd><SignedValue :value="stats.net" /></dd>
    </div>
  </dl>
</template>

<style scoped>
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--ww-space-3);
  margin: 0;
}

.kpi {
  padding: var(--ww-space-3) var(--ww-space-4);
  border-radius: var(--ww-radius-lg);
}

dt {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
}

dd {
  margin: var(--ww-space-1) 0 0;
  font-size: var(--ww-size-xl);
  font-weight: 600;
}
</style>
