<script setup lang="ts">
import type { InstanceSummary } from "@wickwatch/core";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { api, errorKey, type InstanceAction } from "../api";
import AlertList from "../components/AlertList.vue";
import AppModal from "../components/AppModal.vue";
import ChallengeForm from "../components/ChallengeForm.vue";
import ChallengeRules from "../components/ChallengeRules.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import IconButton from "../components/IconButton.vue";
import InstanceTable from "../components/InstanceTable.vue";
import SignedValue from "../components/SignedValue.vue";
import StatusBadge from "../components/StatusBadge.vue";
import TradeTables from "../components/TradeTables.vue";
import { hasSomethingToStop, useEmergencyStop } from "../composables/useEmergencyStop";
import { usePolling } from "../composables/usePolling";
import { useTradeActions } from "../composables/useTradeActions";
import { formatNumber } from "../format";
import { isAdmin } from "../session";
import { system } from "../system";

/**
 * One trading account: its instances, all its open positions and pending orders (manual ones included, each with the
 * instance it belongs to), and its challenge profile, edited in a modal.
 */
const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const number = computed(() => String(route.params["number"]));

const { data, error, now, refresh } = usePolling(() => api.accountDetail(number.value), 30_000);
watch(number, () => void refresh());
const account = computed(() => data.value?.account);

const notice = ref<{ tone: "positive" | "negative"; text: string }>();
const { busy, closing, cancelling, closeMessage, cancelMessage, closePosition, cancelOrder } = useTradeActions(
  () => number.value,
  notice,
  refresh,
);
const { confirming, running, message: stopMessage, stop } = useEmergencyStop(notice, refresh);
const canStop = computed(
  () =>
    isAdmin.value &&
    (system.value?.capabilities.emergencyStop ?? false) &&
    account.value !== undefined &&
    hasSomethingToStop(account.value),
);
const accountNames = computed(() => new Map(account.value ? [[account.value.number, account.value.displayName]] : []));

const instanceBusy = reactive(new Set<string>());
async function runAction(instance: InstanceSummary, action: InstanceAction) {
  instanceBusy.add(instance.ref);
  notice.value = undefined;
  try {
    await api.instanceAction(instance.ref, action);
  } catch (e) {
    notice.value = {
      tone: "negative",
      text: t("notice.actionFailed", { action: t(`action.${action}`), name: instance.name, reason: t(errorKey(e)) }),
    };
  } finally {
    instanceBusy.delete(instance.ref);
    await refresh();
  }
}

/** The challenge modal; `?challenge=edit` (the old editor's address) opens it. */
const editing = ref(false);
const dirty = ref(false);
onMounted(() => {
  if (route.query["challenge"] !== undefined && isAdmin.value) editing.value = true;
});
function closeEditor() {
  editing.value = false;
  dirty.value = false;
  if (route.query["challenge"] !== undefined) void router.replace({ query: {} });
}
async function profileChanged() {
  closeEditor();
  await refresh();
}

const money = (value: number | undefined) =>
  value === undefined ? t("format.none") : formatNumber(locale.value, value);
const meta = computed(() => {
  const a = account.value;
  if (!a) return "";
  return [t("account.number", { number: a.number }), a.broker, a.currency, a.credentialLabel]
    .filter(Boolean)
    .join(" · ");
});
</script>

<template>
  <div class="page">
    <RouterLink to="/" class="back">{{ $t("instance.back") }}</RouterLink>

    <p v-if="error && !data" class="tone-negative" role="alert">{{ $t(errorKey(error)) }}</p>
    <p v-else-if="!data" class="muted">{{ $t("overview.loading") }}</p>

    <template v-if="data && account">
      <section class="head">
        <div>
          <div class="head__name">
            <h1>{{ account.displayName }}</h1>
            <StatusBadge :account="account.state" />
          </div>
          <p class="muted head__meta">{{ meta }}</p>
        </div>
        <div v-if="isAdmin" class="head__actions">
          <IconButton
            :icon="account.challenge ? 'edit' : 'plus'"
            :label="account.challenge ? $t('challenge.edit') : $t('challenge.add')"
            show-label
            @click="editing = true"
          />
          <button
            v-if="canStop"
            type="button"
            class="btn btn--danger"
            :disabled="running === account.number"
            @click="confirming = account"
          >
            {{ $t("action.emergencyStop") }}
          </button>
        </div>
      </section>

      <p class="notice" :class="notice ? `tone-${notice.tone}` : ''" role="status" aria-live="polite">
        {{ notice?.text }}
      </p>
      <AlertList :alerts="data.alerts" />
      <p v-if="account.error" class="tone-negative" role="alert">{{ $t(`error.adapter.${account.error}`) }}</p>

      <div class="summary">
        <dl class="panel kpis" :class="{ 'kpis--list': account.challenge }">
          <div>
            <dt>{{ $t("account.balance") }}</dt>
            <dd class="mono">{{ money(account.balance) }}</dd>
          </div>
          <div>
            <dt>{{ $t("account.equity") }}</dt>
            <dd class="mono">{{ money(account.equity) }}</dd>
          </div>
          <div>
            <dt>{{ $t("account.dayPnl") }}</dt>
            <dd><SignedValue :value="account.dayPnl" /></dd>
          </div>
          <div>
            <dt>{{ $t("account.openPositions") }}</dt>
            <dd class="mono">{{ account.openPositions }}</dd>
          </div>
          <div v-if="account.pendingOrders !== undefined">
            <dt>{{ $t("account.pendingOrders") }}</dt>
            <dd class="mono">{{ account.pendingOrders }}</dd>
          </div>
        </dl>
        <section v-if="account.challenge" class="panel card" aria-labelledby="challenge-title">
          <h2 id="challenge-title">{{ $t("challenge.label") }}</h2>
          <ChallengeRules :challenge="account.challenge" />
        </section>
      </div>

      <section class="panel card" aria-labelledby="instances-title">
        <h2 id="instances-title">{{ $t("overview.instances") }}</h2>
        <p v-if="!data.instances.length" class="muted">{{ $t("account.state.idle") }}</p>
        <InstanceTable
          v-else
          :instances="data.instances"
          :account-names="accountNames"
          :show-account="false"
          :busy="instanceBusy"
          :now="now"
          :can-act="isAdmin"
          @action="runAction"
        />
      </section>

      <section class="panel card" aria-labelledby="positions-title">
        <h2 id="positions-title">{{ $t("instance.positions") }}</h2>
        <p v-if="!data.positions.length" class="muted">{{ $t("instance.noPositions") }}</p>
        <TradeTables
          v-else
          kind="positions"
          :positions="data.positions"
          :instances="data.instances"
          :can-close="isAdmin"
          :busy="busy"
          @close="closing = $event"
        />
      </section>

      <section class="panel card" aria-labelledby="orders-title">
        <h2 id="orders-title">{{ $t("instance.pendingOrders") }}</h2>
        <p v-if="!data.pendingOrders.length" class="muted">{{ $t("instance.noOrders") }}</p>
        <TradeTables
          v-else
          kind="orders"
          :orders="data.pendingOrders"
          :instances="data.instances"
          :can-cancel="isAdmin"
          :busy="busy"
          @cancel="cancelling = $event"
        />
      </section>
    </template>

    <ConfirmDialog
      :open="closing !== undefined"
      :title="$t('instance.closeTitle')"
      :message="closeMessage"
      :confirm-label="$t('action.closePosition')"
      @confirm="closePosition"
      @cancel="closing = undefined"
    />
    <ConfirmDialog
      :open="cancelling !== undefined"
      :title="$t('instance.cancelTitle')"
      :message="cancelMessage"
      :confirm-label="$t('action.cancelOrder')"
      @confirm="cancelOrder"
      @cancel="cancelling = undefined"
    />
    <ConfirmDialog
      :open="confirming !== undefined"
      :title="$t('emergencyStop.title')"
      :message="stopMessage"
      :confirm-label="$t('emergencyStop.confirmAction')"
      @confirm="stop"
      @cancel="confirming = undefined"
    />
    <AppModal
      :open="editing"
      :title="$t('challenge.editorTitle', { account: number })"
      :dirty="dirty"
      @close="closeEditor"
    >
      <ChallengeForm
        :number="number"
        @saved="profileChanged"
        @deleted="profileChanged"
        @cancel="closeEditor"
        @dirty="dirty = $event"
      />
    </AppModal>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-5);
  min-width: 0;
  padding: var(--ww-space-6) var(--ww-space-10) var(--ww-space-10);
}

.back {
  align-self: flex-start;
  font-size: var(--ww-size-sm);
}

.head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-4);
  justify-content: space-between;
  align-items: flex-start;
}

.head__name {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  align-items: center;
}

h1 {
  margin: 0;
  font-size: var(--ww-size-3xl);
  letter-spacing: -0.02em;
}

.head__meta {
  margin: var(--ww-space-1) 0 0;
  font-size: var(--ww-size-sm);
}

.head__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}

.notice {
  margin: 0;
  font-weight: 600;
}

.notice:empty {
  display: none;
}

p[role="alert"] {
  margin: 0;
}

.summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--ww-space-5);
  align-items: start;
}

.summary > :only-child {
  grid-column: 1 / -1;
}

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--ww-space-4);
  margin: 0;
  padding: var(--ww-space-5);
}

/* Next to the challenge: one figure per line, label left, value right. */
.kpis--list {
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
}

.kpis--list > div {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: var(--ww-space-2) 0;
  border-bottom: 1px solid var(--ww-border);
}

.kpis--list > div:last-child {
  border-bottom: 0;
}

.kpis--list dd {
  margin: 0;
}

.kpis dt {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
}

.kpis dd {
  margin: var(--ww-space-1) 0 0;
  font-size: var(--ww-size-lg);
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-3);
  min-width: 0;
  padding: var(--ww-space-5);
}

.card p {
  margin: 0;
}

@media (max-width: 1000px) {
  .summary {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .page {
    padding: var(--ww-space-4);
  }
}
</style>
