<script setup lang="ts">
import type { ChallengeEvaluation, RuleResult, RuleStatus } from "@wickwatch/core";
import { useI18n } from "vue-i18n";
import { formatPercentValue } from "../format";

defineProps<{ challenge: ChallengeEvaluation }>();
const { t, locale } = useI18n();

const TONES: Record<RuleStatus, string> = {
  ok: "positive",
  warning: "warning",
  danger: "negative",
  breached: "negative",
  open: "info",
  reached: "positive",
};
/** Elapsed time is neither good nor bad: neutral until it runs out. */
const tone = (rule: RuleResult) => (rule.id === "duration" && rule.status === "ok" ? "info" : TONES[rule.status]);
const STATUS_TONES = {
  running: "tone-muted",
  warning: "tone-warning",
  breached: "tone-negative",
  passed: "tone-positive",
};

function value(rule: RuleResult): string {
  if (rule.unit === "days") return t("challenge.ofValue", { value: rule.value, limit: rule.limit });
  const format = (n: number) => formatPercentValue(locale.value, n);
  return t("challenge.ofValue", { value: format(rule.value), limit: format(rule.limit) });
}
</script>

<template>
  <div class="challenge">
    <div class="challenge__head">
      <span class="challenge__title">
        {{
          [$t("challenge.label"), challenge.phase, $t("challenge.day", { day: challenge.day })]
            .filter(Boolean)
            .join(" · ")
        }}
      </span>
      <!-- "Running" would repeat the account status; show only states worth noticing. -->
      <span v-if="challenge.status !== 'running'" class="pill" :class="STATUS_TONES[challenge.status]">
        {{ $t(`challenge.status.${challenge.status}`) }}
      </span>
    </div>
    <div v-for="rule in challenge.rules" :key="rule.id" class="rule">
      <div class="rule__row">
        <span>{{ $t(`challenge.rule.${rule.id}`) }}</span>
        <span class="mono">
          <span v-if="rule.approximate" :title="$t('challenge.approximate')">≈ </span>{{ value(rule) }}
        </span>
      </div>
      <div
        class="rule__track"
        role="meter"
        :aria-label="$t(`challenge.rule.${rule.id}`)"
        :aria-valuenow="Math.round(rule.usage * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="rule__fill"
          :class="`fill--${tone(rule)}`"
          :style="{ width: `${Math.min(100, Math.max(0, rule.usage * 100))}%` }"
        />
      </div>
      <!-- Colour never alone: limit states also get words. -->
      <span
        v-if="['warning', 'danger', 'breached', 'reached'].includes(rule.status)"
        class="rule__status"
        :class="`tone-${TONES[rule.status] === 'info' ? 'muted' : TONES[rule.status]}`"
      >
        {{ $t(`challenge.ruleStatus.${rule.status}`, { used: Math.round(rule.usage * 100) }) }}
      </span>
    </div>
    <p v-if="challenge.rules.some((r) => r.approximate)" class="challenge__note muted">
      ≈ {{ $t("challenge.approximate") }}
    </p>
  </div>
</template>

<style scoped>
.challenge {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-3);
}

.challenge__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ww-space-2);
}

.challenge__title {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.rule {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--ww-size-sm);
}

.rule__row {
  display: flex;
  justify-content: space-between;
  gap: var(--ww-space-2);
}

.rule__track {
  height: 6px;
  border-radius: 3px;
  background: var(--ww-border);
}

.rule__fill {
  height: 6px;
  border-radius: 3px;
}

.fill--positive {
  background: var(--ww-positive);
}

.fill--warning {
  background: var(--ww-warning);
}

.fill--negative {
  background: var(--ww-negative);
}

.fill--info {
  background: var(--ww-info);
}

.rule__status {
  font-size: var(--ww-size-xs);
  font-weight: 600;
}

.challenge__note {
  margin: 0;
  font-size: var(--ww-size-xs);
}
</style>
