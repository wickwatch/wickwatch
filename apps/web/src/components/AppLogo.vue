<script setup lang="ts">
import logoOnDark from "@assets/logo/wickwatch-logo-horizontal-dark.svg";
import logoOnLight from "@assets/logo/wickwatch-logo-horizontal-light.svg";
</script>

<template>
  <!-- Both variants from assets/logo; CSS shows the one matching the active theme. -->
  <span class="logo">
    <img class="logo__on-dark" :src="logoOnDark" :alt="$t('app.name')" height="30" />
    <img class="logo__on-light" :src="logoOnLight" :alt="$t('app.name')" height="30" />
  </span>
</template>

<style scoped>
.logo {
  display: inline-flex;
}

.logo img {
  height: 30px;
  width: auto;
}

.logo__on-dark {
  display: none;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .logo__on-dark {
    display: block;
  }

  :root:not([data-theme="light"]) .logo__on-light {
    display: none;
  }
}

:root[data-theme="dark"] .logo__on-dark {
  display: block;
}

:root[data-theme="dark"] .logo__on-light {
  display: none;
}
</style>
