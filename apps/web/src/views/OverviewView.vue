<script setup lang="ts">
import type { AccountSummary, InstanceSummary } from "@wickwatch/core";
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorKey, type InstanceAction } from "../api";
import AccountCard from "../components/AccountCard.vue";
import AlertList from "../components/AlertList.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import InstanceTable from "../components/InstanceTable.vue";
import { usePolling } from "../composables/usePolling";
import { formatRelative } from "../format";
import { isAdmin } from "../session";
import { system } from "../system";

const POLL_MS = 30_000;

const { t, locale } = useI18n();
const { data, error, updatedAt, now, stale, refresh } = usePolling(api.overview, POLL_MS);

const busy = reactive(new Set<string>());
const notice = ref<{ tone: "positive" | "negative"; text: string }>();
const filterAccount = ref("");
const onlyRunning = ref(false);
const confirming = ref<AccountSummary>();

const accountNames = computed(() => new Map(data.value?.accounts.map((a) => [a.number, a.displayName]) ?? []));
const instances = computed(() =>
  (data.value?.instances ?? []).filter(
    (i) =>
      (!filterAccount.value || i.account === filterAccount.value) && (!onlyRunning.value || i.status === "running"),
  ),
);
const canEmergencyStop = computed(() => isAdmin.value && (system.value?.capabilities.emergencyStop ?? false));
const instanceLabel = computed(() => `${system.value?.labelPrefix ?? "wickwatch"}.instance`);

async function runAction(instance: InstanceSummary, action: InstanceAction) {
  busy.add(instance.ref);
  notice.value = undefined;
  try {
    await api.instanceAction(instance.ref, action);
  } catch (e) {
    notice.value = {
      tone: "negative",
      text: t("notice.actionFailed", { action: t(`action.${action}`), name: instance.name, reason: t(errorKey(e)) }),
    };
  } finally {
    busy.delete(instance.ref);
    await refresh();
  }
}

async function emergencyStop() {
  const account = confirming.value;
  confirming.value = undefined;
  if (!account) return;
  busy.add(account.number);
  try {
    const report = await api.emergencyStop(account.number);
    const done = t("emergencyStop.done", {
      account: account.number,
      instances: report.stoppedInstances.length,
      closed: report.closed,
      cancelled: report.cancelled,
    });
    const partial = report.failedInstances.length
      ? ` ${t("emergencyStop.partial", { names: report.failedInstances.join(", ") })}`
      : "";
    notice.value = { tone: partial ? "negative" : "positive", text: done + partial };
  } catch (e) {
    notice.value = {
      tone: "negative",
      text: t("emergencyStop.failed", { account: account.number, reason: t(errorKey(e)) }),
    };
  } finally {
    busy.delete(account.number);
    await refresh();
  }
}
</script>

<template>
  <div class="overview">
    <h1 class="visually-hidden">{{ $t("overview.title") }}</h1>

    <p class="notice" :class="notice ? `notice--${notice.tone}` : ''" role="status" aria-live="polite">
      {{ notice?.text }}
    </p>

    <p v-if="error" class="banner tone-negative" role="alert">
      {{ $t("overview.loadFailed") }} {{ $t(errorKey(error)) }}
    </p>

    <p v-if="!data && !error" class="muted">{{ $t("overview.loading") }}</p>

    <template v-if="data">
      <AlertList :alerts="data.alerts" />

      <section class="section" aria-labelledby="accounts-title">
        <div class="section__head">
          <h2 id="accounts-title">{{ $t("overview.accounts") }}</h2>
          <span class="muted section__meta">
            <span v-if="stale" class="pill tone-warning">{{ $t("status.stale") }}</span>
            {{
              updatedAt
                ? $t("overview.updated", { time: formatRelative(locale, new Date(updatedAt).toISOString(), now) })
                : ""
            }}
            · {{ $t("overview.polling", { seconds: POLL_MS / 1000 }) }}
          </span>
        </div>
        <p v-if="!data.accounts.length" class="muted">{{ $t("overview.noAccounts") }}</p>
        <div class="accounts">
          <AccountCard
            v-for="account in data.accounts"
            :key="account.number"
            :account="account"
            :can-emergency-stop="canEmergencyStop"
            :can-edit="isAdmin"
            :busy="busy.has(account.number)"
            @emergency-stop="confirming = $event"
          />
        </div>
      </section>

      <section class="section" aria-labelledby="instances-title">
        <div class="section__head">
          <h2 id="instances-title">{{ $t("overview.instances") }}</h2>
          <div class="filters">
            <label>
              <span class="visually-hidden">{{ $t("overview.filterAccount") }}</span>
              <select v-model="filterAccount" class="btn btn--small">
                <option value="">{{ $t("overview.allAccounts") }}</option>
                <option v-for="a in data.accounts" :key="a.number" :value="a.number">
                  {{ a.displayName }} · {{ a.number }}
                </option>
              </select>
            </label>
            <button
              type="button"
              class="btn btn--ghost btn--small"
              :aria-pressed="onlyRunning"
              @click="onlyRunning = !onlyRunning"
            >
              {{ $t("overview.onlyRunning") }}
            </button>
          </div>
        </div>
        <p v-if="!data.instances.length" class="muted">{{ $t("overview.noInstances", { label: instanceLabel }) }}</p>
        <p v-else-if="!instances.length" class="muted">{{ $t("overview.noMatches") }}</p>
        <InstanceTable
          v-else
          :instances="instances"
          :account-names="accountNames"
          :busy="busy"
          :now="now"
          :can-act="isAdmin"
          @action="runAction"
        />
      </section>
    </template>

    <ConfirmDialog
      :open="confirming !== undefined"
      :title="$t('emergencyStop.title')"
      :message="
        confirming ? $t('confirm.emergencyStop', { account: `${confirming.displayName} · ${confirming.number}` }) : ''
      "
      :confirm-label="$t('emergencyStop.confirmAction')"
      @confirm="emergencyStop"
      @cancel="confirming = undefined"
    />
  </div>
</template>

<style scoped>
.overview {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-8);
  padding: var(--ww-space-8) var(--ww-space-10);
}

.section {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
}

.section__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  justify-content: space-between;
  align-items: baseline;
}

.section__meta {
  display: flex;
  gap: var(--ww-space-2);
  align-items: center;
  font-size: var(--ww-size-xs);
}

.accounts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
  gap: var(--ww-space-5);
}

.filters {
  display: flex;
  gap: var(--ww-space-2);
}

.notice {
  margin: 0;
  font-weight: 600;
}

.notice:empty {
  display: none;
}

.notice--positive {
  color: var(--ww-positive);
}

.notice--negative {
  color: var(--ww-negative);
}

.banner {
  margin: 0;
}

@media (max-width: 640px) {
  .overview {
    gap: var(--ww-space-6);
    padding: var(--ww-space-4);
  }
}
</style>
