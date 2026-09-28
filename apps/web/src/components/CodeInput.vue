<script setup lang="ts">
import { normalizers, vNormalize, type Field } from "../validation";
import FieldError from "./FieldError.vue";

const model = defineModel<string>({ required: true });
defineProps<{ label: string; hint?: string; required?: boolean; field?: Field }>();
</script>

<template>
  <label class="field">
    {{ label }}
    <input
      v-model="model"
      v-normalize="normalizers.digits"
      v-bind="field?.attrs.value"
      class="input mono"
      autocomplete="one-time-code"
      inputmode="numeric"
      maxlength="8"
      :required="required"
    />
    <FieldError v-if="field" :field="field" />
    <span v-if="hint" class="field__hint">{{ hint }}</span>
  </label>
</template>
