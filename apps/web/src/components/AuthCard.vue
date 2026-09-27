<script setup lang="ts">
import AppLogo from "./AppLogo.vue";

defineProps<{ title: string }>();
</script>

<template>
  <div class="auth">
    <section class="auth__card panel" aria-labelledby="auth-title">
      <AppLogo />
      <h1 id="auth-title">{{ title }}</h1>
      <slot />
    </section>
  </div>
</template>

<style scoped>
.auth {
  display: flex;
  justify-content: center;
  padding: var(--ww-space-12) var(--ww-space-4);
}

.auth__card {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-5);
  width: min(420px, 100%);
  padding: var(--ww-space-8);
}

h1 {
  font-family: var(--ww-font-display);
  font-size: var(--ww-size-2xl);
}

@media (max-width: 640px) {
  .auth {
    padding-top: var(--ww-space-6);
  }

  .auth__card {
    padding: var(--ww-space-5);
  }
}
</style>
