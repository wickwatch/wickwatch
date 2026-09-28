<script setup lang="ts">
import type { ParameterIssueCode, ParameterSchema } from "@wickwatch/core";
import { computed } from "vue";

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
    <label :for="id" class="param__label">
      <span>{{ param.label ?? param.name }}</span>
      <span class="mono muted param__key">{{ param.label ? `${param.name} · ${param.type}` : param.type }}</span>
    </label>

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
    <div v-else-if="param.type === 'color'" class="param__color">
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
    </div>
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

    <span class="field__hint param__hint">
      <span v-if="issue" class="tone-negative">{{ $t(`parameterIssue.${issue}`) }}</span>
      <span v-if="changed" class="pill tone-warning">{{ $t("instanceForm.changed") }}</span>
      <span v-if="hasDefault">{{ $t("instanceForm.default", { value: String(param.default) }) }}</span>
      <span v-if="param.min !== undefined || param.max !== undefined" class="mono">
        {{ `${param.min ?? ""} … ${param.max ?? ""}` }}
      </span>
      <button
        v-if="changed"
        type="button"
        class="btn btn--ghost btn--small"
        @click="emit('update:modelValue', param.default)"
      >
        {{ $t("instanceForm.reset") }}
      </button>
    </span>
  </div>
</template>

<style scoped>
.param {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-1);
  min-width: 0;
  font-size: var(--ww-size-sm);
}

.param__label {
  display: flex;
  flex-direction: column;
}

.param__key {
  font-size: var(--ww-size-xs);
}

.param__check {
  width: var(--ww-space-5);
  height: var(--ww-space-5);
  margin: var(--ww-space-2) 0;
  accent-color: var(--ww-accent);
}

.param__color {
  display: flex;
  gap: var(--ww-space-2);
  align-items: center;
}

.param__color .input {
  flex: 1;
  min-width: 0;
}

.param__swatch {
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
  flex-wrap: wrap;
  gap: var(--ww-space-2);
  align-items: center;
}
</style>
