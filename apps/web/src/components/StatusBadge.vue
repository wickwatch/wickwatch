<script setup lang="ts">
import type { AccountState, InstanceStatus } from "@wickwatch/core";
import { computed } from "vue";

const props = defineProps<{ instance?: InstanceStatus; account?: AccountState }>();

const TONES: Record<string, string> = {
  running: "tone-positive",
  stopped: "tone-negative",
  error: "tone-negative",
  restarting: "tone-warning",
  attention: "tone-warning",
  unknown: "tone-muted",
  idle: "tone-muted",
};

const status = computed(() => props.instance ?? props.account ?? "unknown");
const tone = computed(() => TONES[status.value] ?? "tone-muted");
</script>

<template>
  <!-- Colour plus text: the status never depends on colour alone. -->
  <span class="pill" :class="tone">{{ account ? $t(`account.state.${account}`) : $t(`status.${status}`) }}</span>
</template>
