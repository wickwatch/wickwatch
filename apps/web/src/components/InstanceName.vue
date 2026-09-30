<script setup lang="ts">
/** An instance a trade belongs to: a link to its page, or "No instance" for manual and unclear trades. */
defineProps<{ name?: string | undefined; instanceRef?: string | undefined }>();
</script>

<template>
  <RouterLink v-if="name && instanceRef" :to="{ name: 'instance', params: { ref: instanceRef } }" class="mono">
    {{ name }}
  </RouterLink>
  <span v-else-if="name" class="mono">{{ name }}</span>
  <span v-else class="muted">{{ $t("trade.noInstance") }}</span>
</template>
