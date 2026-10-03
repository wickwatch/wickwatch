<script setup lang="ts">
import type { Algo, AlgoSettings } from "@wickwatch/core";
import { ACCOUNT_SIZE_TOLERANCE, numberParameters } from "@wickwatch/core/parameters";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { useAsyncAction } from "../composables/useAsyncAction";
import { formatPercent } from "../format";
import { parameterTitle } from "../parameter-label";
import { isAdmin } from "../session";

/**
 * Which parameters of an algo hold the account size it calculates with and its risk per trade in percent, so its
 * instances are checked against the account (one zero too many multiplies the risk of every trade) and their risk is
 * shown in money against the challenge's loss limits. Chosen from the numbers of the newest version.
 */
const props = defineProps<{
  algoName: string;
  newest: Algo | undefined;
  settings: AlgoSettings | undefined;
}>();
const emit = defineEmits<{ changed: [message: string] }>();
const { t, locale } = useI18n();
const { busy, error, run } = useAsyncAction();

const size = ref("");
const risk = ref("");
watch(
  () => props.settings,
  (s) => {
    size.value = s?.accountSizeParameter ?? "";
    risk.value = s?.riskParameter ?? "";
  },
  { immediate: true },
);

const schema = computed(() => props.newest?.parameters ?? []);
const title = (name: string | undefined) => (name ? parameterTitle(schema.value, name) : t("algoSizing.none"));
/** The numbers of the newest version; a saved parameter it no longer has stays selectable, so it is not dropped unseen. */
function options(saved: string | undefined) {
  const list = numberParameters(schema.value).map((p) => ({
    name: p.name,
    title: parameterTitle(schema.value, p.name),
  }));
  if (saved && !list.some((o) => o.name === saved)) list.unshift({ name: saved, title: saved });
  return list;
}
const sizeOptions = computed(() => options(props.settings?.accountSizeParameter));
const riskOptions = computed(() => options(props.settings?.riskParameter));
const tolerance = computed(() => formatPercent(locale.value, ACCOUNT_SIZE_TOLERANCE));
const shown = computed(() =>
  t("algoSizing.state", {
    size: title(props.settings?.accountSizeParameter),
    risk: title(props.settings?.riskParameter),
  }),
);
const unchanged = computed(
  () =>
    size.value === (props.settings?.accountSizeParameter ?? "") && risk.value === (props.settings?.riskParameter ?? ""),
);

function save() {
  void run(async () => {
    await api.saveAlgoSettings(props.algoName, {
      accountSizeParameter: size.value || null,
      riskParameter: risk.value || null,
    });
    emit("changed", t("algoSizing.saved", { algo: props.algoName }));
  });
}
</script>

<template>
  <!-- Folded by default: not every algo has such parameters. The summary says what is set. -->
  <details class="size">
    <summary class="size__summary">
      <span class="size__title">{{ $t("algoSizing.title") }}</span
      ><span class="muted size__state"> · {{ shown }}</span>
    </summary>
    <p class="muted hint">{{ $t("algoSizing.sizeHint", { algo: algoName, tolerance }) }}</p>
    <p class="muted hint">{{ $t("algoSizing.riskHint") }}</p>
    <form v-if="isAdmin && newest" class="size__form" novalidate @submit.prevent="save">
      <label class="field size__field">
        {{ $t("algoSizing.sizeParameter") }}
        <select v-model="size" class="input">
          <option value="">{{ $t("algoSizing.none") }}</option>
          <option v-for="o in sizeOptions" :key="o.name" :value="o.name">{{ o.title }}</option>
        </select>
      </label>
      <label class="field size__field">
        {{ $t("algoSizing.riskParameter") }}
        <select v-model="risk" class="input">
          <option value="">{{ $t("algoSizing.none") }}</option>
          <option v-for="o in riskOptions" :key="o.name" :value="o.name">{{ o.title }}</option>
        </select>
      </label>
      <button type="submit" class="btn" :disabled="busy || unchanged" :aria-busy="busy">
        {{ $t("algoSizing.save") }}
      </button>
    </form>
    <!-- Viewers see what is set in the summary. -->
    <p v-else-if="isAdmin" class="hint muted">{{ $t("algoSizing.noVersion") }}</p>
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
  flex: 0 1 18rem;
  min-width: 0;
}

@media (max-width: 640px) {
  .size__field,
  .size__form .btn {
    flex: 1 1 100%;
  }
}
</style>
