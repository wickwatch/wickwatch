<script setup lang="ts">
import type { Algo, ParameterIssueCode, ParameterSchema, ParameterTemplate, ParameterValues } from "@wickwatch/core";
import { parameterDefaults, validateParameters } from "@wickwatch/core/parameters";
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, errorKey } from "../api";
import { useAsyncAction } from "../composables/useAsyncAction";
import AppSpinner from "../components/AppSpinner.vue";
import FieldError from "../components/FieldError.vue";
import ParameterList from "../components/ParameterList.vue";
import { checks, useValidation } from "../validation";

/**
 * Name and values of a parameter template, in the same parameter list as an instance's configuration. The parameters
 * come from the newest version of the template's algo. A parameter the template does not set shows its default and is
 * only added when changed, so applying the template still leaves it alone; values that version does not know are kept.
 */
const route = useRoute();
const router = useRouter();
const { busy, error, run } = useAsyncAction();

const loading = ref(true);
const template = ref<ParameterTemplate>();
const newest = ref<Algo>();
const name = ref("");
const values = ref<ParameterValues>({});
/** What the form showed at first, to tell the values the user changed. */
const initial = ref<ParameterValues>({});

const schema = computed<ParameterSchema[]>(() => newest.value?.parameters ?? []);
const known = computed(() => new Set(schema.value.map((p) => p.name)));
/** Template values the newest version does not know: not shown, saved as they are. */
const outside = computed(() =>
  Object.fromEntries(Object.entries(template.value?.parameters ?? {}).filter(([k]) => !known.value.has(k))),
);

const form = useValidation();
const nameField = form.field(() => name.value, checks.required);

/** The values to save: those the template sets, and those changed here. */
const stored = computed<ParameterValues>(() => {
  const own = template.value?.parameters ?? {};
  const shown = Object.fromEntries(
    schema.value
      .filter((p) => Object.hasOwn(own, p.name) || values.value[p.name] !== initial.value[p.name])
      .map((p) => [p.name, values.value[p.name]]),
  );
  return { ...outside.value, ...shown };
});
const issues = computed(
  () =>
    new Map<string, ParameterIssueCode>(
      validateParameters(stored.value, schema.value).errors.map((i) => [i.parameter, i.code]),
    ),
);

onMounted(async () => {
  try {
    const [tpl, algos] = await Promise.all([api.parameterTemplate(Number(route.params["id"])), api.algos()]);
    template.value = tpl;
    name.value = tpl.name;
    // Newest first within each algo.
    newest.value = algos.find((a) => a.name === tpl.algoName);
    const shown = {
      ...parameterDefaults(schema.value),
      ...Object.fromEntries(Object.entries(tpl.parameters).filter(([k]) => known.value.has(k))),
    };
    initial.value = shown;
    values.value = { ...shown };
  } catch (e) {
    error.value = errorKey(e);
  } finally {
    loading.value = false;
  }
});

async function save() {
  const tpl = template.value;
  if (!tpl || !form.validate()) return;
  if (issues.value.size) {
    await nextTick();
    document.querySelector<HTMLElement>(`#param-${String([...issues.value.keys()][0])}`)?.focus();
    return;
  }
  await run(async () => {
    const saved = await api.updateParameterTemplate(tpl.id, { name: name.value.trim(), parameters: stored.value });
    await router.push({ name: "algos", query: { saved: saved.name } });
  });
}
</script>

<template>
  <div class="page">
    <RouterLink :to="{ name: 'algos' }" class="back">{{ $t("templates.back") }}</RouterLink>
    <h1>{{ template ? $t("templates.editTitle", { name: template.name }) : $t("templates.title") }}</h1>
    <AppSpinner v-if="loading" />
    <p v-else-if="!template" class="tone-negative" role="alert">{{ error ? $t(error) : "" }}</p>

    <form v-else class="form" novalidate @submit.prevent="save">
      <section class="panel card">
        <label class="field name">
          {{ $t("templates.name") }}
          <input
            v-model="name"
            v-bind="nameField.attrs.value"
            class="input"
            maxlength="100"
            required
            autocomplete="off"
          />
          <FieldError :field="nameField" />
        </label>
      </section>

      <section class="panel card" aria-labelledby="params-title">
        <h2 id="params-title">{{ $t("instanceForm.parameters") }}</h2>
        <template v-if="newest">
          <p class="muted card__hint">
            {{ $t("templates.editIntro", { algo: template.algoName, version: newest.version }) }}
          </p>
          <p v-if="Object.keys(outside).length" class="tone-warning">
            {{ $t("templates.editKept", { names: Object.keys(outside).join(", ") }) }}
          </p>
          <ParameterList v-model:values="values" mode="edit" :schema="schema" :issues="issues" />
        </template>
        <p v-else class="tone-warning">{{ $t("templates.editNoVersion", { algo: template.algoName }) }}</p>
      </section>

      <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      <div class="panel savebar">
        <button type="submit" class="btn btn--primary" :disabled="busy || !newest" :aria-busy="busy">
          {{ $t("action.save") }}
        </button>
        <RouterLink :to="{ name: 'algos' }" class="btn btn--ghost">{{ $t("action.cancel") }}</RouterLink>
      </div>
    </form>
  </div>
</template>

<style scoped>
h1,
p {
  margin: 0;
}

.form,
.card {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
  min-width: 0;
}

.card {
  padding: var(--ww-space-5);
}

.card__hint {
  margin-top: calc(-1 * var(--ww-space-2));
  font-size: var(--ww-size-sm);
}

.name {
  max-width: 32rem;
}
</style>
