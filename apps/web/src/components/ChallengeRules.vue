<script setup lang="ts">
import type { ChallengeEvaluation, RuleResult, RuleStatus } from "@wickwatch/core";
import { ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import { formatPercentValue } from "../format";
import AppIcon from "./AppIcon.vue";

/**
 * collapsible: the rules fold away behind the head (account cards), always closed at first; a warning or breach shows as
 * the badge in the head, so the cards keep the same height.
 */
const props = defineProps<{ challenge: ChallengeEvaluation; collapsible?: boolean }>();
const { t, locale } = useI18n();
const id = useId();
const open = ref(!props.collapsible);

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

const title = () =>
  [t("challenge.label"), props.challenge.phase, t("challenge.day", { day: props.challenge.day })]
    .filter(Boolean)
    .join(" · ");

function value(rule: RuleResult): string {
  // A partial count would look final; say that it is still loading instead.
  if (rule.pending) return t("challenge.pending");
  if (rule.unit === "days") return t("challenge.ofValue", { value: rule.value, limit: rule.limit });
  const format = (n: number) => formatPercentValue(locale.value, n);
  return t("challenge.ofValue", { value: format(rule.value), limit: format(rule.limit) });
}
</script>

<template>
  <div class="challenge">
    <div class="challenge__head">
      <button
        v-if="collapsible"
        type="button"
        class="challenge__toggle"
        :aria-expanded="open"
        :aria-controls="`${id}-rules`"
        @click="open = !open"
      >
        <AppIcon name="chevronDown" class="challenge__chevron" :size="16" />
        <span class="challenge__title">{{ title() }}</span>
      </button>
      <span v-else class="challenge__title">{{ title() }}</span>
      <!-- "Running" would repeat the account status; show only states worth noticing. -->
      <span v-if="challenge.status !== 'running'" class="pill" :class="STATUS_TONES[challenge.status]">
        {{ $t(`challenge.status.${challenge.status}`) }}
      </span>
    </div>
    <!-- Rows 0fr ↔ 1fr let the rules slide open and shut; inert keeps them out of reach while shut. -->
    <div :id="`${id}-rules`" class="challenge__rules" :class="{ 'challenge__rules--closed': !open }" :inert="!open">
      <div class="challenge__clip">
        <div class="challenge__list">
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
              v-if="!rule.pending && ['warning', 'danger', 'breached', 'reached'].includes(rule.status)"
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
      </div>
    </div>
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

.challenge__rules {
  display: grid;
  grid-template-rows: 1fr;
  /* The list brings its own top space, so nothing is left over while shut. */
  margin-top: calc(-1 * var(--ww-space-3));
  transition:
    grid-template-rows 0.25s ease,
    visibility 0.25s;
}

.challenge__rules--closed {
  grid-template-rows: 0fr;
  visibility: hidden;
}

.challenge__clip {
  min-height: 0;
  overflow: hidden;
}

.challenge__list {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-3);
  padding-top: var(--ww-space-3);
}

@media (prefers-reduced-motion: reduce) {
  .challenge__rules,
  .challenge__chevron {
    transition: none;
  }
}

.challenge__toggle {
  display: flex;
  gap: var(--ww-space-2);
  align-items: center;
  min-height: var(--ww-touch-target);
  padding: 0;
  border: 0;
  background: none;
  color: var(--ww-text-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.challenge__chevron {
  flex: none;
  transform: rotate(-90deg);
  transition: transform 0.15s;
}

.challenge__toggle[aria-expanded="true"] .challenge__chevron {
  transform: none;
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
