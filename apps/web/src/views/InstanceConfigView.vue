<script setup lang="ts">
import type { ParameterSchema } from "@wickwatch/core";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { api, errorKey, type AlgoRow, type InstanceConfigRow, type ManagedInstanceDetail } from "../api";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import { formatDateTime } from "../format";
import { isAdmin } from "../session";

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const name = computed(() => String(route.params["ref"]));

const data = ref<ManagedInstanceDetail>();
const algos = ref<AlgoRow[]>([]);
const error = ref<string>();
const deleting = ref(false);
const saved = computed(() => (typeof route.query["saved"] === "string" ? route.query["saved"] : undefined));

onMounted(async () => {
  try {
    [data.value, algos.value] = await Promise.all([api.managedInstance(name.value), api.algos()]);
  } catch (e) {
    error.value = t(errorKey(e));
  }
});

const schemaOf = (config: InstanceConfigRow): ParameterSchema[] =>
  algos.value.find((a) => a.id === config.algo.id)?.parameters ?? [];
const show = (value: unknown) => (value === undefined ? "–" : String(value));

interface Row {
  name: string;
  label: string;
  value: unknown;
  default: unknown;
}
/** Parameters of the current configuration in schema order, then values the schema does not know. */
const rows = computed<Row[]>(() => {
  const config = data.value?.config;
  if (!config) return [];
  const schema = schemaOf(config);
  const known = schema.map((p) => ({
    name: p.name,
    label: p.label ?? p.name,
    value: config.parameters[p.name],
    default: p.default,
  }));
  const extra = Object.keys(config.parameters)
    .filter((k) => !schema.some((p) => p.name === k))
    .map((k) => ({ name: k, label: k, value: config.parameters[k], default: undefined }));
  return [...known, ...extra];
});

const attributionText = (c: InstanceConfigRow) =>
  [t(`instanceForm.modes.${c.attribution.mode}`), c.attribution.orderLabel].filter(Boolean).join(" · ");

/** What changed from the previous version, as "field: old → new". */
function changes(index: number): string[] {
  const history = data.value?.history ?? [];
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

async function remove() {
  deleting.value = false;
  try {
    await api.deleteManagedInstance(name.value);
    await router.push({ name: "overview" });
  } catch (e) {
    error.value = t(errorKey(e));
  }
}
</script>

<template>
  <div class="page">
    <RouterLink to="/" class="back">{{ $t("instance.back") }}</RouterLink>
    <p v-if="error" class="tone-negative" role="alert">{{ error }}</p>
    <p v-else-if="!data" class="muted">{{ $t("overview.loading") }}</p>

    <template v-if="data">
      <div class="head">
        <div>
          <h1 class="mono">{{ data.name }}</h1>
          <p class="muted">
            {{ data.account.displayName }} · {{ data.account.number }} ·
            {{ $t("instanceConfig.version", { version: data.config.version }) }}
          </p>
        </div>
        <div v-if="isAdmin" class="actions">
          <RouterLink :to="{ name: 'instance-edit', params: { ref: data.name } }" class="btn btn--primary">
            {{ $t("action.edit") }}
          </RouterLink>
          <RouterLink :to="{ name: 'instance-new', query: { from: data.name } }" class="btn">
            {{ $t("action.duplicate") }}
          </RouterLink>
          <button type="button" class="btn btn--danger" @click="deleting = true">{{ $t("action.delete") }}</button>
        </div>
      </div>
      <p v-if="saved" class="tone-positive status" role="status">
        {{ $t("instanceConfig.saved", { version: saved }) }}
      </p>
      <p class="muted">{{ $t("instanceConfig.notDeployed") }}</p>

      <section class="panel card" aria-labelledby="current-title">
        <h2 id="current-title">{{ $t("instanceConfig.current") }}</h2>
        <dl class="facts">
          <dt>{{ $t("instanceForm.algo") }}</dt>
          <dd class="mono">
            {{ data.config.algo.name }} {{ data.config.algo.version }}
            <span v-if="data.config.algo.id === null" class="pill tone-warning">{{
              $t("instanceConfig.algoGone")
            }}</span>
          </dd>
          <dt>{{ $t("instanceForm.symbol") }}</dt>
          <dd class="mono">{{ data.config.symbol }}</dd>
          <dt>{{ $t("instanceForm.period") }}</dt>
          <dd class="mono">{{ data.config.period }}</dd>
          <dt>{{ $t("instanceForm.attribution") }}</dt>
          <dd>{{ attributionText(data.config) }}</dd>
        </dl>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ $t("algos.parameter") }}</th>
                <th scope="col">{{ $t("instanceConfig.value") }}</th>
                <th scope="col">{{ $t("algos.default") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.name">
                <th scope="row">
                  <span>{{ r.label }}</span>
                  <span v-if="r.label !== r.name" class="mono muted key">{{ r.name }}</span>
                </th>
                <td class="mono">
                  {{ show(r.value) }}
                  <span
                    v-if="r.default !== undefined && r.value !== undefined && r.value !== r.default"
                    class="pill tone-warning"
                  >
                    {{ $t("instanceForm.changed") }}
                  </span>
                </td>
                <td class="mono muted">{{ show(r.default) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel card" aria-labelledby="history-title">
        <h2 id="history-title">{{ $t("instance.versions") }}</h2>
        <ol class="history">
          <li v-for="(h, i) in data.history" :key="h.version" class="history__item">
            <div class="history__head">
              <span class="mono version">{{ $t("instanceConfig.version", { version: h.version }) }}</span>
              <span v-if="i === 0" class="pill tone-positive">{{ $t("instanceConfig.currentBadge") }}</span>
              <span class="muted meta">
                {{ [formatDateTime(locale, h.createdAt), h.createdBy].filter(Boolean).join(" · ") }}
              </span>
              <RouterLink
                v-if="isAdmin && i > 0"
                :to="{ name: 'instance-edit', params: { ref: data.name }, query: { version: String(h.version) } }"
                class="btn btn--ghost btn--small restore"
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

    <ConfirmDialog
      :open="deleting"
      :title="$t('action.delete')"
      :message="$t('instanceConfig.deleteConfirm', { name })"
      :confirm-label="$t('action.delete')"
      @confirm="remove"
      @cancel="deleting = false"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-5);
  min-width: 0;
  padding: var(--ww-space-8) var(--ww-space-10);
}

h1,
p {
  margin: 0;
}

.back {
  font-size: var(--ww-size-sm);
}

.head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-4);
  justify-content: space-between;
  align-items: flex-start;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
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

.table-wrap {
  position: relative;
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ww-size-sm);
}

th,
td {
  padding: var(--ww-space-2) var(--ww-space-3);
  border-bottom: 1px solid var(--ww-border);
  text-align: left;
  vertical-align: top;
}

thead th {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
  font-weight: 600;
}

tbody th {
  font-weight: 500;
}

.key {
  display: block;
  font-size: var(--ww-size-xs);
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

.restore {
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

@media (max-width: 640px) {
  .page {
    padding: var(--ww-space-4);
  }
}
</style>
