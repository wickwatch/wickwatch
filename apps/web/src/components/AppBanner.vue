<script setup lang="ts">
/**
 * A full-width notice (alerts, pending configuration). `title` is the sign that goes with the colour, e.g. "Warning";
 * the message comes from the default slot, buttons from the `actions` slot.
 */
defineProps<{ tone: "negative" | "warning" | "positive" | "neutral"; title?: string }>();
</script>

<template>
  <div class="banner" :class="`banner--${tone}`">
    <p class="banner__text">
      <span v-if="title" class="banner__title">{{ title }}</span>
      <slot />
    </p>
    <div v-if="$slots.actions" class="banner__actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-3);
  padding: var(--ww-space-3) var(--ww-space-4);
  border: 1px solid var(--ww-border);
  border-radius: var(--ww-radius-lg);
  background: var(--ww-surface);
}

.banner--negative {
  border-color: color-mix(in srgb, var(--ww-negative) 35%, transparent);
  background: var(--ww-negative-bg);
}

.banner--warning {
  border-color: color-mix(in srgb, var(--ww-warning) 35%, transparent);
  background: var(--ww-warning-bg);
}

.banner--positive {
  border-color: color-mix(in srgb, var(--ww-positive) 35%, transparent);
  background: var(--ww-positive-bg);
}

.banner__text {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-1) var(--ww-space-3);
  align-items: baseline;
  margin: 0;
}

.banner__title {
  font-weight: 700;
}

.banner--negative .banner__title {
  color: var(--ww-negative);
}

.banner--warning .banner__title {
  color: var(--ww-warning);
}

.banner--positive .banner__title {
  color: var(--ww-positive);
}

.banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}
</style>
