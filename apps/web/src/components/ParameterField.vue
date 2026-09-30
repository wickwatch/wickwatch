<script setup lang="ts">
import type { ParameterIssueCode, ParameterSchema } from "@wickwatch/core";
import { computed } from "vue";
import IconButton from "./IconButton.vue";
import ParameterName from "./ParameterName.vue";

/**
 * One parameter as a row: label left, input right, a reset button when the value differs from the default. Default
 * and range show when the value is changed or the field has focus; problems always.
 */
const props = defineProps<{
  param: ParameterSchema;
  modelValue: unknown;
  /** `required`: empty after the form was sent. */
  issue?: ParameterIssueCode | "required" | undefined;
  /** Suggestions for `symbol` and `period` parameters. */
  symbolsList?: string | undefined;
  periodsList?: string | undefined;
}>();
const emit = defineEmits<{ "update:modelValue": [value: unknown] }>();

const id = computed(() => `param-${props.param.name}`);
const changed = computed(() => props.param.default !== undefined && props.modelValue !== props.param.default);
const text = computed(() => (props.modelValue === undefined ? "" : String(props.modelValue)));
const hasDefault = computed(() => props.param.default !== undefined);

function onNumber(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  // Empty or partial input stays a string, so the server reports it instead of silently using 0.
  emit("update:modelValue", raw === "" || Number.isNaN(Number(raw)) ? raw : Number(raw));
}
const onText = (event: Event) => {
  emit("update:modelValue", (event.target as HTMLInputElement | HTMLSelectElement).value);
};

// Colours are #AARRGGBB (alpha first); the browser's picker knows #RRGGBB only, so the alpha is kept.
const COLOR = /^#(?:([0-9A-Fa-f]{2}))?([0-9A-Fa-f]{6})$/;
const pickerValue = computed(() => {
  const match = COLOR.exec(text.value);
  return match ? `#${(match[2] ?? "000000").toLowerCase()}` : "#000000";
});
function onPick(event: Event) {
  const rgb = (event.target as HTMLInputElement).value.slice(1).toUpperCase();
  const alpha = COLOR.exec(text.value)?.[1]?.toUpperCase() ?? "FF";
  emit("update:modelValue", `#${alpha}${rgb}`);
}
</script>

<template>
  <div class="param" :class="{ 'param--changed': changed, 'param--invalid': issue }">
    <ParameterName
      class="param__head"
      :label="param.label ?? param.name"
      :detail="param.label ? `${param.name} · ${param.type}` : param.type"
      :for-id="id"
    />

    <div class="param__control">
      <input
        v-if="param.type === 'bool'"
        :id="id"
        type="checkbox"
        class="param__check"
        :checked="modelValue === true"
        :aria-invalid="issue ? 'true' : undefined"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
      <select
        v-else-if="param.type === 'enum'"
        :id="id"
        class="input"
        :value="text"
        :aria-invalid="issue ? 'true' : undefined"
        @change="onText"
      >
        <option v-for="o in param.options ?? []" :key="o" :value="o">{{ o }}</option>
      </select>
      <input
        v-else-if="param.type === 'int' || param.type === 'double'"
        :id="id"
        class="input mono"
        type="number"
        :min="param.min"
        :max="param.max"
        :step="param.step ?? (param.type === 'int' ? 1 : 'any')"
        :value="text"
        :aria-invalid="issue ? 'true' : undefined"
        @input="onNumber"
      />
      <template v-else-if="param.type === 'color'">
        <input
          :id="id"
          class="input mono"
          :value="text"
          autocomplete="off"
          spellcheck="false"
          :aria-invalid="issue ? 'true' : undefined"
          @input="onText"
        />
        <input
          type="color"
          class="param__swatch"
          :value="pickerValue"
          :aria-label="$t('instanceForm.pickColor')"
          @input="onPick"
        />
      </template>
      <input
        v-else
        :id="id"
        class="input mono"
        :type="param.type === 'time' ? 'time' : 'text'"
        :list="param.type === 'symbol' ? symbolsList : param.type === 'period' ? periodsList : undefined"
        :value="text"
        :aria-invalid="issue ? 'true' : undefined"
        @input="onText"
      />
      <IconButton
        v-if="changed"
        icon="restore"
        :label="$t('parameters.resetOne', { value: String(param.default) })"
        variant="ghost"
        small
        @click="emit('update:modelValue', param.default)"
      />
    </div>

    <p class="param__hint">
      <span v-if="issue" class="tone-negative">{{ $t(`parameterIssue.${issue}`) }}</span>
      <span v-if="changed" class="pill tone-warning">{{ $t("instanceForm.changed") }}</span>
      <span class="param__meta">
        <span v-if="hasDefault">{{ $t("parameters.default", { value: String(param.default) }) }}</span>
        <span v-if="param.min !== undefined || param.max !== undefined" class="mono">
          {{ `${param.min ?? ""} … ${param.max ?? ""}` }}
        </span>
      </span>
    </p>
  </div>
</template>

<style scoped>
.param {
  display: grid;
  grid-template-areas:
    "head control"
    "head hint";
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--ww-space-1) var(--ww-space-4);
  align-items: start;
  min-width: 0;
  padding: var(--ww-space-3) 0;
  border-bottom: 1px solid var(--ww-border);
  font-size: var(--ww-size-sm);
}

.param__head {
  grid-area: head;
  padding-top: var(--ww-space-2);
}

.param__control {
  display: flex;
  grid-area: control;
  gap: var(--ww-space-2);
  align-items: center;
  min-width: 0;
}

.param__control .input {
  flex: 1;
  min-width: 0;
}

.param__check {
  width: var(--ww-space-5);
  height: var(--ww-space-5);
  margin: var(--ww-space-2) auto var(--ww-space-2) 0;
  accent-color: var(--ww-accent);
}

.param__swatch {
  flex: none;
  width: var(--ww-touch-target);
  height: var(--ww-touch-target);
  padding: 0;
  border: 1px solid var(--ww-border-strong);
  border-radius: var(--ww-radius-md);
  background: var(--ww-inset);
  cursor: pointer;
}

.param--changed .input {
  border-color: var(--ww-warning);
}

.param--invalid .input {
  border-color: var(--ww-negative);
}

.param__hint {
  display: flex;
  grid-area: hint;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
  align-items: center;
  margin: 0;
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
}

.param__meta {
  display: none;
  gap: var(--ww-space-2);
}

/* Default and range only when they matter: the value differs, or the field is being edited. */
.param--changed .param__meta,
.param:focus-within .param__meta {
  display: inline-flex;
}

@media (max-width: 640px) {
  .param {
    grid-template-areas:
      "head"
      "control"
      "hint";
    grid-template-columns: minmax(0, 1fr);
  }

  .param__head {
    padding-top: 0;
  }
}
</style>
