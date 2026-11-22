<script setup lang="ts">
import type { Algo } from "@wickwatch/core";
import { computed, ref, useId, watch } from "vue";
import { api } from "../api";
import { useAsyncAction } from "../composables/useAsyncAction";
import { checks, useValidation } from "../validation";
import AppModal from "./AppModal.vue";
import FieldError from "./FieldError.vue";

/**
 * Files a version under another algo name and/or gives it another version, for bots that name each release
 * differently: filed under one algo, the versions share templates, settings and the update of instances.
 */
const props = defineProps<{
  open: boolean;
  algo: Algo;
  /** The algo names there are, to pick from. */
  names: string[];
}>();
const emit = defineEmits<{ close: []; saved: [algo: Algo] }>();
const { busy, error, run } = useAsyncAction();
const listId = useId();

const name = ref("");
const version = ref("");
const form = useValidation();
const nameField = form.field(() => name.value, checks.required, checks.version);
const versionField = form.field(() => version.value, checks.required, checks.version);
const dirty = computed(() => name.value.trim() !== props.algo.name || version.value.trim() !== props.algo.version);
/** Other algos than its own, to file it under. */
const others = computed(() => props.names.filter((n) => n !== props.algo.name));

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = props.algo.name;
    version.value = props.algo.version;
    error.value = undefined;
    form.reset();
  },
  // The page mounts the dialog already open.
  { immediate: true },
);

function save() {
  if (!form.validate()) return;
  const body = {
    ...(name.value.trim() !== props.algo.name ? { name: name.value.trim() } : {}),
    ...(version.value.trim() !== props.algo.version ? { version: version.value.trim() } : {}),
  };
  void run(async () => {
    emit("saved", await api.fileAlgo(props.algo.id, body));
  });
}
</script>

<template>
  <AppModal
    :open="open"
    :title="$t('algos.fileTitle', { name: algo.name, version: algo.version })"
    :dirty="dirty"
    @close="emit('close')"
  >
    <template #default="{ close }">
      <form class="form" novalidate @submit.prevent="save">
        <p class="muted hint">{{ $t("algos.fileIntro") }}</p>
        <label class="field">
          {{ $t("algos.fileName") }}
          <input
            v-model="name"
            v-bind="nameField.attrs.value"
            class="input mono"
            :list="listId"
            maxlength="100"
            autocomplete="off"
            spellcheck="false"
          />
          <datalist :id="listId">
            <option v-for="n in others" :key="n" :value="n" />
          </datalist>
          <FieldError :field="nameField" />
          <span class="field__hint">{{ $t("algos.fileNameHint") }}</span>
        </label>
        <label class="field">
          {{ $t("algos.fileVersion") }}
          <input
            v-model="version"
            v-bind="versionField.attrs.value"
            class="input mono"
            maxlength="100"
            autocomplete="off"
            spellcheck="false"
          />
          <FieldError :field="versionField" />
        </label>
        <div class="buttons">
          <button type="submit" class="btn btn--primary" :disabled="busy || !dirty" :aria-busy="busy">
            {{ $t("action.save") }}
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

.hint {
  font-size: var(--ww-size-xs);
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}
</style>
