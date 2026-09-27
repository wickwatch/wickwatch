<script setup lang="ts">
import type { TotpSetup } from "../api";

defineProps<{ totp: TotpSetup }>();
</script>

<template>
  <div class="enroll">
    <p class="muted">{{ $t("auth.totp.scan") }}</p>
    <img class="enroll__qr" :src="totp.qr" :alt="$t('auth.totp.qrAlt')" width="240" height="240" />
    <details>
      <summary>{{ $t("auth.totp.manual") }}</summary>
      <code class="mono enroll__secret">{{ totp.secret }}</code>
    </details>
  </div>
</template>

<style scoped>
.enroll {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-3);
}

p {
  margin: 0;
}

.enroll__qr {
  align-self: center;
  border-radius: var(--ww-radius-md);
}

.enroll__secret {
  display: block;
  margin-top: var(--ww-space-2);
  word-break: break-all;
}
</style>
