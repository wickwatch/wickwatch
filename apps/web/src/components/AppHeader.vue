<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { api } from "../api";
import { clearUser, currentUser, initials, isAdmin } from "../session";
import AppIcon from "./AppIcon.vue";
import AppLogo from "./AppLogo.vue";
import HeaderControls from "./HeaderControls.vue";
import HostStatus from "./HostStatus.vue";
import MenuButton, { type MenuItem } from "./MenuButton.vue";

const router = useRouter();
const { t } = useI18n();
const userInitials = computed(() => (currentUser.value ? initials(currentUser.value.username) : ""));
const userItems = computed<MenuItem[]>(() => [
  { id: "profile", label: t("profile.title"), icon: "user" },
  ...(isAdmin.value
    ? [
        { id: "audit", label: t("audit.title"), icon: "list" as const },
        { id: "api-tokens", label: t("apiTokens.title"), icon: "key" as const },
      ]
    : []),
  { id: "logout", label: t("auth.logout"), icon: "logout", separated: true },
]);

function onUserMenu(id: string) {
  if (id === "profile") void router.push({ name: "profile" });
  else if (id === "audit" || id === "api-tokens") void router.push({ name: id });
  else if (id === "logout") void logout();
}

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
        <RouterLink to="/" class="nav-link" exact-active-class="nav-link--active">{{ $t("nav.overview") }}</RouterLink>
        <RouterLink to="/accounts" class="nav-link" active-class="nav-link--active">{{
          $t("nav.accounts")
        }}</RouterLink>
        <RouterLink to="/algos" class="nav-link" active-class="nav-link--active">{{ $t("nav.algos") }}</RouterLink>
      </nav>
    </div>
    <div class="header__end">
      <HostStatus v-if="currentUser" class="header__host" />
      <div class="header__controls">
        <HeaderControls />
        <MenuButton
          v-if="currentUser"
          :label="$t('header.userMenu')"
          :items="userItems"
          :icon-trigger="false"
          class="user-menu"
          @select="onUserMenu"
        >
          <span class="user">
            <span class="user__avatar" aria-hidden="true">{{ userInitials }}</span>
            <span class="user__text">
              <span class="user__name">{{ currentUser.username }}</span>
              <span class="user__role">{{ $t(`profile.roles.${currentUser.role}`) }}</span>
            </span>
            <span class="visually-hidden">{{ $t("header.userMenu") }}</span>
            <AppIcon name="chevronDown" :size="16" class="user__chevron" />
          </span>
          <template #heading>{{ $t("header.signedInAs", { user: currentUser.username }) }}</template>
        </MenuButton>
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

.header__controls {
  display: flex;
  align-items: center;
  gap: var(--ww-space-1);
}

.user-menu {
  margin-left: var(--ww-space-2);
}

.user {
  display: flex;
  align-items: center;
  gap: var(--ww-space-3);
  min-height: var(--ww-touch-target);
  padding: var(--ww-space-1) var(--ww-space-3) var(--ww-space-1) var(--ww-space-1);
  border-radius: var(--ww-radius-lg);
  color: var(--ww-text);
}

/* No frame at rest, like the ghost icon buttons next to it; a surface on hover and while the menu is open. */
.user-menu:hover .user,
.user-menu [aria-expanded="true"] .user {
  background: var(--ww-surface-raised);
}

.user__chevron {
  color: var(--ww-text-muted);
}

.user__avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--ww-radius-full);
  background: var(--ww-accent);
  color: var(--ww-on-accent);
  font-size: var(--ww-size-sm);
  font-weight: 700;
}

.user__text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.user__name {
  font-size: var(--ww-size-sm);
  font-weight: 600;
}

.user__role {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
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

  .user {
    padding: var(--ww-space-1);
  }

  .user__text,
  .user__chevron {
    display: none;
  }

  /* Logo and controls on the first row, the navigation as its own scrollable row below. */
  .header__start {
    display: contents;
  }

  nav {
    order: 3;
    display: flex;
    width: 100%;
    overflow-x: auto;
    gap: var(--ww-space-1);
  }

  .nav-link {
    flex: none;
  }
}
</style>
