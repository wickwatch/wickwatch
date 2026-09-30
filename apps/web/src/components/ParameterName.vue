<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { splitLabel } from "../parameter-label";
import IconButton from "./IconButton.vue";

/**
 * A parameter's name with its property name below. A description written into the label ("Name - long text") moves
 * behind an info button: tooltip on hover, and a click or tap shows it below the name (touch has no hover).
 * `forId` makes the name the label of that input.
 */
const props = defineProps<{ label: string; detail?: string | undefined; forId?: string | undefined }>();
const parts = computed(() => splitLabel(props.label));
const open = ref(false);
const descriptionId = useId();
</script>

<template>
  <div class="name">
    <span class="name__line">
      <label v-if="forId" :for="forId" class="name__title">{{ parts.title }}</label>
      <span v-else class="name__title">{{ parts.title }}</span>
      <IconButton
        v-if="parts.description"
        icon="info"
        :label="$t('parameters.describe', { name: parts.title })"
        :tooltip="parts.description"
        variant="ghost"
        small
        class="name__info"
        data-tooltip-wrap
        :aria-expanded="open"
        :aria-controls="descriptionId"
        @click="open = !open"
      />
    </span>
    <span v-if="parts.description" v-show="open" :id="descriptionId" class="name__description">{{
      parts.description
    }}</span>
    <span v-if="detail" class="mono muted name__detail">{{ detail }}</span>
  </div>
</template>

<style scoped>
.name {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.name__line {
  display: flex;
  gap: var(--ww-space-1);
  align-items: center;
  min-width: 0;
}

.name__title {
  font-weight: 500;
  overflow-wrap: anywhere;
}

/* Smaller than a row action: it sits inside the text line. */
.name__info {
  flex: none;
  width: 24px;
  min-width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  color: var(--ww-text-muted);
}

.name__description {
  margin: var(--ww-space-1) 0;
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
  overflow-wrap: anywhere;
}

.name__detail {
  font-size: var(--ww-size-xs);
  font-weight: 400;
  overflow-wrap: anywhere;
}

@media (pointer: coarse) {
  .name__info {
    width: var(--ww-touch-target);
    height: var(--ww-touch-target);
  }
}
</style>
