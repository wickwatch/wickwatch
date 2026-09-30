<script setup lang="ts">
import { system } from "../system";
</script>

<template>
  <!-- Version, source code (AGPL-3.0 §13) and support; shown once the server told them, i.e. after login. -->
  <footer v-if="system" class="footer">
    <span>{{ $t("footer.version", { version: system.version }) }}</span>
    <span class="footer__sep" aria-hidden="true">·</span>
    <a :href="system.sourceUrl" target="_blank" rel="noopener noreferrer">{{ $t("footer.source") }}</a>
    <template v-if="system.supportUrl">
      <span class="footer__sep" aria-hidden="true">·</span>
      <a :href="system.supportUrl" target="_blank" rel="noopener noreferrer">{{ $t("footer.support") }}</a>
    </template>
  </footer>
</template>

<style scoped>
/* Pushed to the bottom of the window by the column layout in App.vue; it scrolls with long pages. */
.footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--ww-space-1) var(--ww-space-3);
  margin-top: auto;
  padding: var(--ww-space-6) var(--ww-space-4) var(--ww-space-8);
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
}

.footer a {
  color: inherit;
}

.footer a:hover {
  color: var(--ww-accent-hover);
}
</style>
