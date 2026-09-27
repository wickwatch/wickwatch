<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { formatSigned } from "../format";

const props = defineProps<{ value: number | undefined }>();
const { locale } = useI18n();

const tone = computed(() =>
  props.value === undefined || props.value === 0 ? "tone-muted" : props.value > 0 ? "tone-positive" : "tone-negative",
);
</script>

<template>
  <span class="mono" :class="tone">{{ value === undefined ? $t("format.none") : formatSigned(locale, value) }}</span>
</template>
