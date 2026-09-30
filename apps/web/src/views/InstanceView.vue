<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { ApiError, api, errorKey, type InstanceAction, type ManagedInstanceDetail } from "../api";
import AppBanner from "../components/AppBanner.vue";
import AppIcon from "../components/AppIcon.vue";
import AppSpinner from "../components/AppSpinner.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import IconButton from "../components/IconButton.vue";
import InstanceConfigTab from "../components/InstanceConfigTab.vue";
import InstanceOverviewTab, { type Range } from "../components/InstanceOverviewTab.vue";
import MenuButton, { type MenuItem } from "../components/MenuButton.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { usePolling } from "../composables/usePolling";
import { durationParts, formatDateTime } from "../format";
import { isActive, isOutdated, outdatedText } from "../instance-state";
import { isAdmin } from "../session";
import { system } from "../system";

/**
 * One instance: the page head with status and actions, then the tabs "Overview" (route `instance`) and
 * "Configuration" (route `instance-config`). Both routes use this component, so switching tabs keeps the loaded data.
 */
const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const instanceRef = computed(() => String(route.params["ref"]));
const tab = computed(() => (route.name === "instance-config" ? "config" : "overview"));
const days = ref<Range>(30);

const { data, error, now, refresh } = usePolling(() => api.instance(instanceRef.value, days.value), 30_000);
watch([instanceRef, days], () => void refresh());
/** The runtime does not know the instance, e.g. a configuration without a container yet. */
const noContainer = computed(() => error.value instanceof ApiError && error.value.status === 404);

/** Set when Wickwatch manages this instance's configuration. */
const managed = ref<ManagedInstanceDetail>();
const managedLoaded = ref(false);
async function loadManaged() {
  const name = instanceRef.value;
  try {
    const m = await api.managedInstance(name);
    if (name === instanceRef.value) managed.value = m;
  } catch {
    if (name === instanceRef.value) managed.value = undefined;
  } finally {
    managedLoaded.value = true;
  }
}
watch(
  instanceRef,
  () => {
    managed.value = undefined;
    managedLoaded.value = false;
    void loadManaged();
  },
  { immediate: true },
);
async function reload() {
  await Promise.all([loadManaged(), refresh()]);
}

const name = computed(() => data.value?.instance.name ?? managed.value?.name ?? instanceRef.value);
const status = computed(() => data.value?.instance.status ?? managed.value?.deployment?.status);
/** Configuration version the container was created with, if Wickwatch created it. */
const runningVersion = computed(() => {
  const d = managed.value?.deployment;
  return d?.managed ? d.configVersion : undefined;
});

/** The container runs another configuration than the saved one (applied in the configuration tab). */
const outdated = computed(() => (isOutdated(managed.value) ? managed.value : undefined));

/** An account Wickwatch knows gets a link to its page; one only seen in the labels stays plain text. */
const knownAccount = computed(() => {
  const a = data.value?.account ?? managed.value?.account;
  return a ? { number: a.number, label: `${a.displayName} · ${a.number}` } : undefined;
});
const meta = computed(() => {
  const d = data.value;
  const m = managed.value;
  if (d) {
    const i = d.instance;
    return [knownAccount.value ? undefined : i.account, i.symbol, i.period, i.image].filter(Boolean).join(" · ");
  }
  if (m) return [m.config.symbol, m.config.period].join(" · ");
  return "";
});

const uptime = computed(() => {
  const i = data.value?.instance;
  if (!i || i.status !== "running" || !i.startedAt) return undefined;
  const { key, params } = durationParts(i.startedAt, now.value);
  return t("instance.runningFor", { duration: t(key, params) });
});

const busy = ref(false);
const notice = ref<string>();

async function act(action: InstanceAction) {
  busy.value = true;
  notice.value = undefined;
  try {
    await api.instanceAction(instanceRef.value, action);
  } catch (e) {
    notice.value = t("notice.actionFailed", {
      action: t(`action.${action}`),
      name: name.value,
      reason: t(errorKey(e)),
    });
  } finally {
    busy.value = false;
    await reload();
  }
}

/** Parameter files come in the config adapter's first format, e.g. .cbotset. */
const format = computed(() => (system.value?.parameterFormats ?? [])[0]);
const moreItems = computed<MenuItem[]>(() => [
  { id: "duplicate", label: t("action.duplicate"), icon: "duplicate" },
  ...(format.value
    ? [{ id: "download", label: t("instanceConfig.download", { format: format.value }), icon: "download" as const }]
    : []),
  { id: "delete", label: t("action.delete"), icon: "trash", danger: true, separated: true },
]);

const deleting = ref(false);
const deleteMessage = computed(() => {
  const confirm = t("instanceConfig.deleteConfirm", { name: name.value });
  return managed.value?.deployment?.managed ? `${confirm} ${t("instanceConfig.deleteContainer")}` : confirm;
});
function onMore(id: string) {
  const m = managed.value;
  if (!m) return;
  if (id === "duplicate") void router.push({ name: "instance-new", query: { from: m.name } });
  else if (id === "delete") deleting.value = true;
  else if (id === "download") {
    const link = document.createElement("a");
    link.href = api.parameterFileUrl(m.name, m.config.version);
    link.download = "";
    link.click();
  }
}

async function remove() {
  deleting.value = false;
  try {
    await api.deleteManagedInstance(instanceRef.value);
    await router.push({ name: "overview" });
  } catch (e) {
    notice.value = t(errorKey(e));
  }
}
</script>

<template>
  <div class="detail">
    <RouterLink to="/" class="back">{{ $t("instance.back") }}</RouterLink>

    <p
      v-if="(error && !data && !noContainer) || (noContainer && managedLoaded && !managed)"
      class="tone-negative"
      role="alert"
    >
      {{ $t(errorKey(error)) }}
    </p>
    <AppSpinner v-else-if="!data && !managed" />

    <template v-if="data || managed">
      <section class="head">
        <div class="head__title">
          <div class="head__name">
            <h1 class="mono">{{ name }}</h1>
            <StatusBadge
              :instance="status"
              :connection-lost="!!data?.instance.connectionLostSince"
              :not-created="!data && !!managed && !managed.deployment"
            />
          </div>
          <p class="muted head__meta">
            <RouterLink v-if="knownAccount" :to="{ name: 'account', params: { number: knownAccount.number } }">{{
              knownAccount.label
            }}</RouterLink>
            <template v-if="meta">{{ knownAccount ? ` · ${meta}` : meta }}</template>
            <template v-if="runningVersion">
              · {{ $t("instance.configVersion", { version: runningVersion }) }}</template
            >
            <template v-if="uptime"> · {{ uptime }}</template>
            <template v-if="data?.instance.restartCount">
              · {{ $t("instance.restarts", { count: data.instance.restartCount }) }}
            </template>
          </p>
        </div>
        <div v-if="isAdmin" class="head__actions">
          <template v-if="status">
            <IconButton
              v-if="isActive(status)"
              icon="stop"
              :label="$t('action.stop')"
              show-label
              :disabled="busy"
              @click="act('stop')"
            />
            <IconButton
              v-else
              icon="play"
              :label="$t('action.start')"
              show-label
              :disabled="busy"
              @click="act('start')"
            />
            <IconButton
              icon="restart"
              :label="$t('action.restart')"
              show-label
              :disabled="busy"
              @click="act('restart')"
            />
          </template>
          <template v-if="managed">
            <IconButton
              icon="edit"
              :label="$t('action.edit')"
              show-label
              :to="{ name: 'instance-edit', params: { ref: managed.name } }"
            />
            <MenuButton :label="$t('instance.more')" :items="moreItems" @select="onMore">
              <AppIcon name="more" />
              <!-- On phones the button is as wide as the others and says what it is. -->
              <span class="more-label">{{ $t("instance.moreShort") }}</span>
            </MenuButton>
          </template>
        </div>
      </section>

      <p v-if="notice" class="tone-negative notice" role="alert">{{ notice }}</p>
      <p v-if="data?.instance.connectionLostSince" class="tone-warning" role="alert">
        {{ $t("instance.connectionLost", { since: formatDateTime(locale, data.instance.connectionLostSince) }) }}
      </p>
      <div v-if="data?.instance.crashes" class="tone-negative crashes" role="alert">
        <p>
          {{
            $t("instance.crashes", {
              count: data.instance.crashes.count,
              last: formatDateTime(locale, data.instance.crashes.lastAt),
            })
          }}
        </p>
        <!-- Bot output stays untranslated. -->
        <p class="mono crashes__line">{{ data.instance.crashes.lastText }}</p>
      </div>

      <nav class="tabs" :aria-label="$t('instance.sections')">
        <RouterLink :to="{ name: 'instance', params: { ref: instanceRef } }" class="tabs__link">
          {{ $t("instance.overviewTab") }}
        </RouterLink>
        <RouterLink :to="{ name: 'instance-config', params: { ref: instanceRef } }" class="tabs__link">
          {{ $t("instance.config") }}
        </RouterLink>
      </nav>

      <template v-if="tab === 'overview'">
        <!-- Same message as in the configuration tab; applying stays there, so this only links to it. -->
        <AppBanner v-if="outdated" tone="warning" :title="$t('alert.level.warning')">
          <span>{{ outdatedText($t, outdated) }}</span>
          <template #actions>
            <RouterLink :to="{ name: 'instance-config', params: { ref: instanceRef } }" class="btn">
              {{ $t("deploy.toConfig") }}
            </RouterLink>
          </template>
        </AppBanner>
        <InstanceOverviewTab v-if="data" v-model:days="days" :data="data" @refresh="refresh" />
        <p v-else-if="noContainer" class="muted">
          {{ $t("instance.notCreated") }}
        </p>
      </template>
      <InstanceConfigTab v-else :managed="managed" :labels="data?.instance.labels" @changed="reload" />
    </template>

    <ConfirmDialog
      :open="deleting"
      :title="$t('action.delete')"
      :message="deleteMessage"
      :confirm-label="$t('action.delete')"
      @confirm="remove"
      @cancel="deleting = false"
    />
  </div>
</template>

<style scoped src="../styles/page-head.css"></style>

<style scoped>
.detail {
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

h1 {
  word-break: break-all;
}

.head__actions {
  align-items: center;
}

.detail > p {
  margin: 0;
}

.crashes {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-1);
}

.crashes p {
  margin: 0;
}

.crashes__line {
  overflow-wrap: anywhere;
  font-size: var(--ww-size-sm);
}

.tabs {
  display: flex;
  gap: var(--ww-space-5);
  border-bottom: 1px solid var(--ww-border);
}

.tabs__link {
  margin-bottom: -1px;
  padding: var(--ww-space-2) 0;
  border-bottom: 2px solid transparent;
  color: var(--ww-text-muted);
  font-weight: 500;
  text-decoration: none;
}

.tabs__link:hover {
  color: var(--ww-text);
}

/* The active tab is marked by weight and text colour as well as the line, not by colour alone. */
.tabs__link[aria-current="page"] {
  border-bottom-color: var(--ww-accent);
  color: var(--ww-text);
  font-weight: 700;
}

.more-label {
  display: none;
}

@media (max-width: 640px) {
  /* The "more" trigger looks like the buttons next to it here, not like a frameless icon. */
  .head__actions :deep(.menu-button > .btn) {
    width: 100%;
    border-color: var(--ww-border);
    background: var(--ww-surface-raised);
    color: var(--ww-text);
    font-weight: 600;
  }

  .more-label {
    display: inline;
  }

  .detail {
    padding: var(--ww-space-4);
  }
}

@media (pointer: coarse) {
  .tabs__link {
    display: flex;
    align-items: center;
    min-height: var(--ww-touch-target);
  }
}
</style>
