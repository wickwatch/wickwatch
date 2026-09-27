<script setup lang="ts">
import { useRouter } from "vue-router";
import { api } from "../api";
import { clearUser, currentUser } from "../session";
import AppLogo from "./AppLogo.vue";
import HeaderControls from "./HeaderControls.vue";
import HostStatus from "./HostStatus.vue";

const router = useRouter();

async function logout() {
  try {
    await api.logout();
  } finally {
    clearUser();
    await router.replace({ name: "login" });
  }
}
</script>

<template>
  <header class="header">
    <div class="header__start">
      <RouterLink to="/" class="header__home"><AppLogo /></RouterLink>
      <nav v-if="currentUser" :aria-label="$t('header.mainNav')">
        <RouterLink to="/" class="nav-link" active-class="nav-link--active">{{ $t("nav.overview") }}</RouterLink>
      </nav>
    </div>
    <div class="header__end">
      <HostStatus v-if="currentUser" class="header__host" />
      <HeaderControls />
      <div v-if="currentUser" class="user">
        <span class="user__name muted">{{ currentUser.username }}</span>
        <button type="button" class="btn btn--small" @click="logout">{{ $t("auth.logout") }}</button>
      </div>
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

.header__end {
  gap: var(--ww-space-4);
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

.user {
  display: flex;
  align-items: center;
  gap: var(--ww-space-2);
}

.user__name {
  font-size: var(--ww-size-sm);
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

  nav,
  .user__name {
    display: none;
  }
}
</style>
