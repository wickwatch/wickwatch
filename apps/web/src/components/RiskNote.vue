<script setup lang="ts">
import type { ParameterSchema, ParameterValues, RiskCheck } from "@wickwatch/core";
import { riskPreview } from "@wickwatch/core/parameters";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { formatNumber, formatPercent, formatPercentValue } from "../format";
import { parameterTitle } from "../parameter-label";
import AppBanner from "./AppBanner.vue";

/**
 * The risk per trade the parameters mean, in money and against the challenge's loss limits (riskPreview). A plain
 * note while it is small; a warning once one losing trade uses half a limit, red once it uses a whole one. Nothing
 * without a risk parameter (Algos page) or a capital to value it with.
 */
const props = defineProps<{
  check: RiskCheck | undefined;
  values: ParameterValues;
  schema: ParameterSchema[];
}>();
const { t, locale } = useI18n();

const preview = computed(() => riskPreview(props.values, props.check));
const money = (value: number) => `${formatNumber(locale.value, value)} ${props.check?.currency ?? ""}`.trim();

const tone = computed(() =>
  preview.value?.level === "over" ? "negative" : preview.value?.level === "high" ? "warning" : "neutral",
);
const title = computed(() => (preview.value?.level === "ok" ? t("risk.title") : t("alert.level.warning")));
const lines = computed(() => {
  const p = preview.value;
  if (!p || !props.check) return [];
  const capital =
    p.capitalFrom === "parameter" && props.check.sizeParameter
      ? t("risk.capitalParameter", {
          capital: formatNumber(locale.value, p.capital),
          parameter: parameterTitle(props.schema, props.check.sizeParameter),
        })
      : t("risk.capitalAccount", { capital: formatNumber(locale.value, p.capital) });
  const shares = [
    p.daily && t("risk.daily", { share: formatPercent(locale.value, p.daily.share), limit: money(p.daily.limit) }),
    p.max && t("risk.max", { share: formatPercent(locale.value, p.max.share), limit: money(p.max.limit) }),
  ].filter(Boolean);
  return [
    t("risk.amount", { amount: money(p.amount), percent: formatPercentValue(locale.value, p.percent), capital }),
    ...(shares.length ? [shares.join(" · ")] : [t("risk.noLimits")]),
    ...(p.level === "ok" ? [] : [t(`risk.${p.level}`)]),
  ];
});
</script>

<template>
  <AppBanner v-if="lines.length" :tone="tone" :title="title">
    <template v-for="(line, i) in lines" :key="i"><br v-if="i" />{{ line }}</template>
  </AppBanner>
</template>
