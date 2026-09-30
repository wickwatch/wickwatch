<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorKey, type AlgoRow } from "../api";
import AppModal from "../components/AppModal.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import IconButton from "../components/IconButton.vue";
import ParameterList from "../components/ParameterList.vue";
import FieldError from "../components/FieldError.vue";
import FileDrop from "../components/FileDrop.vue";
import { formatDateTime } from "../format";
import { isAdmin } from "../session";
import { checks, normalizers, useValidation, vNormalize } from "../validation";
import AppSpinner from "../components/AppSpinner.vue";

const { t, locale } = useI18n();
const algos = ref<AlgoRow[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref<string>();
const notice = ref<string>();
const file = ref<File>();
const version = ref("");
const removing = ref<AlgoRow>();

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

/** The upload form sits in a modal; its errors stay inside it. */
const uploading = ref(false);
const uploadError = ref<string>();
const uploadDirty = computed(() => file.value !== undefined || version.value !== "");
function openUpload() {
  uploadError.value = undefined;
  // Closing blurs the field, which marks it touched after closeUpload() reset it.
  form.reset();
  uploading.value = true;
}
function closeUpload() {
  uploading.value = false;
  file.value = undefined;
  version.value = "";
  // A cleared form shows no "Required." until the next attempt.
  form.reset();
}
async function upload() {
  if (!form.validate() || !file.value) return;
  busy.value = true;
  uploadError.value = undefined;
  notice.value = undefined;
  try {
    const uploaded = await api.uploadAlgo(file.value, version.value.trim() || undefined);
    closeUpload();
    await load();
    notice.value = t("algos.uploaded", { name: uploaded.name, version: uploaded.version });
  } catch (e) {
    uploadError.value = t(errorKey(e));
  } finally {
    busy.value = false;
  }
}

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
    <!-- Title and action share a row, like the section heads on the accounts page; the intro runs below at full width. -->
    <div class="head">
      <h1>{{ $t("nav.algos") }}</h1>
      <IconButton v-if="isAdmin" icon="upload" :label="$t('algos.upload')" show-label collapse @click="openUpload" />
      <p class="muted intro">{{ $t("algos.intro") }}</p>
    </div>
    <p class="status" role="status" aria-live="polite">{{ notice }}</p>
    <p v-if="error" class="tone-negative" role="alert">{{ error }}</p>
    <AppSpinner v-if="loading" />

    <template v-else>
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
            <ParameterList mode="schema" :schema="a.parameters" class="algo-params" />
          </details>
        </div>
      </section>
    </template>

    <AppModal :open="uploading" :title="$t('algos.upload')" :dirty="uploadDirty" @close="closeUpload">
      <template #default="{ close }">
        <form class="form" novalidate @submit.prevent="upload">
          <div class="field">
            <FileDrop
              v-bind="fileField.attrs.value"
              accept=".algo"
              :title="$t('algos.file')"
              :hint="$t('algos.fileHint')"
              :selected="file?.name"
              @file="file = $event"
            />
            <FieldError :field="fileField" />
          </div>
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
          <div class="buttons">
            <button type="submit" class="btn btn--primary" :disabled="busy">{{ $t("algos.upload") }}</button>
            <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.cancel") }}</button>
          </div>
          <p v-if="uploadError" class="tone-negative" role="alert">{{ uploadError }}</p>
        </form>
      </template>
    </AppModal>
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
.head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--ww-space-2) var(--ww-space-4);
  align-items: center;
}

.head h1 {
  margin: 0;
}

.head .intro {
  grid-column: 1 / -1;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}

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

.algo-params {
  margin-top: var(--ww-space-3);
}

@media (max-width: 640px) {
  .page {
    padding: var(--ww-space-4);
  }
}
</style>
