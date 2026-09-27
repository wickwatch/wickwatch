<script setup lang="ts">
import type { AttributionMode, ParameterIssueCode, ParameterSchema } from "@wickwatch/core";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  api,
  ApiError,
  errorKey,
  type AccountRow,
  type AlgoRow,
  type ConfigInput,
  type InstanceConfigRow,
} from "../api";
import ParameterField from "../components/ParameterField.vue";
import { formatDateTime } from "../format";
import { system } from "../system";

/** Same order as the core's ATTRIBUTION_MODES; the web app imports only types from the core. */
const MODES: AttributionMode[] = ["auto", "label", "label-pattern", "account-symbol"];

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

/** Set when editing; new instances (also duplicates) have no name yet. */
const editing = computed(() => (route.name === "instance-edit" ? String(route.params["ref"]) : undefined));
const source = computed(
  () => editing.value ?? (typeof route.query["from"] === "string" ? route.query["from"] : undefined),
);

const algos = ref<AlgoRow[]>([]);
const accounts = ref<AccountRow[]>([]);
const symbols = ref<string[]>([]);
const symbolsError = ref<string>();
const loading = ref(true);
const busy = ref(false);
const error = ref<string>();
const issues = ref(new Map<string, ParameterIssueCode>());
/** The configuration being edited or copied, if its algo version no longer exists. */
const missingAlgo = ref<string>();

const name = ref("");
const accountId = ref<number>();
const algoId = ref<number>();
const symbol = ref("");
const period = ref("");
const values = ref<Record<string, unknown>>({});
const mode = ref<AttributionMode>("auto");
const orderLabel = ref("");
const comment = ref("");

const algo = computed(() => algos.value.find((a) => a.id === algoId.value));
const schema = computed<ParameterSchema[]>(() => algo.value?.parameters ?? []);
const periods = computed(() => system.value?.periods ?? []);
/** Values that the chosen algo version does not know; they are left out when saving. */
const dropped = computed(() => Object.keys(values.value).filter((k) => !schema.value.some((p) => p.name === k)));
const groups = computed(() => {
  const byGroup = new Map<string, ParameterSchema[]>();
  for (const p of schema.value) byGroup.set(p.group ?? "", [...(byGroup.get(p.group ?? "") ?? []), p]);
  return [...byGroup.entries()];
});
const algoGroups = computed(() => {
  const byName = new Map<string, AlgoRow[]>();
  for (const a of algos.value) byName.set(a.name, [...(byName.get(a.name) ?? []), a]);
  return [...byName.entries()];
});
const usesLabel = computed(() => mode.value === "label" || mode.value === "label-pattern");

const defaults = (params: ParameterSchema[]) =>
  Object.fromEntries(params.filter((p) => p.default !== undefined).map((p) => [p.name, p.default]));

/** Keeps the values the new algo version still knows; new parameters start with their default. */
watch(algoId, () => {
  if (loading.value) return;
  const kept = Object.fromEntries(Object.entries(values.value).filter(([k]) => schema.value.some((p) => p.name === k)));
  values.value = { ...defaults(schema.value), ...kept };
  issues.value = new Map();
});

watch(accountId, async (id) => {
  symbols.value = [];
  symbolsError.value = undefined;
  if (id === undefined) return;
  try {
    symbols.value = await api.accountSymbols(id);
  } catch (e) {
    symbolsError.value = t(errorKey(e));
  }
});

function apply(config: InstanceConfigRow) {
  const found = config.algo.id === null ? undefined : algos.value.find((a) => a.id === config.algo.id);
  algoId.value = found?.id;
  missingAlgo.value = found ? undefined : `${config.algo.name} ${config.algo.version}`;
  symbol.value = config.symbol;
  period.value = config.period;
  values.value = { ...defaults(found?.parameters ?? []), ...config.parameters };
  mode.value = config.attribution.mode;
  orderLabel.value = config.attribution.orderLabel ?? "";
}

onMounted(async () => {
  try {
    const [algoRows, accountRows, detail] = await Promise.all([
      api.algos(),
      api.accounts(),
      source.value ? api.managedInstance(source.value) : Promise.resolve(undefined),
    ]);
    algos.value = algoRows;
    accounts.value = accountRows;
    if (detail) {
      const wanted = Number(route.query["version"]);
      apply(detail.history.find((h) => h.version === wanted) ?? detail.config);
      accountId.value = detail.account.id;
      if (editing.value) name.value = detail.name;
      if (editing.value && wanted && wanted !== detail.config.version) {
        comment.value = t("instanceForm.restoreComment", { version: wanted });
      }
    } else {
      accountId.value = accountRows[0]?.id;
      algoId.value = algoRows[0]?.id;
      values.value = defaults(algoRows[0]?.parameters ?? []);
      period.value = periods.value.find((p) => p.toLowerCase() === "m5") ?? "";
    }
  } catch (e) {
    error.value = t(errorKey(e));
  } finally {
    loading.value = false;
  }
});

async function save() {
  if (algoId.value === undefined || accountId.value === undefined) return;
  busy.value = true;
  error.value = undefined;
  issues.value = new Map();
  const config: ConfigInput = {
    algoId: algoId.value,
    symbol: symbol.value.trim(),
    period: period.value.trim(),
    parameters: Object.fromEntries(Object.entries(values.value).filter(([k]) => !dropped.value.includes(k))),
    attribution: { mode: mode.value, ...(usesLabel.value && orderLabel.value ? { orderLabel: orderLabel.value } : {}) },
    ...(comment.value.trim() ? { comment: comment.value.trim() } : {}),
  };
  try {
    const saved = editing.value
      ? await api.saveInstanceConfig(editing.value, config)
      : await api.createManagedInstance({ name: name.value, accountId: accountId.value, config });
    await router.push({
      name: "instance-config",
      params: { ref: saved.name },
      query: { saved: String(saved.config.version) },
    });
  } catch (e) {
    if (e instanceof ApiError && e.details.issues) {
      issues.value = new Map(e.details.issues.map((i) => [i.parameter, i.code]));
    }
    const unknown = e instanceof ApiError ? (e.details.unknown ?? []) : [];
    error.value = unknown.length ? t("instanceForm.unknownParameters", { names: unknown.join(", ") }) : t(errorKey(e));
  } finally {
    busy.value = false;
  }
}

const cancelTarget = computed(() =>
  editing.value ? { name: "instance-config", params: { ref: editing.value } } : { name: "overview" },
);
const algoLabel = (a: AlgoRow) =>
  a.buildTime ? `${a.version} · ${formatDateTime(locale.value, a.buildTime, "date")}` : a.version;
</script>

<template>
  <div class="page">
    <RouterLink :to="cancelTarget" class="back">{{
      editing ? $t("instanceForm.backToConfig") : $t("instance.back")
    }}</RouterLink>
    <h1>{{ editing ? $t("instanceForm.editTitle", { name: editing }) : $t("instanceForm.newTitle") }}</h1>
    <p v-if="loading" class="muted">{{ $t("overview.loading") }}</p>

    <form v-else class="form" novalidate @submit.prevent="save">
      <p v-if="!algos.length" class="tone-warning" role="alert">
        {{ $t("instanceForm.noAlgos") }} <RouterLink to="/algos">{{ $t("nav.algos") }}</RouterLink>
      </p>
      <p v-if="missingAlgo" class="tone-warning" role="alert">
        {{ $t("instanceForm.algoMissing", { algo: missingAlgo }) }}
      </p>

      <section class="panel card" aria-labelledby="basics-title">
        <h2 id="basics-title">{{ $t("instanceForm.basics") }}</h2>
        <div class="grid">
          <label class="field">
            {{ $t("instanceForm.name") }}
            <input
              v-model.trim="name"
              class="input mono"
              required
              maxlength="63"
              pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?"
              autocomplete="off"
              :disabled="editing !== undefined"
            />
            <span class="field__hint">{{ $t("instanceForm.nameHint") }}</span>
          </label>
          <label class="field">
            {{ $t("instanceForm.account") }}
            <select v-model="accountId" class="input" required :disabled="editing !== undefined">
              <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.displayName }} · {{ a.number }}</option>
            </select>
            <span class="field__hint">{{ editing ? $t("instanceForm.fixedHint") : "" }}</span>
          </label>
          <label class="field">
            {{ $t("instanceForm.algo") }}
            <select v-model="algoId" class="input" required>
              <optgroup v-for="[algoName, versions] in algoGroups" :key="algoName" :label="algoName">
                <option v-for="a in versions" :key="a.id" :value="a.id">{{ algoName }} {{ algoLabel(a) }}</option>
              </optgroup>
            </select>
            <span v-if="algo?.fullAccess" class="field__hint tone-warning">{{ $t("instanceForm.fullAccess") }}</span>
          </label>
          <label class="field">
            {{ $t("instanceForm.symbol") }}
            <input v-model.trim="symbol" class="input mono" list="symbols-list" required autocomplete="off" />
            <span class="field__hint" :class="{ 'tone-negative': symbolsError }">
              {{
                symbolsError
                  ? $t("instanceForm.symbolsFailed", { reason: symbolsError })
                  : $t("instanceForm.symbolsHint", { count: symbols.length })
              }}
            </span>
          </label>
          <label class="field">
            {{ $t("instanceForm.period") }}
            <input v-model.trim="period" class="input mono" list="periods-list" required autocomplete="off" />
          </label>
        </div>
        <datalist id="symbols-list">
          <option v-for="s in symbols" :key="s" :value="s" />
        </datalist>
        <datalist id="periods-list">
          <option v-for="p in periods" :key="p" :value="p" />
        </datalist>
      </section>

      <section class="panel card" aria-labelledby="params-title">
        <h2 id="params-title">{{ $t("instanceForm.parameters") }}</h2>
        <p class="muted card__hint">{{ $t("instanceForm.parametersHint") }}</p>
        <p v-if="!schema.length" class="muted">{{ $t("instanceForm.noParameters") }}</p>
        <p v-if="dropped.length" class="tone-warning">
          {{ $t("instanceForm.dropped", { names: dropped.join(", ") }) }}
        </p>
        <fieldset v-for="[group, params] in groups" :key="group" class="group">
          <legend>{{ group || $t("instanceForm.general") }}</legend>
          <div class="grid">
            <ParameterField
              v-for="p in params"
              :key="p.name"
              v-model="values[p.name]"
              :param="p"
              :issue="issues.get(p.name)"
              symbols-list="symbols-list"
              periods-list="periods-list"
            />
          </div>
        </fieldset>
      </section>

      <section class="panel card" aria-labelledby="attribution-title">
        <h2 id="attribution-title">{{ $t("instanceForm.attribution") }}</h2>
        <div class="grid">
          <label class="field">
            {{ $t("instanceForm.attributionMode") }}
            <select v-model="mode" class="input">
              <option v-for="m in MODES" :key="m" :value="m">{{ $t(`instanceForm.modes.${m}`) }}</option>
            </select>
            <span class="field__hint">{{ $t(`instanceForm.modeHints.${mode}`) }}</span>
          </label>
          <label v-if="usesLabel" class="field">
            {{ mode === "label" ? $t("instanceForm.orderLabel") : $t("instanceForm.orderPattern") }}
            <input
              v-model="orderLabel"
              class="input mono"
              :required="mode === 'label-pattern'"
              :placeholder="mode === 'label' ? name : ''"
              autocomplete="off"
            />
          </label>
        </div>
      </section>

      <section class="panel card" aria-labelledby="save-title">
        <h2 id="save-title" class="visually-hidden">{{ $t("action.save") }}</h2>
        <label class="field">
          {{ $t("instanceForm.comment") }}
          <input v-model="comment" class="input" maxlength="500" autocomplete="off" />
          <span class="field__hint">{{ $t("instanceForm.commentHint") }}</span>
        </label>
        <p v-if="error" class="tone-negative" role="alert">{{ error }}</p>
        <div class="actions">
          <button type="submit" class="btn btn--primary" :disabled="busy || algoId === undefined">
            {{ $t("action.save") }}
          </button>
          <RouterLink :to="cancelTarget" class="btn btn--ghost">{{ $t("action.cancel") }}</RouterLink>
          <span class="muted field__hint">{{ $t("instanceForm.noRestart") }}</span>
        </div>
      </section>
    </form>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-5);
  min-width: 0;
  padding: var(--ww-space-8) var(--ww-space-10);
}

h1,
p {
  margin: 0;
}

.back {
  font-size: var(--ww-size-sm);
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

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--ww-space-4);
}

.group {
  min-width: 0;
  margin: 0;
  padding: var(--ww-space-4) 0 0;
  border: 0;
  border-top: 1px solid var(--ww-border);
}

.group legend {
  padding-right: var(--ww-space-2);
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
  font-weight: 600;
  text-transform: uppercase;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  align-items: center;
}

@media (max-width: 640px) {
  .page {
    padding: var(--ww-space-4);
  }
}
</style>
