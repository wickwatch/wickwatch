<script setup lang="ts">
import { ref, useId, watch } from "vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import IconButton from "./IconButton.vue";

/**
 * The shared modal (BRAND.md, "Consistency") on a native modal <dialog>: focus stays inside, Escape closes, focus
 * returns to where it was. A full-screen sheet on phones. With `dirty` it asks before closing, so typed input is
 * not lost by accident; field errors stay inside the content.
 */
const props = defineProps<{ open: boolean; title: string; dirty?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const titleId = useId();
const asking = ref(false);
let returnTo: HTMLElement | null = null;

watch(
  () => props.open,
  (open) => {
    if (open && !dialog.value?.open) {
      returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.value?.showModal();
    }
    if (!open && dialog.value?.open) {
      dialog.value.close();
      returnTo?.focus();
    }
  },
);

function requestClose() {
  if (props.dirty) asking.value = true;
  else emit("close");
}
function discard() {
  asking.value = false;
  emit("close");
}
</script>

<template>
  <!-- autofocus: the dialog itself takes focus, not the close button, so nothing is triggered by accident. -->
  <dialog
    ref="dialog"
    class="modal panel"
    :aria-labelledby="titleId"
    autofocus
    tabindex="-1"
    @cancel.prevent="requestClose"
  >
    <header class="modal__head">
      <h2 :id="titleId">{{ title }}</h2>
      <IconButton icon="close" :label="$t('modal.close')" variant="ghost" @click="requestClose" />
    </header>
    <div class="modal__body">
      <slot v-if="open" />
    </div>
    <ConfirmDialog
      :open="asking"
      :title="$t('modal.discardTitle')"
      :message="$t('modal.discardMessage')"
      :confirm-label="$t('modal.discard')"
      @confirm="discard"
      @cancel="asking = false"
    />
  </dialog>
</template>

<style scoped>
.modal {
  width: min(760px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  padding: 0;
  color: var(--ww-text);
}

.modal:focus {
  outline: none;
}

.modal[open] {
  display: flex;
  flex-direction: column;
}

.modal::backdrop {
  background: color-mix(in srgb, var(--ww-bg) 70%, transparent);
}

.modal__head {
  display: flex;
  gap: var(--ww-space-3);
  justify-content: space-between;
  align-items: center;
  padding: var(--ww-space-4) var(--ww-space-5);
  border-bottom: 1px solid var(--ww-border);
}

.modal__head h2 {
  margin: 0;
  font-size: var(--ww-size-lg);
}

.modal__body {
  overflow-y: auto;
  padding: var(--ww-space-5);
}

@media (max-width: 640px) {
  .modal {
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
    border-radius: 0;
  }
}
</style>
