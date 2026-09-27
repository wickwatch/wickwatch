<script setup lang="ts">
import AppLogo from "./AppLogo.vue";
import HeaderControls from "./HeaderControls.vue";
import HostStatus from "./HostStatus.vue";
</script>

<template>
  <header class="header">
    <div class="header__start">
      <RouterLink to="/" class="header__home"><AppLogo /></RouterLink>
      <nav :aria-label="$t('header.mainNav')">
        <RouterLink to="/" class="nav-link" active-class="nav-link--active">{{ $t("nav.overview") }}</RouterLink>
      </nav>
    </div>
    <div class="header__end">
      <HostStatus class="header__host" />
      <HeaderControls />
    </div>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-4);
  justify-content: space-between;
  align-items: center;
  padding: var(--ww-space-3) var(--ww-space-10);
  border-bottom: 1px solid var(--ww-border);
  background: var(--ww-surface);
}

.header__start,
.header__end {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--ww-space-6);
}

.header__home {
  display: inline-flex;
}

.nav-link {
  padding: 10px 14px;
  border-radius: var(--ww-radius-md);
  color: var(--ww-text-muted);
  text-decoration: none;
}

.nav-link--active {
  background: var(--ww-surface-raised);
  color: var(--ww-text);
  font-weight: 600;
}

@media (max-width: 1100px) {
  .header__host {
    display: none;
  }
}

@media (max-width: 640px) {
  .header {
    padding: var(--ww-space-3) var(--ww-space-4);
  }

  nav {
    display: none;
  }
}
</style>
