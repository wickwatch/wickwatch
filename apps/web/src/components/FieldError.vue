<script setup lang="ts">
import type { Field } from "../validation";

defineProps<{ field: Field }>();
</script>

<template>
  <!-- Text next to the red border: the problem never depends on colour alone. -->
  <span v-if="field.shown.value" :id="`${field.id}-error`" class="field__error">
    {{ $t(field.shown.value.key, field.shown.value.params ?? {}) }}
  </span>
</template>
