<script setup lang="ts">
import type { Algo } from "@wickwatch/core";
import { ACCOUNT_SIZE_TOLERANCE } from "@wickwatch/core/parameters";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { useAsyncAction } from "../composables/useAsyncAction";
import { formatPercent } from "../format";
import { parameterTitle } from "../parameter-label";
import { isAdmin } from "../session";

/**
 * Which parameter of an algo holds the account size it calculates with, so its instances are checked against the
 * account (one zero too many multiplies the risk of every trade). Chosen from the numbers of the newest version.
 */
const props = defineProps<{
  algoName: string;
  newest: Algo | undefined;
  parameter: string | undefined;
}>();
const emit = defineEmits<{ changed: [message: string] }>();
const { t, locale } = useI18n();
const { busy, error, run } = useAsyncAction();

const chosen = ref(props.parameter ?? "");
watch(
  () => props.parameter,
  (value) => (chosen.value = value ?? ""),
);

const schema = computed(() => props.newest?.parameters ?? []);
/** The numbers of the newest version; a saved parameter it no longer has stays selectable, so it is not dropped unseen. */
const options = computed(() => {
  const list = schema.value
    .filter((p) => p.type === "int" || p.type === "double")
    .map((p) => ({ name: p.name, title: parameterTitle(schema.value, p.name) }));
  if (props.parameter && !list.some((o) => o.name === props.parameter))
    list.unshift({ name: props.parameter, title: props.parameter });
  return list;
});
const tolerance = computed(() => formatPercent(locale.value, ACCOUNT_SIZE_TOLERANCE));
const shown = computed(() => (props.parameter ? parameterTitle(schema.value, props.parameter) : t("accountSize.none")));

function save() {
  const parameter = chosen.value || null;
  void run(async () => {
    await api.saveAlgoSettings(props.algoName, { accountSizeParameter: parameter });
    emit(
      "changed",
      parameter
        ? t("accountSize.saved", { algo: props.algoName, parameter: parameterTitle(schema.value, parameter) })
        : t("accountSize.cleared", { algo: props.algoName }),
    );
  });
}
</script>

<template>
  <!-- Folded by default: not every algo has such a parameter. The summary says what is set. -->
  <details class="size">
    <summary class="size__summary">
      <span class="size__title">{{ $t("accountSize.title") }}</span
      ><span class="muted size__state"> · {{ shown }}</span>
    </summary>
    <p class="muted hint">{{ $t("accountSize.hint", { algo: algoName, tolerance }) }}</p>
    <form v-if="isAdmin && newest" class="size__form" novalidate @submit.prevent="save">
      <label class="field size__field">
        {{ $t("accountSize.parameter") }}
        <select v-model="chosen" class="input">
          <option value="">{{ $t("accountSize.none") }}</option>
          <option v-for="o in options" :key="o.name" :value="o.name">{{ o.title }}</option>
        </select>
      </label>
      <button type="submit" class="btn" :disabled="busy || chosen === (parameter ?? '')" :aria-busy="busy">
        {{ $t("accountSize.save") }}
      </button>
    </form>
    <p v-else class="hint">
      {{ $t("accountSize.parameter") }}: <span class="mono">{{ shown }}</span>
      <span v-if="isAdmin && !newest" class="muted"> · {{ $t("accountSize.noVersion") }}</span>
    </p>
    <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
  </details>
</template>

<style scoped>
.size {
  padding-top: var(--ww-space-3);
  border-top: 1px solid var(--ww-border);
}

.size[open] {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
}

.size p {
  margin: 0;
}

/* A plain summary with the browser's marker, like the parameter list of a version on the same card. */
.size__summary {
  font-size: var(--ww-size-sm);
  cursor: pointer;
}

.size__title {
  font-weight: 600;
}

.size__state {
  font-size: var(--ww-size-xs);
}

.hint {
  font-size: var(--ww-size-xs);
}

.size__form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2) var(--ww-space-3);
  align-items: flex-end;
}

.size__field {
  flex: 0 1 24rem;
  min-width: 0;
}

@media (max-width: 640px) {
  .size__field,
  .size__form .btn {
    flex: 1 1 100%;
  }
}
</style>
