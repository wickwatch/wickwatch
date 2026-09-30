<script setup lang="ts">
import type { AccountState, InstanceStatus } from "@wickwatch/core";
import { computed } from "vue";

/**
 * `connectionLost`: the instance runs but has no broker connection, which matters more than "running".
 * `notCreated`: Wickwatch has a configuration for the instance but no container yet.
 */
const props = defineProps<{
  instance?: InstanceStatus | undefined;
  account?: AccountState;
  connectionLost?: boolean;
  notCreated?: boolean;
}>();

const TONES: Record<string, string> = {
  running: "tone-positive",
  stopped: "tone-negative",
  error: "tone-negative",
  restarting: "tone-warning",
  attention: "tone-warning",
  unknown: "tone-muted",
  idle: "tone-muted",
  connectionLost: "tone-warning",
  notCreated: "tone-muted",
};

const status = computed(() =>
  props.notCreated
    ? "notCreated"
    : props.instance === "running" && props.connectionLost
      ? "connectionLost"
      : (props.instance ?? props.account ?? "unknown"),
);
const tone = computed(() => TONES[status.value] ?? "tone-muted");
</script>

<template>
  <!-- Colour plus text: the status never depends on colour alone. -->
  <span class="pill" :class="tone">{{ account ? $t(`account.state.${account}`) : $t(`status.${status}`) }}</span>
</template>
