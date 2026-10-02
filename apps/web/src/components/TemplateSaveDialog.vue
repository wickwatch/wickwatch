<script setup lang="ts">
import type { ParameterTemplate, ParameterTemplateSource, ParameterValues } from "@wickwatch/core";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { useAsyncAction } from "../composables/useAsyncAction";
import { checks, useValidation } from "../validation";
import AppModal from "./AppModal.vue";
import FieldError from "./FieldError.vue";

/**
 * Saves parameter values as a template of their algo. A name the algo's templates already use replaces that
 * template's values ("Vorlage aktualisieren"), so updating needs no extra screen.
 */
const props = defineProps<{
  open: boolean;
  title: string;
  algoName: string;
  parameters: ParameterValues;
  source?: ParameterTemplateSource | undefined;
  /** The algo's templates, for the replace case. */
  templates: ParameterTemplate[];
}>();
const emit = defineEmits<{ close: []; saved: [message: string] }>();
const { t } = useI18n();
const { busy, error, run } = useAsyncAction();

const name = ref("");
const form = useValidation();
const nameField = form.field(() => name.value, checks.required);
const existing = computed(() => {
  const wanted = name.value.trim().toLowerCase();
  return props.templates.find((tpl) => tpl.name.toLowerCase() === wanted);
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = "";
    error.value = undefined;
    form.reset();
  },
);

function save() {
  if (!form.validate()) return;
  const replace = existing.value;
  const source = props.source ? { source: props.source } : {};
  void run(async () => {
    const saved = replace
      ? await api.updateParameterTemplate(replace.id, { parameters: props.parameters, ...source })
      : await api.createParameterTemplate({
          algoName: props.algoName,
          name: name.value.trim(),
          parameters: props.parameters,
          ...source,
        });
    emit("saved", t(replace ? "templates.replaced" : "templates.saved", { name: saved.name }));
  });
}
</script>

<template>
  <AppModal :open="open" :title="title" :dirty="name !== ''" @close="emit('close')">
    <template #default="{ close }">
      <form class="form" novalidate @submit.prevent="save">
        <label class="field">
          {{ $t("templates.name") }}
          <input
            v-model="name"
            v-bind="nameField.attrs.value"
            class="input"
            list="template-names"
            maxlength="100"
            required
            autocomplete="off"
          />
          <FieldError :field="nameField" />
          <span v-if="existing" class="field__hint tone-warning">
            {{ $t("templates.replaceHint", { name: existing.name }) }}
          </span>
          <span v-else class="field__hint">{{ $t("templates.nameHint", { algo: algoName }) }}</span>
        </label>
        <datalist id="template-names">
          <option v-for="tpl in templates" :key="tpl.id" :value="tpl.name" />
        </datalist>
        <div class="buttons">
          <button type="submit" class="btn btn--primary" :disabled="busy" :aria-busy="busy">
            {{ existing ? $t("templates.replace") : $t("templates.create") }}
          </button>
          <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.cancel") }}</button>
        </div>
        <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      </form>
    </template>
  </AppModal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
  min-width: 0;
}

.form p {
  margin: 0;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}
</style>
