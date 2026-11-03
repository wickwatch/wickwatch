<script setup lang="ts">
import type { LogRule } from "@wickwatch/core";

/** The log rules of an algo, one line each, for those who cannot or need not edit them here. */
defineProps<{ rules: LogRule[] }>();
</script>

<template>
  <ul class="log-rules">
    <li v-for="(rule, i) in rules" :key="i" class="mono">
      {{ $t("logRules.summary", { action: $t(`logRules.actions.${rule.action}`), pattern: rule.pattern }) }}
    </li>
  </ul>
</template>

<style scoped>
.log-rules {
  margin: 0;
  padding-left: var(--ww-space-5);
  font-size: var(--ww-size-sm);
}
</style>
