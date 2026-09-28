<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorKey, type AlgoRow } from "../api";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import FieldError from "../components/FieldError.vue";
import { formatDateTime } from "../format";
import { isAdmin } from "../session";
import { checks, normalizers, useValidation, vNormalize } from "../validation";

const { t, locale } = useI18n();
const algos = ref<AlgoRow[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref<string>();
const notice = ref<string>();
const file = ref<File>();
const version = ref("");
const removing = ref<AlgoRow>();
const fileInput = ref<HTMLInputElement>();

const form = useValidation();
const fileField = form.field(
  () => file.value?.name,
  checks.required,
  (name) =>
    name && !String(name).toLowerCase().endsWith(".algo") ? { key: "validation.algoFile", live: true } : undefined,
);
const versionField = form.field(() => version.value, checks.version);

/** Newest version first within each algo. */
const groups = computed(() => {
  const byName = new Map<string, AlgoRow[]>();
  for (const a of algos.value) byName.set(a.name, [...(byName.get(a.name) ?? []), a]);
  return [...byName.entries()];
});

async function load() {
  algos.value = await api.algos();
}

async function run(action: () => Promise<void>, done?: () => string) {
  busy.value = true;
  error.value = undefined;
  notice.value = undefined;
  try {
    await action();
    await load();
    if (done) notice.value = done();
  } catch (e) {
    error.value = t(errorKey(e));
  } finally {
    busy.value = false;
  }
}

onMounted(() => void run(async () => undefined).finally(() => (loading.value = false)));

let uploaded: AlgoRow | undefined;
const upload = () =>
  run(
    async () => {
      if (!form.validate() || !file.value) return;
      uploaded = await api.uploadAlgo(file.value, version.value.trim() || undefined);
      file.value = undefined;
      version.value = "";
      if (fileInput.value) fileInput.value.value = "";
      // A cleared form shows no "Required." until the next attempt.
      form.reset();
    },
    () => t("algos.uploaded", { name: uploaded?.name ?? "", version: uploaded?.version ?? "" }),
  );

const confirmRemove = () => {
  const algo = removing.value;
  removing.value = undefined;
  if (algo)
    void run(
      () => api.deleteAlgo(algo.id),
      () => t("algos.deleted", { name: algo.name, version: algo.version }),
    );
};

const fileSize = (bytes: number) => {
  const [value, unit] =
    bytes < 1024 ? [bytes, "byte"] : bytes < 1024 ** 2 ? [bytes / 1024, "kilobyte"] : [bytes / 1024 ** 2, "megabyte"];
  return new Intl.NumberFormat(locale.value, { style: "unit", unit, maximumFractionDigits: 1 }).format(value);
};
</script>

<template>
  <div class="page">
    <h1>{{ $t("nav.algos") }}</h1>
    <p class="muted intro">{{ $t("algos.intro") }}</p>
    <p class="status" role="status" aria-live="polite">{{ notice }}</p>
    <p v-if="error" class="tone-negative" role="alert">{{ error }}</p>
    <p v-if="loading" class="muted">{{ $t("overview.loading") }}</p>

    <template v-else>
      <section v-if="isAdmin" class="panel card" aria-labelledby="upload-title">
        <h2 id="upload-title">{{ $t("algos.upload") }}</h2>
        <form class="form" novalidate @submit.prevent="upload">
          <div class="grid">
            <label class="field">
              {{ $t("algos.file") }}
              <input
                ref="fileInput"
                class="input"
                type="file"
                accept=".algo"
                required
                v-bind="fileField.attrs.value"
                @change="file = ($event.target as HTMLInputElement).files?.[0]"
              />
              <FieldError :field="fileField" />
            </label>
            <label class="field">
              {{ $t("algos.version") }}
              <input
                v-model="version"
                v-normalize="normalizers.hyphenate"
                v-bind="versionField.attrs.value"
                class="input mono"
                maxlength="100"
                autocomplete="off"
                spellcheck="false"
              />
              <FieldError :field="versionField" />
              <span class="field__hint">{{ $t("algos.versionHint") }}</span>
            </label>
          </div>
          <div>
            <button type="submit" class="btn btn--primary" :disabled="busy">{{ $t("algos.upload") }}</button>
          </div>
        </form>
      </section>

      <p v-if="!algos.length" class="muted">{{ $t("algos.none") }}</p>
      <section v-for="[name, versions] in groups" :key="name" class="panel card" :aria-label="name">
        <h2 class="mono">{{ name }}</h2>
        <div v-for="a in versions" :key="a.id" class="version">
          <div class="version__head">
            <span class="mono version__name">{{ a.version }}</span>
            <span v-if="a.fullAccess" class="pill tone-warning">{{ $t("algos.fullAccess") }}</span>
            <span class="muted meta">
              {{
                [
                  a.buildTime ? $t("algos.built", { time: formatDateTime(locale, a.buildTime) }) : undefined,
                  $t("algos.uploadedAt", { time: formatDateTime(locale, a.uploadedAt) }),
                  fileSize(a.size),
                ]
                  .filter(Boolean)
                  .join(" · ")
              }}
            </span>
            <span class="mono muted meta" :title="a.sha256">{{
              $t("algos.hash", { hash: a.sha256.slice(0, 12) })
            }}</span>
            <button
              v-if="isAdmin"
              type="button"
              class="btn btn--danger btn--small"
              :disabled="busy"
              @click="removing = a"
            >
              {{ $t("action.delete") }}
            </button>
          </div>
          <details>
            <summary>{{ $t("algos.parameters", { count: a.parameters.length }) }}</summary>
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th scope="col">{{ $t("algos.parameter") }}</th>
                    <th scope="col">{{ $t("algos.group") }}</th>
                    <th scope="col">{{ $t("algos.type") }}</th>
                    <th scope="col">{{ $t("algos.default") }}</th>
                    <th scope="col">{{ $t("algos.range") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in a.parameters" :key="p.name">
                    <th scope="row">
                      <span>{{ p.label ?? p.name }}</span>
                      <span v-if="p.label" class="mono muted param-key">{{ p.name }}</span>
                    </th>
                    <td>{{ p.group ?? "" }}</td>
                    <td class="mono">{{ p.type }}</td>
                    <td class="mono">{{ p.default === undefined ? "" : String(p.default) }}</td>
                    <td class="mono">
                      {{
                        p.options
                          ? p.options.join(" | ")
                          : [p.min, p.max].some((v) => v !== undefined)
                            ? `${p.min ?? ""} … ${p.max ?? ""}`
                            : ""
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </section>
    </template>

    <ConfirmDialog
      :open="removing !== undefined"
      :title="$t('action.delete')"
      :message="removing ? $t('algos.deleteConfirm', { name: removing.name, version: removing.version }) : ''"
      :confirm-label="$t('action.delete')"
      @confirm="confirmRemove"
      @cancel="removing = undefined"
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

.intro,
.status,
p[role="alert"] {
  margin: 0;
}

.status:empty {
  display: none;
}

.status {
  color: var(--ww-positive);
  font-weight: 600;
}

.card,
.form {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
  min-width: 0;
}

.card {
  padding: var(--ww-space-5);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--ww-space-4);
}

.version {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
  padding-top: var(--ww-space-3);
  border-top: 1px solid var(--ww-border);
}

.version__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  align-items: center;
}

.version__name {
  font-weight: 600;
}

.meta {
  font-size: var(--ww-size-xs);
}

.version__head .btn {
  margin-left: auto;
}

details summary {
  cursor: pointer;
  font-size: var(--ww-size-sm);
}

.table-wrap {
  position: relative;
  overflow-x: auto;
  margin-top: var(--ww-space-2);
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

.param-key {
  display: block;
  font-size: var(--ww-size-xs);
}

@media (max-width: 640px) {
  .page {
    padding: var(--ww-space-4);
  }
}
</style>
