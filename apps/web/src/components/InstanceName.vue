<script setup lang="ts">
/**
 * An instance a trade belongs to: a link to its page, or "No instance" for manual and unclear trades; `manual` adds
 * "by hand" for a trade attributed by hand.
 */
defineProps<{ name?: string | undefined; instanceRef?: string | undefined; manual?: boolean | undefined }>();
</script>

<template>
  <RouterLink v-if="name && instanceRef" :to="{ name: 'instance', params: { ref: instanceRef } }" class="mono">
    {{ name }}
  </RouterLink>
  <span v-else-if="name" class="mono">{{ name }}</span>
  <span v-else class="muted">{{ $t("trade.noInstance") }}</span>
  <span v-if="manual" class="muted by-hand">{{ $t("attribution.byHand") }}</span>
</template>

<style scoped>
.by-hand {
  margin-left: var(--ww-space-2);
  font-size: var(--ww-size-xs);
}
</style>
