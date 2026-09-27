<script setup lang="ts">
import type { Alert } from "@wickwatch/core";
import { useI18n } from "vue-i18n";

defineProps<{ alerts: Alert[] }>();
const { t } = useI18n();

const message = (alert: Alert) =>
  t(`alert.${alert.code}`, {
    ...alert.params,
    subject: alert.subject,
    ...(alert.code === "account_error" ? { reason: t(`error.adapter.${String(alert.params["reason"])}`) } : {}),
  });
</script>

<template>
  <section v-if="alerts.length" class="alerts" :aria-label="$t('overview.alerts')">
    <div v-for="alert in alerts" :key="`${alert.code}:${alert.subject}`" class="alert" :class="`alert--${alert.level}`">
      <span class="alert__level">{{ $t(`alert.level.${alert.level}`) }}</span>
      <span>{{ message(alert) }}</span>
      <!-- Bot output stays untranslated. -->
      <span v-if="alert.params['detail']" class="alert__detail mono">{{ alert.params["detail"] }}</span>
    </div>
  </section>
</template>

<style scoped>
.alerts {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
}

.alert {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  align-items: baseline;
  padding: var(--ww-space-3) var(--ww-space-4);
  border: 1px solid;
  border-radius: var(--ww-radius-lg);
}

.alert--error {
  border-color: color-mix(in srgb, var(--ww-negative) 35%, transparent);
  background: var(--ww-negative-bg);
}

.alert--warning {
  border-color: color-mix(in srgb, var(--ww-warning) 35%, transparent);
  background: var(--ww-warning-bg);
}

.alert__level {
  font-weight: 700;
}

.alert--error .alert__level {
  color: var(--ww-negative);
}

.alert--warning .alert__level {
  color: var(--ww-warning);
}

.alert__detail {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
}
</style>
