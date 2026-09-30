<script setup lang="ts">
import type { ParameterSchema } from "@wickwatch/core";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { api, errorKey, type AlgoRow, type InstanceConfigRow, type ManagedInstanceDetail } from "../api";
import { formatDateTime } from "../format";
import { isAdmin } from "../session";
import { system } from "../system";
import AppBanner from "./AppBanner.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import ParameterList from "./ParameterList.vue";

/**
 * The "Configuration" tab of an instance. `managed` is set when Wickwatch keeps the configuration; otherwise only the
 * runtime's `labels` are known.
 */
const props = defineProps<{
  managed?: ManagedInstanceDetail | undefined;
  labels?: Record<string, string> | undefined;
}>();
const emit = defineEmits<{ changed: [] }>();
const { t, locale } = useI18n();
const route = useRoute();

const busy = ref(false);
const notice = ref<string>();
const error = ref<string>();
/** Deploy action waiting for confirmation. */
const pending = ref<{ start: boolean }>();
const algos = ref<AlgoRow[]>([]);
/** Parameter files come in the config adapter's first format, e.g. .cbotset. */
const format = computed(() => (system.value?.parameterFormats ?? [])[0]);
const saved = computed(() => (typeof route.query["saved"] === "string" ? route.query["saved"] : undefined));

onMounted(async () => {
  try {
    algos.value = await api.algos();
  } catch (e) {
    error.value = t(errorKey(e));
  }
});

const deployment = computed(() => props.managed?.deployment);
const version = computed(() => props.managed?.config.version ?? 0);
/** The container runs another configuration than the saved one. */
const outdated = computed(() => deployment.value?.managed === true && deployment.value.configVersion !== version.value);
const running = computed(() => deployment.value?.status === "running" || deployment.value?.status === "restarting");

const confirmTitle = computed(() => {
  if (!deployment.value) return pending.value?.start ? t("deploy.createAndStart") : t("deploy.create");
  if (running.value) return t("deploy.applyRestart", { version: version.value });
  return pending.value?.start
    ? t("deploy.applyAndStart", { version: version.value })
    : t("deploy.apply", { version: version.value });
});
const confirmMessage = computed(() => {
  const v = { version: version.value };
  const what = !deployment.value
    ? t(pending.value?.start ? "deploy.confirmCreateStart" : "deploy.confirmCreate", v)
    : running.value
      ? t("deploy.confirmApplyRunning", v)
      : t(pending.value?.start ? "deploy.confirmApplyStart" : "deploy.confirmApply", v);
  return `${what} ${pending.value?.start || running.value ? t("deploy.elsewhere") : ""}`.trim();
});

async function deploy() {
  const name = props.managed?.name;
  const start = pending.value?.start ?? false;
  pending.value = undefined;
  if (!name) return;
  busy.value = true;
  error.value = undefined;
  notice.value = undefined;
  try {
    const result = await api.deployInstance(name, start);
    notice.value = t("deploy.done", { version: result.configVersion, status: t(`status.${result.status}`) });
  } catch (e) {
    error.value = t(errorKey(e));
  } finally {
    busy.value = false;
    emit("changed");
  }
}

const schemaOf = (config: InstanceConfigRow): ParameterSchema[] =>
  algos.value.find((a) => a.id === config.algo.id)?.parameters ?? [];
const show = (value: unknown) => (value === undefined ? "–" : String(value));

/** The algo's parameters; empty if the algo version was deleted, then the values show as "not in the algo". */
const schema = computed<ParameterSchema[]>(() => (props.managed ? schemaOf(props.managed.config) : []));

const attributionText = (c: InstanceConfigRow) =>
  [t(`instanceForm.modes.${c.attribution.mode}`), c.attribution.orderLabel].filter(Boolean).join(" · ");

/** What changed from the previous version, as "field: old → new". */
function changes(index: number): string[] {
  const history = props.managed?.history ?? [];
  const current = history[index];
  const previous = history[index + 1];
  if (!current) return [];
  if (!previous) return [t("instanceConfig.created")];
  const out: string[] = [];
  const diff = (label: string, a: string, b: string) => {
    if (a !== b) out.push(`${label}: ${a} → ${b}`);
  };
  diff(
    t("instanceForm.algo"),
    `${previous.algo.name} ${previous.algo.version}`,
    `${current.algo.name} ${current.algo.version}`,
  );
  diff(t("instanceForm.symbol"), previous.symbol, current.symbol);
  diff(t("instanceForm.period"), previous.period, current.period);
  diff(t("instanceForm.attribution"), attributionText(previous), attributionText(current));
  const keys = new Set([...Object.keys(previous.parameters), ...Object.keys(current.parameters)]);
  for (const k of keys) diff(k, show(previous.parameters[k]), show(current.parameters[k]));
  return out;
}
</script>

<template>
  <div class="tab">
    <p v-if="error" class="tone-negative" role="alert">{{ error }}</p>
    <p v-if="saved && !notice" class="tone-positive status" role="status">
      {{ $t("instanceConfig.saved", { version: saved }) }}
    </p>
    <p v-if="notice" class="tone-positive status" role="status">{{ notice }}</p>

    <template v-if="managed">
      <!-- Only when the container and the saved configuration differ; start and stop live in the page head. -->
      <AppBanner v-if="!deployment" tone="neutral">
        <span>{{ $t("deploy.none") }}</span>
        <template v-if="isAdmin" #actions>
          <button type="button" class="btn btn--primary" :disabled="busy" @click="pending = { start: true }">
            {{ $t("deploy.createAndStart") }}
          </button>
          <button type="button" class="btn" :disabled="busy" @click="pending = { start: false }">
            {{ $t("deploy.create") }}
          </button>
        </template>
      </AppBanner>
      <AppBanner v-else-if="!deployment.managed" tone="warning" :title="$t('alert.level.warning')">
        <span>{{ $t("deploy.foreign") }}</span>
      </AppBanner>
      <AppBanner v-else-if="outdated" tone="warning" :title="$t('alert.level.warning')">
        <span>{{
          deployment.configVersion
            ? $t("deploy.outdated", { version, running: deployment.configVersion })
            : $t("deploy.outdatedUnknown", { version })
        }}</span>
        <span class="muted">{{ $t("instanceConfig.notDeployed") }}</span>
        <template v-if="isAdmin" #actions>
          <button type="button" class="btn btn--primary" :disabled="busy" @click="pending = { start: false }">
            {{ running ? $t("deploy.applyRestart", { version }) : $t("deploy.apply", { version }) }}
          </button>
          <button v-if="!running" type="button" class="btn" :disabled="busy" @click="pending = { start: true }">
            {{ $t("deploy.applyAndStart", { version }) }}
          </button>
        </template>
      </AppBanner>

      <section class="panel card" aria-labelledby="current-title">
        <h2 id="current-title">{{ $t("instanceConfig.current") }}</h2>
        <dl class="facts">
          <dt>{{ $t("instanceForm.algo") }}</dt>
          <dd class="mono">
            {{ managed.config.algo.name }} {{ managed.config.algo.version }}
            <span v-if="managed.config.algo.id === null" class="pill tone-warning">{{
              $t("instanceConfig.algoGone")
            }}</span>
          </dd>
          <dt>{{ $t("instanceForm.symbol") }}</dt>
          <dd class="mono">{{ managed.config.symbol }}</dd>
          <dt>{{ $t("instanceForm.period") }}</dt>
          <dd class="mono">{{ managed.config.period }}</dd>
          <dt>{{ $t("instanceForm.attribution") }}</dt>
          <dd>{{ attributionText(managed.config) }}</dd>
        </dl>
        <ParameterList mode="view" :schema="schema" :values="managed.config.parameters" />
      </section>

      <section class="panel card" aria-labelledby="versions-title">
        <h2 id="versions-title">{{ $t("instance.versions") }}</h2>
        <ol class="history">
          <li v-for="(h, i) in managed.history" :key="h.version" class="history__item">
            <div class="history__head">
              <span class="mono version">{{ $t("instanceConfig.version", { version: h.version }) }}</span>
              <span v-if="i === 0" class="pill tone-positive">{{ $t("instanceConfig.currentBadge") }}</span>
              <span class="muted meta">
                {{ [formatDateTime(locale, h.createdAt), h.createdBy].filter(Boolean).join(" · ") }}
              </span>
              <a
                v-if="isAdmin && format"
                :href="api.parameterFileUrl(managed.name, h.version)"
                class="btn btn--ghost btn--small history__download"
                download
              >
                {{ $t("instanceConfig.download", { format }) }}
              </a>
              <RouterLink
                v-if="isAdmin && i > 0"
                :to="{ name: 'instance-edit', params: { ref: managed.name }, query: { version: String(h.version) } }"
                class="btn btn--ghost btn--small"
              >
                {{ $t("instanceConfig.restore") }}
              </RouterLink>
            </div>
            <p v-if="h.comment" class="comment">{{ h.comment }}</p>
            <ul class="changes mono">
              <li v-for="c in changes(i)" :key="c">{{ c }}</li>
            </ul>
          </li>
        </ol>
      </section>
    </template>

    <section v-if="labels" class="panel card" aria-labelledby="labels-title">
      <h2 id="labels-title">{{ $t("instance.labels") }}</h2>
      <p class="muted card__hint">
        {{ managed ? $t("instance.managedLabels") : $t("instance.externallyManaged") }}
      </p>
      <dl class="labels mono">
        <template v-for="(value, key) in labels" :key="key">
          <dt>{{ key }}</dt>
          <dd>{{ value }}</dd>
        </template>
      </dl>
    </section>

    <ConfirmDialog
      :open="pending !== undefined"
      :title="confirmTitle"
      :message="confirmMessage"
      :confirm-label="confirmTitle"
      @confirm="deploy"
      @cancel="pending = undefined"
    />
  </div>
</template>

<style scoped>
.tab {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-5);
  min-width: 0;
}

p {
  margin: 0;
}

.status {
  font-weight: 600;
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
  min-width: 0;
  padding: var(--ww-space-5);
}

.card__hint {
  font-size: var(--ww-size-xs);
}

.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--ww-space-2) var(--ww-space-5);
  margin: 0;
  font-size: var(--ww-size-sm);
}

.facts dt {
  color: var(--ww-text-muted);
}

.facts dd {
  margin: 0;
}

.history {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.history__item {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-1);
  padding-top: var(--ww-space-3);
  border-top: 1px solid var(--ww-border);
}

.history__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  align-items: center;
}

.version {
  font-weight: 600;
}

.meta {
  font-size: var(--ww-size-xs);
}

.history__download {
  margin-left: auto;
}

.comment {
  font-size: var(--ww-size-sm);
}

.changes {
  margin: 0;
  padding-left: var(--ww-space-5);
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
}

.labels {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--ww-space-1) var(--ww-space-4);
  margin: 0;
  font-size: var(--ww-size-xs);
}

.labels dt {
  color: var(--ww-text-muted);
}

.labels dd {
  margin: 0;
  word-break: break-all;
}
</style>
