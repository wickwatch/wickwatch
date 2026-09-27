<script setup lang="ts">
const model = defineModel<string>({ required: true });
defineProps<{ label: string; hint?: string; required?: boolean }>();
</script>

<template>
  <label class="field">
    {{ label }}
    <input
      v-model="model"
      class="input mono"
      autocomplete="one-time-code"
      inputmode="numeric"
      pattern="[0-9 ]{6,8}"
      maxlength="8"
      :required="required"
    />
    <span v-if="hint" class="field__hint">{{ hint }}</span>
  </label>
</template>
