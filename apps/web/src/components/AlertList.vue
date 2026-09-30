<script setup lang="ts">
import type { Alert } from "@wickwatch/core";
import { useI18n } from "vue-i18n";
import { formatDateTime } from "../format";
import AppBanner from "./AppBanner.vue";

defineProps<{ alerts: Alert[] }>();
const { t, locale } = useI18n();
const TONES = { error: "negative", warning: "warning", info: "positive" } as const;

const message = (alert: Alert) =>
  t(`alert.${alert.code}`, {
    ...alert.params,
    subject: alert.subject,
    ...(alert.code === "account_error" ? { reason: t(`error.adapter.${String(alert.params["reason"])}`) } : {}),
    ...(alert.params["rule"] !== undefined ? { rule: t(`challenge.rule.${String(alert.params["rule"])}`) } : {}),
    ...(alert.params["since"] !== undefined
      ? { since: formatDateTime(locale.value, String(alert.params["since"])) }
      : {}),
    ...(alert.params["last"] !== undefined ? { last: formatDateTime(locale.value, String(alert.params["last"])) } : {}),
  });
</script>

<template>
  <section v-if="alerts.length" class="alerts" :aria-label="$t('overview.alerts')">
    <AppBanner
      v-for="alert in alerts"
      :key="`${alert.code}:${alert.subject}`"
      :tone="TONES[alert.level]"
      :title="$t(`alert.level.${alert.level}`)"
    >
      <span>{{ message(alert) }}</span>
      <!-- Bot output stays untranslated. -->
      <span v-if="alert.params['detail']" class="alert__detail mono">{{ alert.params["detail"] }}</span>
    </AppBanner>
  </section>
</template>

<style scoped>
.alerts {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
}

.alert__detail {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
}
</style>
