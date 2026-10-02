<script setup lang="ts">
import type { ManagedInstance } from "@wickwatch/core";
import { DEFAULT_LABEL_PREFIX } from "@wickwatch/core/rules";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorKey } from "../api";
import AccountCard from "../components/AccountCard.vue";
import AlertList from "../components/AlertList.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import IconButton from "../components/IconButton.vue";
import InstanceTable from "../components/InstanceTable.vue";
import type { Notice } from "../composables/notice";
import { useEmergencyStop } from "../composables/useEmergencyStop";
import { useInstanceActions } from "../composables/useInstanceActions";
import { usePolling } from "../composables/usePolling";
import { accountLabel, formatRelative } from "../format";
import { isAdmin } from "../session";
import { system } from "../system";
import AppSpinner from "../components/AppSpinner.vue";

const POLL_MS = 30_000;

const { locale } = useI18n();
const { data, error, updatedAt, now, stale, refresh } = usePolling(api.overview, POLL_MS);

const notice = ref<Notice>();
const filterAccount = ref("");
const onlyRunning = ref(false);

const accountNames = computed(() => new Map(data.value?.accounts.map((a) => [a.number, a.displayName]) ?? []));
const instances = computed(() =>
  (data.value?.instances ?? []).filter(
    (i) =>
      (!filterAccount.value || i.account === filterAccount.value) && (!onlyRunning.value || i.status === "running"),
  ),
);
const { confirming, running, message, stop } = useEmergencyStop(notice, refresh);
const { busy, runAction } = useInstanceActions(notice, refresh);
const canEmergencyStop = computed(() => isAdmin.value && (system.value?.capabilities.emergencyStop ?? false));
const managed = ref<ManagedInstance[]>([]);
onMounted(() => {
  api.managedInstances().then(
    (rows) => (managed.value = rows),
    () => undefined,
  );
});
/** Set up in wickwatch, but no runtime instance with that name (yet). */
const notRunning = computed(() =>
  managed.value.filter((m) => !(data.value?.instances ?? []).some((i) => i.ref === m.name || i.name === m.name)),
);
const instanceLabel = computed(() => `${system.value?.labelPrefix ?? DEFAULT_LABEL_PREFIX}.instance`);
</script>

<template>
  <div class="overview">
    <h1 class="visually-hidden">{{ $t("overview.title") }}</h1>

    <p class="notice" :class="notice ? `tone-${notice.tone}` : ''" role="status" aria-live="polite">
      {{ notice?.text }}
    </p>

    <p v-if="error" class="banner tone-negative" role="alert">
      {{ $t("overview.loadFailed") }} {{ $t(errorKey(error)) }}
    </p>

    <AppSpinner v-if="!data && !error" />

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
            :busy="running === account.number"
            @emergency-stop="confirming = $event"
          />
        </div>
      </section>

      <section class="section" aria-labelledby="instances-title">
        <div class="section__head">
          <h2 id="instances-title">{{ $t("overview.instances") }}</h2>
          <div class="filters">
            <IconButton
              v-if="isAdmin"
              icon="plus"
              :label="$t('action.newInstance')"
              show-label
              variant="primary"
              :to="{ name: 'instance-new' }"
            />
            <label class="filters__account">
              <span class="visually-hidden">{{ $t("overview.filterAccount") }}</span>
              <select v-model="filterAccount" class="btn">
                <option value="">{{ $t("overview.allAccounts") }}</option>
                <option v-for="a in data.accounts" :key="a.number" :value="a.number">
                  {{ accountLabel(a) }}
                </option>
              </select>
            </label>
            <button
              type="button"
              class="btn btn--ghost"
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

        <div v-if="notRunning.length" class="managed">
          <h3 id="managed-title">{{ $t("overview.notDeployed") }}</h3>
          <p class="muted">{{ $t("overview.notDeployedHint") }}</p>
          <ul class="managed__list" aria-labelledby="managed-title">
            <li v-for="m in notRunning" :key="m.id" class="panel managed__item">
              <RouterLink :to="{ name: 'instance-config', params: { ref: m.name } }" class="mono managed__name">
                {{ m.name }}
              </RouterLink>
              <span class="muted">
                {{
                  [
                    accountLabel(m.account),
                    `${m.config.algo.name} ${m.config.algo.version}`,
                    `${m.config.symbol} ${m.config.period}`,
                    $t("instanceConfig.version", { version: m.config.version }),
                  ].join(" · ")
                }}
              </span>
            </li>
          </ul>
        </div>
      </section>
    </template>

    <ConfirmDialog
      :open="confirming !== undefined"
      :title="$t('emergencyStop.title')"
      :message="message"
      :confirm-label="$t('emergencyStop.confirmAction')"
      @confirm="stop"
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

.managed {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
}

.managed h3,
.managed p {
  margin: 0;
}

.managed h3 {
  font-size: var(--ww-size-md);
}

.managed__list {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.managed__item {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  align-items: baseline;
  padding: var(--ww-space-3) var(--ww-space-4);
  font-size: var(--ww-size-sm);
}

.managed__name {
  font-weight: 600;
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

/* At most three accounts side by side: each card takes at least a third of the row (and 340 px, or the whole width). */
.accounts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(max(min(340px, 100%), calc((100% - 2 * var(--ww-space-5)) / 3)), 1fr));
  gap: var(--ww-space-5);
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
  align-items: center;
}

.filters .btn {
  white-space: nowrap;
}

.banner {
  margin: 0;
}

@media (max-width: 640px) {
  .overview {
    gap: var(--ww-space-6);
    padding: var(--ww-space-4);
  }

  /* Both buttons share one line in equal parts, the account filter full width below. */
  .filters {
    width: 100%;
  }

  .filters > .btn {
    flex: 1 1 0;
  }

  .filters__account {
    flex: 1 1 100%;
    order: 1;
  }

  .filters__account select {
    width: 100%;
  }
}
</style>
