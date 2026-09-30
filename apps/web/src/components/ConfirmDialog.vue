<script setup lang="ts">
import { ref, useId, watch } from "vue";

const props = defineProps<{ open: boolean; title: string; message: string; confirmLabel: string }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const dialog = ref<HTMLDialogElement>();
const titleId = useId();

watch(
  () => props.open,
  (open) => {
    if (open && !dialog.value?.open) dialog.value?.showModal();
    if (!open && dialog.value?.open) dialog.value.close();
  },
);
</script>

<template>
  <!-- Native modal dialog: focus trap and Escape come from the browser. Cancel has focus by default. -->
  <dialog ref="dialog" class="dialog panel" :aria-labelledby="titleId" @cancel.prevent="emit('cancel')">
    <h2 :id="titleId">{{ title }}</h2>
    <p>{{ message }}</p>
    <div class="dialog__actions">
      <button type="button" class="btn" autofocus @click="emit('cancel')">{{ $t("action.cancel") }}</button>
      <button type="button" class="btn btn--danger" @click="emit('confirm')">{{ confirmLabel }}</button>
    </div>
  </dialog>
</template>

<style scoped>
.dialog {
  max-width: min(480px, calc(100vw - 32px));
  padding: var(--ww-space-6);
  color: var(--ww-text);
}

.dialog::backdrop {
  background: color-mix(in srgb, var(--ww-bg) 70%, transparent);
}

.dialog__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--ww-space-2);
}
</style>
