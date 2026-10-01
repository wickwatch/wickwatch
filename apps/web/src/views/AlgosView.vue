<script setup lang="ts">
import type { Algo } from "@wickwatch/core";
import { groupBy } from "@wickwatch/core/group-by";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import AppModal from "../components/AppModal.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import IconButton from "../components/IconButton.vue";
import { useAsyncAction } from "../composables/useAsyncAction";
import ParameterList from "../components/ParameterList.vue";
import FieldError from "../components/FieldError.vue";
import FileDrop from "../components/FileDrop.vue";
import { formatDateTime, formatFileSize } from "../format";
import { isAdmin } from "../session";
import { system } from "../system";
import { checks, normalizers, useValidation, vNormalize } from "../validation";
import AppSpinner from "../components/AppSpinner.vue";

const { t, locale } = useI18n();
const algos = ref<Algo[]>([]);
const loading = ref(true);
const file = ref<File>();
const version = ref("");
const removing = ref<Algo>();

/** The broker's algo file extensions, e.g. ".algo". */
const extensions = computed(() => (system.value?.algoFormats ?? []).map((f) => `.${f}`));
const formats = computed(() => extensions.value.join(", "));

const form = useValidation();
const fileField = form.field(
  () => file.value?.name,
  checks.required,
  (name) =>
    name && extensions.value.length && !extensions.value.some((e) => String(name).toLowerCase().endsWith(e))
      ? { key: "validation.algoFile", params: { formats: formats.value }, live: true }
      : undefined,
);
const versionField = form.field(() => version.value, checks.version);

/** Newest version first within each algo. */
const groups = computed(() => [...groupBy(algos.value, (a) => a.name)]);

async function load() {
  algos.value = await api.algos();
}
const { busy, running, error, notice, run } = useAsyncAction({ reload: load });

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
function upload() {
  const chosen = file.value;
  if (!form.validate() || !chosen) return;
  void run(
    async () => {
      const uploaded = await api.uploadAlgo(chosen, version.value.trim() || undefined);
      closeUpload();
      return uploaded;
    },
    { done: (a) => t("algos.uploaded", { name: a.name, version: a.version }), error: uploadError },
  );
}

const confirmRemove = () => {
  const algo = removing.value;
  removing.value = undefined;
  if (algo)
    void run(() => api.deleteAlgo(algo.id), {
      done: () => t("algos.deleted", { name: algo.name, version: algo.version }),
      as: `remove-${algo.id}`,
    });
};
</script>

<template>
  <div class="page">
    <!-- Title and action share a row, the intro runs below; on phones the action goes below the intro at full width,
         like on the instance and account pages. -->
    <div class="head">
      <h1>{{ $t("nav.algos") }}</h1>
      <IconButton
        v-if="isAdmin"
        icon="upload"
        :label="$t('algos.upload')"
        show-label
        class="head__action"
        @click="openUpload"
      />
      <p class="muted intro">{{ $t("algos.intro", { formats }) }}</p>
    </div>
    <p class="status" role="status" aria-live="polite">{{ notice }}</p>
    <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
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
                  formatFileSize(locale, a.size),
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
              :aria-busy="running === `remove-${a.id}`"
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
              :accept="extensions.join(',')"
              :title="$t('algos.file', { formats })"
              :hint="$t('algos.fileHint', { formats })"
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
            <button type="submit" class="btn btn--primary" :disabled="busy" :aria-busy="busy">
              {{ $t("algos.upload") }}
            </button>
            <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.cancel") }}</button>
          </div>
          <p v-if="uploadError" class="tone-negative" role="alert">{{ $t(uploadError) }}</p>
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
  grid-template-areas:
    "title action"
    "intro intro";
  gap: var(--ww-space-2) var(--ww-space-4);
  align-items: center;
}

.head h1 {
  grid-area: title;
  margin: 0;
}

.head .intro {
  grid-area: intro;
}

.head__action {
  grid-area: action;
}

@media (max-width: 640px) {
  .head {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "title"
      "intro"
      "action";
  }

  .head__action {
    width: 100%;
    margin-top: var(--ww-space-2);
  }
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}

.intro {
  margin: 0;
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
</style>
