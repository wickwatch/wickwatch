<script setup lang="ts">
import { computed, ref, useId, useAttrs } from "vue";
import AppIcon from "./AppIcon.vue";

/**
 * The one file picker (BRAND.md, "Consistency"): a drop zone with a "Choose file" button. Emits the chosen or dropped
 * file; `selected` shows the name of a file that is kept for later (e.g. until "Upload"). Attributes such as those of
 * a validation field go to the file input.
 */
defineOptions({ inheritAttrs: false });
defineProps<{ accept: string; title: string; hint: string; selected?: string | undefined }>();
const emit = defineEmits<{ file: [file: File] }>();
const attrs = useAttrs();
const hintId = useId();
const describedBy = computed(() => [attrs["aria-describedby"], hintId].filter(Boolean).join(" "));
const invalid = computed(() => attrs["aria-invalid"] === "true");

/** Counts enter/leave, since moving over the zone's children fires both. */
const depth = ref(0);
function onDrop(event: DragEvent) {
  depth.value = 0;
  const file = event.dataTransfer?.files[0];
  if (file) emit("file", file);
}
function onInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Cleared, so choosing the same file again fires once more.
  input.value = "";
  if (file) emit("file", file);
}
</script>

<template>
  <div
    class="dropzone"
    :class="{ 'dropzone--over': depth > 0, 'dropzone--invalid': invalid }"
    @dragenter.prevent="depth++"
    @dragover.prevent
    @dragleave="depth = Math.max(0, depth - 1)"
    @drop.prevent="onDrop"
  >
    <AppIcon name="upload" :size="24" class="dropzone__icon" />
    <div class="dropzone__text">
      <strong>{{ title }}</strong>
      <span :id="hintId" class="muted">{{ hint }}</span>
      <span v-if="selected" class="mono dropzone__selected">{{ $t("file.selected", { name: selected }) }}</span>
    </div>
    <div class="dropzone__action">
      <label class="btn">
        {{ $t("file.choose") }}
        <input
          v-bind="attrs"
          type="file"
          class="visually-hidden"
          :accept="accept"
          :aria-describedby="describedBy"
          @change="onInput"
        />
      </label>
      <span class="muted dropzone__drop">{{ $t("file.drop") }}</span>
    </div>
  </div>
</template>

<style scoped>
.dropzone {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-4);
  align-items: center;
  padding: var(--ww-space-4) var(--ww-space-5);
  border: 1px dashed var(--ww-border-strong);
  border-radius: var(--ww-radius-lg);
  background: var(--ww-inset);
}

.dropzone--over {
  border-color: var(--ww-accent);
  border-style: solid;
}

.dropzone--invalid {
  border-color: var(--ww-negative);
}

.dropzone__icon {
  color: var(--ww-text-muted);
}

.dropzone__text {
  display: flex;
  flex: 1 1 280px;
  flex-direction: column;
  gap: var(--ww-space-1);
  font-size: var(--ww-size-sm);
}

.dropzone__selected {
  overflow-wrap: anywhere;
}

.dropzone__action {
  display: flex;
  gap: var(--ww-space-3);
  align-items: center;
}

.dropzone__action .btn:focus-within {
  outline: 2px solid var(--ww-focus);
  outline-offset: 2px;
}

.dropzone__drop {
  font-size: var(--ww-size-xs);
}
</style>
