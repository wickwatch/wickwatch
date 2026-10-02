<script setup lang="ts">
import type { Algo, ParameterTemplate } from "@wickwatch/core";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { useAsyncAction } from "../composables/useAsyncAction";
import { formatDateTime } from "../format";
import { isAdmin } from "../session";
import { system } from "../system";
import { checks, useValidation } from "../validation";
import AppModal from "./AppModal.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import FieldError from "./FieldError.vue";
import FileDrop from "./FileDrop.vue";
import IconButton from "./IconButton.vue";

/** The parameter templates of one algo on the Algos page: list, rename, delete, and a new one from a file. */
const props = defineProps<{
  algoName: string;
  /** The newest uploaded version, to read parameter files with; none when every version was deleted. */
  newest: Algo | undefined;
  templates: ParameterTemplate[];
}>();
const emit = defineEmits<{ changed: [message: string] }>();
const { t, locale } = useI18n();
const { busy, running, error, run } = useAsyncAction();

const extensions = computed(() => (system.value?.parameterFormats ?? []).map((f) => `.${f}`));

const source = (tpl: ParameterTemplate) =>
  tpl.source?.kind === "instance"
    ? t("templates.sourceInstance", { instance: tpl.source.instance, version: tpl.source.version })
    : tpl.source?.kind === "file"
      ? t("templates.sourceFile", { file: tpl.source.file })
      : undefined;
const meta = (tpl: ParameterTemplate) =>
  [
    t("templates.count", tpl.count),
    source(tpl),
    t("templates.updated", { time: formatDateTime(locale.value, tpl.updatedAt) }),
    tpl.updatedBy,
  ]
    .filter(Boolean)
    .join(" · ");

// One modal for both: a new template from a file (with `file`) or a new name for an existing one.
const editing = ref<{ kind: "file" } | { kind: "rename"; template: ParameterTemplate }>();
const name = ref("");
const file = ref<File>();
const modalError = ref<string>();
const form = useValidation();
const nameField = form.field(() => name.value, checks.required);
const fileField = form.field(() => (editing.value?.kind === "file" ? file.value?.name : "-"), checks.required);

function open(next: NonNullable<typeof editing.value>) {
  editing.value = next;
  name.value = next.kind === "rename" ? next.template.name : "";
  file.value = undefined;
  modalError.value = undefined;
  form.reset();
}
function close() {
  editing.value = undefined;
  form.reset();
}

function submit() {
  const current = editing.value;
  if (!current || !form.validate()) return;
  const newName = name.value.trim();
  if (current.kind === "rename") {
    void run(
      async () => {
        const saved = await api.updateParameterTemplate(current.template.id, { name: newName });
        close();
        emit("changed", t("templates.renamed", { name: saved.name }));
      },
      { error: modalError },
    );
    return;
  }
  const chosen = file.value;
  const algo = props.newest;
  if (!chosen || !algo) return;
  void run(
    async () => {
      const parsed = await api.parseParameterFile(algo.id, chosen);
      const saved = await api.createParameterTemplate({
        algoName: props.algoName,
        name: newName,
        parameters: parsed.values,
        source: { kind: "file", file: chosen.name },
      });
      close();
      const left = parsed.issues.length + parsed.unknown.length;
      emit(
        "changed",
        [
          t("templates.fromFileSaved", { name: saved.name, count: saved.count }),
          left ? t("templates.fromFileSkipped", left) : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    },
    { error: modalError },
  );
}

const removing = ref<ParameterTemplate>();
function confirmRemove() {
  const tpl = removing.value;
  removing.value = undefined;
  if (!tpl) return;
  void run(
    async () => {
      await api.deleteParameterTemplate(tpl.id);
      emit("changed", t("templates.deleted", { name: tpl.name }));
    },
    { as: `remove-${String(tpl.id)}` },
  );
}
</script>

<template>
  <div class="templates">
    <div class="templates__head">
      <h3>{{ $t("templates.title") }}</h3>
      <IconButton
        v-if="isAdmin && newest && extensions.length"
        icon="plus"
        :label="$t('templates.fromFile')"
        show-label
        small
        @click="open({ kind: 'file' })"
      />
    </div>
    <p v-if="!templates.length" class="muted hint">{{ $t("templates.intro") }}</p>
    <p v-if="!newest && templates.length" class="muted hint">{{ $t("templates.noVersion") }}</p>
    <ul v-if="templates.length" class="templates__list">
      <li v-for="tpl in templates" :key="tpl.id" class="template">
        <span class="template__name">{{ tpl.name }}</span>
        <span class="muted meta">{{ meta(tpl) }}</span>
        <span v-if="isAdmin" class="template__actions">
          <IconButton
            icon="edit"
            :label="$t('table.actionOn', { action: $t('templates.rename'), name: tpl.name })"
            small
            :disabled="busy"
            @click="open({ kind: 'rename', template: tpl })"
          />
          <IconButton
            icon="trash"
            variant="danger"
            :label="$t('table.actionOn', { action: $t('action.delete'), name: tpl.name })"
            small
            :disabled="busy"
            :aria-busy="running === `remove-${tpl.id}`"
            @click="removing = tpl"
          />
        </span>
      </li>
    </ul>
    <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>

    <AppModal
      :open="editing !== undefined"
      :title="
        editing?.kind === 'rename' ? $t('templates.renameTitle') : $t('templates.fromFileTitle', { algo: algoName })
      "
      :dirty="editing?.kind === 'file' ? file !== undefined || name !== '' : name !== (editing?.template.name ?? '')"
      @close="close"
    >
      <template #default="{ close: dismiss }">
        <form class="form" novalidate @submit.prevent="submit">
          <div v-if="editing?.kind === 'file'" class="field">
            <FileDrop
              v-bind="fileField.attrs.value"
              :accept="extensions.join(',')"
              :title="$t('parameters.fileTitle')"
              :hint="$t('templates.fileHint', { formats: extensions.join(', ') })"
              :selected="file?.name"
              @file="file = $event"
            />
            <FieldError :field="fileField" />
          </div>
          <label class="field">
            {{ $t("templates.name") }}
            <input
              v-model="name"
              v-bind="nameField.attrs.value"
              class="input"
              maxlength="100"
              required
              autocomplete="off"
            />
            <FieldError :field="nameField" />
          </label>
          <div class="buttons">
            <button type="submit" class="btn btn--primary" :disabled="busy" :aria-busy="busy">
              {{ editing?.kind === "rename" ? $t("templates.rename") : $t("templates.create") }}
            </button>
            <button type="button" class="btn btn--ghost" @click="dismiss()">{{ $t("action.cancel") }}</button>
          </div>
          <p v-if="modalError" class="tone-negative" role="alert">{{ $t(modalError) }}</p>
        </form>
      </template>
    </AppModal>
    <ConfirmDialog
      :open="removing !== undefined"
      :title="$t('action.delete')"
      :message="removing ? $t('templates.deleteConfirm', { name: removing.name }) : ''"
      :confirm-label="$t('action.delete')"
      @confirm="confirmRemove"
      @cancel="removing = undefined"
    />
  </div>
</template>

<style scoped>
.templates {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
  padding-top: var(--ww-space-3);
  border-top: 1px solid var(--ww-border);
}

.templates p,
.templates h3 {
  margin: 0;
}

.templates__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  align-items: center;
  justify-content: space-between;
}

.templates__head h3 {
  font-size: var(--ww-size-sm);
}

.hint,
.meta {
  font-size: var(--ww-size-xs);
}

.templates__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.template {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-1) var(--ww-space-3);
  align-items: center;
  padding: var(--ww-space-2) 0;
}

.template + .template {
  border-top: 1px solid var(--ww-border);
}

.template__name {
  font-size: var(--ww-size-sm);
  font-weight: 600;
}

/* Row actions on one line, at the right (BRAND.md, "Buttons and icons"). */
.template__actions {
  display: flex;
  gap: var(--ww-space-1);
  margin-left: auto;
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
  min-width: 0;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}

@media (max-width: 640px) {
  .templates__head .btn {
    width: 100%;
  }
}
</style>
