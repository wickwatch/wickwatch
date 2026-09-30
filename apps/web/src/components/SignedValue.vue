<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { formatSigned } from "../format";

/** `digits` and `unit` for values that are not money, e.g. R: 1 digit, unit "R" gives "+2.1R". */
const props = withDefaults(defineProps<{ value: number | undefined; digits?: number; unit?: string }>(), {
  digits: 2,
  unit: "",
});
const { locale } = useI18n();

const tone = computed(() =>
  props.value === undefined || props.value === 0 ? "tone-muted" : props.value > 0 ? "tone-positive" : "tone-negative",
);
</script>

<template>
  <span class="mono" :class="tone">{{
    value === undefined ? $t("format.none") : `${formatSigned(locale, value, digits)}${unit}`
  }}</span>
</template>
