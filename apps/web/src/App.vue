<script setup lang="ts">
import AppFooter from "./components/AppFooter.vue";
import AppHeader from "./components/AppHeader.vue";
</script>

<template>
  <a class="skip-link" href="#main">{{ $t("app.skipToContent") }}</a>
  <AppHeader />
  <main id="main">
    <RouterView />
  </main>
  <AppFooter />
</template>

<style scoped>
.skip-link {
  position: absolute;
  left: var(--ww-space-4);
  top: -100px;
  padding: var(--ww-space-2) var(--ww-space-3);
  border-radius: var(--ww-radius-md);
  background: var(--ww-accent);
  color: var(--ww-on-accent);
}

.skip-link:focus {
  top: var(--ww-space-2);
}
</style>
