<script setup lang="ts">
import type { ParameterSchema, ParameterTemplate, ParameterValues } from "@wickwatch/core";
import { applyTemplate } from "@wickwatch/core/parameters";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, type ManagedInstanceDetail } from "../api";
import { useAccountSizeWarning } from "../composables/useAccountSizeWarning";
import { useAsyncAction } from "../composables/useAsyncAction";
import { parameterTitle } from "../parameter-label";
import { system } from "../system";
import AppModal from "./AppModal.vue";

/**
 * Applies a parameter template to an instance: shows every value it changes, each one can be left out (e.g. a licence
 * key bound to another account), and saves the rest as a new version. Nothing is restarted; the configuration tab then
 * offers to apply the version as for any other saved one.
 */
const props = defineProps<{
  open: boolean;
  instance: ManagedInstanceDetail;
  schema: ParameterSchema[];
  /** The templates of the instance's algo. */
  templates: ParameterTemplate[];
}>();
const emit = defineEmits<{ close: []; saved: [version: number] }>();
const { t } = useI18n();
const { busy, error, run } = useAsyncAction();

const chosenId = ref<number>();
/** Changes the user left out. */
const skipped = ref(new Set<string>());
const comment = ref("");

const chosen = computed(() => props.templates.find((tpl) => tpl.id === chosenId.value));
const current = computed(() => props.instance.config.parameters);
const result = computed(() =>
  chosen.value
    ? applyTemplate(current.value, chosen.value.parameters, props.schema, {
        requireText: system.value?.capabilities?.requiresTextValues === true,
      })
    : undefined,
);
const taken = computed(() => result.value?.changed.filter((n) => !skipped.value.has(n)) ?? []);
const nextVersion = computed(() => props.instance.config.version + 1);
/** The values the new version would have, checked like the instance form does. */
const next = computed<ParameterValues>(() => {
  const values = result.value?.values ?? {};
  return { ...current.value, ...Object.fromEntries(taken.value.map((n) => [n, values[n]])) };
});
const { text: accountSizeWarning } = useAccountSizeWarning({
  check: () => props.instance.accountSizeCheck,
  values: () => next.value,
  schema: () => props.schema,
});

/** A fresh start for the chosen template: all its changes taken, its name as the comment. */
function choose(id: number | undefined) {
  chosenId.value = id;
  skipped.value = new Set();
  comment.value = chosen.value ? t("templates.appliedComment", { name: chosen.value.name }) : "";
}
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    // Nothing chosen at first: a long list of changes before a choice would only confuse.
    choose(undefined);
    error.value = undefined;
  },
);

const label = (n: string) => parameterTitle(props.schema, n);
const show = (value: unknown) => (value === undefined || value === "" ? t("format.none") : String(value));
const names = (list: string[]) => list.map(label).join(", ");
const rejected = computed(() =>
  (result.value?.rejected ?? []).map((i) => `${label(i.parameter)} (${t(`parameterIssue.${i.code}`)})`).join(", "),
);

function toggle(name: string, on: boolean) {
  const next = new Set(skipped.value);
  if (on) next.delete(name);
  else next.add(name);
  skipped.value = next;
}

function save() {
  const tpl = chosen.value;
  const values = result.value?.values;
  const { config } = props.instance;
  const algoId = config.algo.id;
  if (!tpl || !values || algoId === null || !taken.value.length) return;
  // Only parameters this algo version knows, as the form does; the server refuses others.
  const known = new Set(props.schema.map((p) => p.name));
  const parameters: ParameterValues = Object.fromEntries(Object.entries(next.value).filter(([k]) => known.has(k)));
  void run(async () => {
    const saved = await api.saveInstanceConfig(props.instance.name, {
      algoId,
      symbol: config.symbol,
      period: config.period,
      parameters,
      attribution: config.attribution,
      ...(comment.value.trim() ? { comment: comment.value.trim() } : {}),
      template: tpl.id,
    });
    emit("saved", saved.config.version);
  });
}
</script>

<template>
  <AppModal :open="open" :title="$t('templates.applyTitle')" @close="emit('close')">
    <template #default="{ close }">
      <form class="form" novalidate @submit.prevent="save">
        <p v-if="!templates.length" class="muted">
          {{ $t("templates.none", { algo: instance.config.algo.name }) }}
        </p>
        <template v-else>
          <label class="field">
            {{ $t("templates.choose") }}
            <select
              :value="chosenId ?? ''"
              class="input"
              @change="choose(Number(($event.target as HTMLSelectElement).value))"
            >
              <option value="" disabled>{{ $t("templates.choosePlaceholder") }}</option>
              <option v-for="tpl in templates" :key="tpl.id" :value="tpl.id">{{ tpl.name }}</option>
            </select>
            <!-- Only before the choice; afterwards the list of changes and the comment field explain themselves. -->
            <span v-if="!chosen" class="field__hint">{{ $t("templates.chooseHint") }}</span>
          </label>

          <template v-if="result">
            <p v-if="!result.changed.length" class="muted">{{ $t("templates.noChanges") }}</p>
            <fieldset v-else class="changes">
              <legend>{{ $t("templates.changes", result.changed.length) }}</legend>
              <p class="muted hint">{{ $t("templates.changesHint") }}</p>
              <label v-for="n in result.changed" :key="n" class="change">
                <input
                  type="checkbox"
                  :checked="!skipped.has(n)"
                  @change="toggle(n, ($event.target as HTMLInputElement).checked)"
                />
                <span class="change__name">{{ label(n) }}</span>
                <span class="mono change__values">{{
                  $t("templates.change", { from: show(current[n]), to: show(result.values[n]) })
                }}</span>
              </label>
            </fieldset>
            <div role="status" class="notes">
              <p v-if="accountSizeWarning" class="tone-warning notes__strong">{{ accountSizeWarning }}</p>
              <p v-if="rejected" class="tone-warning">{{ $t("templates.rejected", { names: rejected }) }}</p>
              <p v-if="result.unknown.length" class="tone-warning">
                {{ $t("templates.unknown", { names: result.unknown.join(", ") }) }}
              </p>
              <p v-if="result.kept.length" class="muted">
                {{ $t("templates.kept", { names: names(result.kept) }) }}
              </p>
            </div>

            <label class="field">
              {{ $t("instanceForm.comment") }}
              <input v-model="comment" class="input" maxlength="500" autocomplete="off" />
              <span class="field__hint">{{ $t("templates.applyHint") }}</span>
            </label>
          </template>
        </template>

        <div class="buttons">
          <button
            v-if="templates.length"
            type="submit"
            class="btn btn--primary"
            :disabled="busy || !taken.length"
            :aria-busy="busy"
          >
            {{ $t("templates.saveVersion", { version: nextVersion }) }}
          </button>
          <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.cancel") }}</button>
        </div>
        <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      </form>
    </template>
  </AppModal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
  min-width: 0;
}

.form p {
  margin: 0;
}

.changes {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.changes legend {
  margin-bottom: var(--ww-space-1);
  padding: 0;
  font-size: var(--ww-size-sm);
  font-weight: 600;
}

.hint,
.notes {
  font-size: var(--ww-size-xs);
}

.notes {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-1);
}

.notes__strong {
  font-weight: 600;
}

.notes:empty {
  display: none;
}

.change {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--ww-space-3);
  align-items: baseline;
  padding: var(--ww-space-2) 0;
  border-top: 1px solid var(--ww-border);
  font-size: var(--ww-size-sm);
  cursor: pointer;
}

.change input {
  accent-color: var(--ww-accent);
}

.change__values {
  font-size: var(--ww-size-xs);
  text-align: right;
  word-break: break-all;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}

@media (max-width: 640px) {
  .change {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .change__values {
    grid-column: 2;
    text-align: left;
  }
}
</style>
