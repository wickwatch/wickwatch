<script setup lang="ts">
import type { AccountSummary } from "@wickwatch/core";
import { useI18n } from "vue-i18n";
import { formatNumber } from "../format";
import ChallengeRules from "./ChallengeRules.vue";
import SignedValue from "./SignedValue.vue";
import StatusBadge from "./StatusBadge.vue";

defineProps<{ account: AccountSummary; canEmergencyStop: boolean; canEdit: boolean; busy: boolean }>();
defineEmits<{ emergencyStop: [account: AccountSummary] }>();
const { locale } = useI18n();
</script>

<template>
  <article class="card panel">
    <div class="card__head">
      <div class="card__title">
        <h3>{{ account.displayName }}</h3>
        <div class="mono muted card__meta">
          {{ [$t("account.number", { number: account.number }), account.currency].filter(Boolean).join(" · ") }}
        </div>
        <div v-if="account.credentialLabel" class="muted card__meta">{{ account.credentialLabel }}</div>
      </div>
      <StatusBadge :account="account.state" />
    </div>

    <p v-if="account.error" class="tone-negative card__error">{{ $t(`error.adapter.${account.error}`) }}</p>
    <dl class="card__kpis">
      <div>
        <dt>{{ $t("account.balance") }}</dt>
        <dd class="mono">
          {{ account.balance === undefined ? $t("format.none") : formatNumber(locale, account.balance) }}
        </dd>
      </div>
      <div>
        <dt>{{ $t("account.equity") }}</dt>
        <dd class="mono">
          {{ account.equity === undefined ? $t("format.none") : formatNumber(locale, account.equity) }}
        </dd>
      </div>
      <div>
        <dt>{{ $t("account.dayPnl") }}</dt>
        <dd><SignedValue :value="account.dayPnl" /></dd>
      </div>
    </dl>

    <div class="card__profile">
      <ChallengeRules v-if="account.challenge" :challenge="account.challenge" />
      <template v-else>
        <div class="muted">{{ $t("account.noProfileHint") }}</div>
        <div class="card__row muted">
          <span>{{ $t("account.openPositions") }}</span>
          <span class="mono card__value">{{ account.openPositions }}</span>
        </div>
      </template>
      <RouterLink v-if="canEdit" :to="{ name: 'challenge', params: { number: account.number } }" class="card__link">
        {{ account.challenge ? $t("challenge.edit") : $t("challenge.add") }}
      </RouterLink>
    </div>

    <div class="card__foot">
      <span class="muted card__meta">
        {{ $t("account.instancesActive", account.instances, account.instances.total) }}
      </span>
      <button
        v-if="canEmergencyStop"
        type="button"
        class="btn btn--danger"
        :disabled="busy"
        @click="$emit('emergencyStop', account)"
      >
        {{ $t("action.emergencyStop") }}
      </button>
    </div>
  </article>
</template>

<style scoped>
.card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
  padding: var(--ww-space-5);
}

.card__head,
.card__foot,
.card__row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--ww-space-3);
}

.card__foot {
  align-items: center;
  margin-top: auto;
}

h3 {
  margin: 0 0 var(--ww-space-1);
  font-size: var(--ww-size-lg);
  font-weight: 600;
}

.card__meta {
  font-size: var(--ww-size-xs);
}

.card__error {
  margin: 0;
  font-size: var(--ww-size-sm);
}

.card__kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--ww-space-3);
  margin: 0;
}

dt {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
}

dd {
  margin: var(--ww-space-1) 0 0;
  font-size: 15px;
}

.card__profile {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
  padding-top: var(--ww-space-4);
  border-top: 1px solid var(--ww-border);
  font-size: var(--ww-size-sm);
}

.card__value {
  color: var(--ww-text);
}

.card__link {
  font-size: var(--ww-size-sm);
  font-weight: 600;
}
</style>
