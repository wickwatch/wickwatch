<script setup lang="ts">
import { ref, useId, watch } from "vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import IconButton from "./IconButton.vue";

/**
 * The shared modal (BRAND.md, "Consistency") on a native modal <dialog>: focus stays inside, Escape closes, focus
 * returns to where it was. A sheet at the bottom on phones. With `dirty` it asks before closing, so typed input is
 * not lost by accident; the slot gets `close`, which asks the same way. Field errors stay inside the content.
 */
const props = defineProps<{
  open: boolean;
  title: string;
  dirty?: boolean;
  /** A panel at the right edge, full height, for details next to a table; the same sheet as the modal on phones. */
  drawer?: boolean;
  /** Almost the whole window, for content that needs room (the log); its content fills the height and scrolls itself. */
  full?: boolean;
  /** Arrows to the previous and next entry (a drawer over a table), also on the up and down keys; which way is open. */
  nav?: { prev: boolean; next: boolean } | undefined;
}>();
const emit = defineEmits<{ close: []; prev: []; next: [] }>();
const dialog = ref<HTMLDialogElement>();
const titleId = useId();
const asking = ref(false);
let returnTo: HTMLElement | null = null;

// After the render. The dialog itself takes the focus: nothing looks selected, and no field shows a problem before
// anything was typed. Tab moves into the content.
watch(
  () => props.open,
  (open) => {
    const el = dialog.value;
    if (!el) return;
    if (open && !el.open) {
      returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
      el.focus();
    }
    if (!open && el.open) {
      el.close();
      returnTo?.focus();
    }
  },
  { flush: "post" },
);

function requestClose() {
  if (props.dirty) asking.value = true;
  else emit("close");
}
/** Up and down step through the entries, unless the focus is in a field or the discard question is open. */
function onKey(event: KeyboardEvent) {
  if (!props.nav || asking.value || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
    return;
  if (event.key === "ArrowUp" && props.nav.prev) {
    event.preventDefault();
    emit("prev");
  } else if (event.key === "ArrowDown" && props.nav.next) {
    event.preventDefault();
    emit("next");
  }
}
function discard() {
  asking.value = false;
  emit("close");
}
</script>

<template>
  <!-- tabindex: the dialog takes the focus itself when it opens. -->
  <dialog
    ref="dialog"
    class="modal panel"
    :class="{ 'modal--drawer': drawer, 'modal--full': full }"
    :aria-labelledby="titleId"
    tabindex="-1"
    @cancel.prevent="requestClose"
    @keydown="onKey"
  >
    <header class="modal__head">
      <h2 :id="titleId">{{ title }}</h2>
      <div class="modal__actions">
        <template v-if="nav">
          <IconButton
            icon="chevronUp"
            :label="$t('modal.previous')"
            variant="ghost"
            :disabled="!nav.prev"
            @click="emit('prev')"
          />
          <IconButton
            icon="chevronDown"
            :label="$t('modal.next')"
            variant="ghost"
            :disabled="!nav.next"
            @click="emit('next')"
          />
        </template>
        <IconButton icon="close" :label="$t('modal.close')" :tooltip="false" variant="ghost" @click="requestClose" />
      </div>
    </header>
    <div class="modal__body">
      <!-- `close` asks first like the X, for a cancel button in the content. -->
      <slot v-if="open" :close="requestClose" />
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

.modal__actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--ww-space-1);
}

.modal__body {
  overflow-y: auto;
  padding: var(--ww-space-5);
}

.modal--full {
  width: calc(100vw - 64px);
  max-width: none;
  height: calc(100dvh - 64px);
}

.modal--full .modal__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.modal--drawer {
  width: min(440px, 100vw);
  height: 100dvh;
  max-height: 100dvh;
  margin: 0 0 0 auto;
  border-width: 0 0 0 1px;
  border-radius: var(--ww-radius-xl) 0 0 var(--ww-radius-xl);
}

.modal--drawer[open] {
  animation: drawer-in 0.2s ease-out;
}

@keyframes drawer-in {
  from {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .modal--drawer[open] {
    animation: none;
  }
}

/* Phones: a sheet at the bottom, as tall as its content; long content scrolls inside, the page stays visible above. */
@media (max-width: 640px) {
  .modal {
    width: 100vw;
    max-width: 100vw;
    max-height: calc(100dvh - var(--ww-space-8));
    height: fit-content;
    margin: auto 0 0;
    border-width: 1px 0 0;
    border-radius: var(--ww-radius-xl) var(--ww-radius-xl) 0 0;
  }

  .modal--drawer[open] {
    animation: none;
  }

  .modal--full {
    height: calc(100dvh - var(--ww-space-8));
  }

  .modal__body {
    padding-bottom: calc(var(--ww-space-5) + env(safe-area-inset-bottom));
  }
}
</style>
