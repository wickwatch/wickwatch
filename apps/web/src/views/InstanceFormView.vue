<script setup lang="ts">
import type {
  Account,
  Algo,
  AttributionMode,
  InstanceConfig,
  InstanceConfigInput,
  ParameterIssueCode,
  ParameterSchema,
  ParameterTemplate,
} from "@wickwatch/core";
import { groupBy } from "@wickwatch/core/group-by";
// Plain functions and constants without the schema library, unlike the core's main entry.
import { applyTemplate, parameterDefaults, validateParameters } from "@wickwatch/core/parameters";
import { ATTRIBUTION_MODES } from "@wickwatch/core/rules";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError, errorKey } from "../api";
import FieldError from "../components/FieldError.vue";
import FileDrop from "../components/FileDrop.vue";
import ParameterList from "../components/ParameterList.vue";
import { accountLabel, formatDateTime } from "../format";
import { parameterTitle } from "../parameter-label";
import { system } from "../system";
import { checks, normalizers, useValidation, vNormalize } from "../validation";
import AppSpinner from "../components/AppSpinner.vue";

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

/** Set when editing; new instances (also duplicates) have no name yet. */
const editing = computed(() => (route.name === "instance-edit" ? String(route.params["ref"]) : undefined));
const source = computed(
  () => editing.value ?? (typeof route.query["from"] === "string" ? route.query["from"] : undefined),
);

const algos = ref<Algo[]>([]);
const accounts = ref<Account[]>([]);
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
const algoGroups = computed(() => [...groupBy(algos.value, (a) => a.name)]);
const usesLabel = computed(() => mode.value === "label" || mode.value === "label-pattern");

const form = useValidation();
const nameField = form.field(() => name.value, checks.required, checks.instanceName);
const accountField = form.field(() => accountId.value, checks.required);
const algoField = form.field(() => algoId.value, checks.required);
const symbolField = form.field(
  () => symbol.value,
  checks.required,
  checks.oneOf(() => symbols.value, "validation.unknownSymbol"),
);
const periodField = form.field(
  () => period.value,
  checks.required,
  checks.oneOf(() => periods.value, "validation.unknownPeriod"),
);
const labelField = form.field(
  () => orderLabel.value,
  () => (mode.value === "label-pattern" ? checks.required(orderLabel.value) : undefined),
  () => (mode.value === "label-pattern" ? checks.regex(orderLabel.value) : undefined),
);
const sent = ref(false);
/** The runtime has no empty text value (cTrader CLI): empty text parameters are required then. */
const validateOptions = computed(() => ({ requireText: system.value?.capabilities?.requiresTextValues === true }));
/** Problems the server reported, else the same checks locally; empty values only once the form was sent. */
const shownIssues = computed(() => {
  const result = new Map<string, ParameterIssueCode | "required">(issues.value);
  for (const { parameter, code } of validateParameters(values.value, schema.value, validateOptions.value).errors) {
    const value = values.value[parameter];
    if (result.has(parameter)) continue;
    if (value === "" || value === undefined) {
      if (sent.value) result.set(parameter, "required");
    } else result.set(parameter, code);
  }
  return result;
});
/** Required values still empty, for the "only missing" filter; known from the start, not only once sent. */
const missing = computed(
  () =>
    new Set(
      validateParameters(values.value, schema.value, validateOptions.value)
        .errors.filter((i) => i.code === "required")
        .map((i) => i.parameter),
    ),
);
const formats = computed(() => system.value?.parameterFormats ?? []);
/** The file extensions, e.g. ".cbotset". */
const extensions = computed(() => formats.value.map((f) => `.${f}`));
type Tone = "positive" | "negative" | "warning" | "muted";
interface FileLine {
  tone: Tone;
  text: string;
}
const fileNotice = ref<FileLine[]>();
const LISTED = 8;
/** The short name, without a description written into the label. */
const label = (n: string) => parameterTitle(schema.value, n);
function names(list: string[]): string {
  const shown = list.slice(0, LISTED).map(label).join(", ");
  return list.length > LISTED ? t("instanceForm.andMore", { names: shown, count: list.length - LISTED }) : shown;
}

/** Takes the values of a parameter file (e.g. .cbotset) into the form; nothing is saved yet. */
async function loadFile(file: File) {
  if (algoId.value === undefined) return;
  fileNotice.value = undefined;
  try {
    const parsed = await api.parseParameterFile(algoId.value, file);
    values.value = { ...values.value, ...parsed.values };
    if (parsed.symbol) symbol.value = canonical(parsed.symbol, symbols.value);
    if (parsed.period) period.value = canonical(parsed.period, periods.value);
    const empty = validateParameters(values.value, schema.value, validateOptions.value)
      .errors.filter((i) => i.code === "required")
      .map((i) => label(i.parameter));
    // Rejected values are listed in full with the reason: they are the ones to fix by hand.
    const rejected = parsed.issues.map((i) => `${label(i.parameter)} (${t(`parameterIssue.${i.code}`)})`).join(", ");
    const lines: (FileLine | false)[] = [
      {
        tone: "positive",
        text: t("instanceForm.fileLoaded", { count: Object.keys(parsed.values).length, file: file.name }),
      },
      rejected !== "" && { tone: "warning", text: t("instanceForm.fileRejected", { names: rejected }) },
      parsed.unknown.length > 0 && {
        tone: "warning",
        text: t("instanceForm.fileUnknown", { names: names(parsed.unknown) }),
      },
      parsed.missing.length > 0 && {
        tone: "muted",
        text: t("instanceForm.fileMissing", { names: names(parsed.missing) }),
      },
      // In full, like rejected values: each one needs a value before the bot can start.
      empty.length > 0 && { tone: "warning", text: t("instanceForm.fileEmpty", { names: empty.join(", ") }) },
    ];
    fileNotice.value = lines.filter((line): line is FileLine => line !== false);
  } catch (e) {
    fileNotice.value = [{ tone: "negative", text: t(errorKey(e)) }];
  }
}

/** The parameter templates of the chosen algo; one loaded into the form is named when saving. */
const templates = ref<ParameterTemplate[]>([]);
const templateId = ref<number>();
watch(
  () => algo.value?.name,
  async (algoName) => {
    // Another algo (not only another version of it): a loaded template no longer applies.
    templates.value = [];
    templateId.value = undefined;
    if (algoName === undefined) return;
    try {
      templates.value = await api.parameterTemplates(algoName);
    } catch (e) {
      fileNotice.value = [{ tone: "negative", text: t(errorKey(e)) }];
    }
  },
  { immediate: true },
);

/** Takes a template's values into the form as a file would; only what fits this algo version, the rest is listed. */
function loadTemplate(id: number) {
  const tpl = templates.value.find((x) => x.id === id);
  if (!tpl) return;
  const result = applyTemplate(values.value, tpl.parameters, schema.value, validateOptions.value);
  values.value = result.values;
  templateId.value = tpl.id;
  if (!comment.value.trim()) comment.value = t("templates.appliedComment", { name: tpl.name });
  const rejected = result.rejected.map((i) => `${label(i.parameter)} (${t(`parameterIssue.${i.code}`)})`).join(", ");
  const lines: (FileLine | false)[] = [
    { tone: "positive", text: t("templates.loaded", { name: tpl.name }, result.changed.length) },
    rejected !== "" && { tone: "warning", text: t("templates.rejected", { names: rejected }) },
    result.unknown.length > 0 && { tone: "warning", text: t("templates.unknown", { names: names(result.unknown) }) },
    result.kept.length > 0 && { tone: "muted", text: t("templates.kept", { names: names(result.kept) }) },
  ];
  fileNotice.value = lines.filter((line): line is FileLine => line !== false);
}

/** The broker's spelling, e.g. `US100.cash` for `us100.CASH`. */
const canonical = (value: string, options: string[]) =>
  options.find((o) => o === value) ?? options.find((o) => o.toLowerCase() === value.toLowerCase()) ?? value;

/** Keeps the values the new algo version still knows; new parameters start with their default. */
watch(algoId, () => {
  if (loading.value) return;
  const kept = Object.fromEntries(Object.entries(values.value).filter(([k]) => schema.value.some((p) => p.name === k)));
  values.value = { ...parameterDefaults(schema.value), ...kept };
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

/** A saved configuration's algo (undefined if that version no longer exists) and its complete values. */
function fromConfig(config: InstanceConfig) {
  const found = config.algo.id === null ? undefined : algos.value.find((a) => a.id === config.algo.id);
  return { found, values: { ...parameterDefaults(found?.parameters ?? []), ...config.parameters } };
}

function apply(config: InstanceConfig) {
  const { found, values: configValues } = fromConfig(config);
  algoId.value = found?.id;
  missingAlgo.value = found ? undefined : `${config.algo.name} ${config.algo.version}`;
  symbol.value = config.symbol;
  period.value = config.period;
  values.value = configValues;
  mode.value = config.attribution.mode;
  orderLabel.value = config.attribution.orderLabel ?? "";
}

interface Snapshot {
  fields: unknown[];
  values: Record<string, unknown>;
}
const snapshot = (): Snapshot => ({
  fields: [algoId.value, symbol.value, period.value, mode.value, orderLabel.value],
  values: { ...values.value },
});
function snapshotOf(config: InstanceConfig): Snapshot {
  const { found, values } = fromConfig(config);
  return {
    fields: [found?.id, config.symbol, config.period, config.attribution.mode, config.attribution.orderLabel ?? ""],
    values,
  };
}
/** The configuration that was edited or duplicated, to count what the user changed since. */
const initial = ref<Snapshot>();
const changeCount = computed(() => {
  const start = initial.value;
  if (!start) return undefined;
  const now = snapshot();
  const fields = start.fields.filter((f, i) => f !== now.fields[i]).length;
  const keys = new Set([...Object.keys(start.values), ...Object.keys(now.values)]);
  return fields + [...keys].filter((k) => start.values[k] !== now.values[k]).length;
});

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
      // Changes count against the saved configuration; a restored older version shows its differences.
      initial.value = snapshotOf(detail.config);
    } else {
      accountId.value = accountRows[0]?.id;
      algoId.value = algoRows[0]?.id;
      values.value = parameterDefaults(algoRows[0]?.parameters ?? []);
      const preset = system.value?.defaultPeriod?.toLowerCase();
      period.value = periods.value.find((p) => p.toLowerCase() === preset) ?? "";
    }
  } catch (e) {
    error.value = t(errorKey(e));
  } finally {
    loading.value = false;
  }
});

async function save() {
  sent.value = true;
  const fieldsOk = form.validate();
  if (!fieldsOk || shownIssues.value.size) {
    // After the render, when the group with the problem has opened.
    await nextTick();
    if (fieldsOk) document.querySelector<HTMLElement>(`#param-${String([...shownIssues.value.keys()][0])}`)?.focus();
    return;
  }
  if (algoId.value === undefined || accountId.value === undefined) return;
  symbol.value = canonical(symbol.value.trim(), symbols.value);
  period.value = canonical(period.value.trim(), periods.value);
  busy.value = true;
  error.value = undefined;
  issues.value = new Map();
  const config: InstanceConfigInput = {
    algoId: algoId.value,
    symbol: symbol.value.trim(),
    period: period.value.trim(),
    parameters: Object.fromEntries(Object.entries(values.value).filter(([k]) => !dropped.value.includes(k))),
    attribution: { mode: mode.value, ...(usesLabel.value && orderLabel.value ? { orderLabel: orderLabel.value } : {}) },
    ...(comment.value.trim() ? { comment: comment.value.trim() } : {}),
    ...(templateId.value !== undefined ? { template: templateId.value } : {}),
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
    const onField = form.fromServer(e, {
      name: nameField,
      "config/symbol": symbolField,
      "config/period": periodField,
      "config/attribution/orderLabel": labelField,
    });
    if (e instanceof ApiError && e.details.issues) {
      issues.value = new Map(e.details.issues.map((i) => [i.parameter, i.code]));
    }
    const unknown = e instanceof ApiError ? (e.details.unknown ?? []) : [];
    error.value = unknown.length
      ? t("instanceForm.unknownParameters", { names: unknown.join(", ") })
      : onField
        ? undefined
        : t(errorKey(e));
  } finally {
    busy.value = false;
  }
}

const cancelTarget = computed(() =>
  editing.value ? { name: "instance-config", params: { ref: editing.value } } : { name: "overview" },
);
const algoLabel = (a: Algo) =>
  a.buildTime ? `${a.version} · ${formatDateTime(locale.value, a.buildTime, "day")}` : a.version;
</script>

<template>
  <div class="page">
    <RouterLink :to="cancelTarget" class="back">{{
      editing ? $t("instanceForm.backToConfig") : $t("instance.back")
    }}</RouterLink>
    <h1>{{ editing ? $t("instanceForm.editTitle", { name: editing }) : $t("instanceForm.newTitle") }}</h1>
    <AppSpinner v-if="loading" />

    <form v-else class="form" novalidate @submit.prevent="save">
      <p v-if="!algos.length" class="tone-warning" role="alert">
        {{ $t("instanceForm.noAlgos") }} <RouterLink to="/algos">{{ $t("nav.algos") }}</RouterLink>
      </p>
      <p v-if="missingAlgo" class="tone-warning" role="alert">
        {{ $t("instanceForm.algoMissing", { algo: missingAlgo }) }}
      </p>

      <section class="panel card" aria-labelledby="basics-title">
        <h2 id="basics-title">{{ $t("instanceForm.basics") }}</h2>
        <div class="basics">
          <fieldset class="basics__group">
            <legend>{{ $t("instanceForm.instanceGroup") }}</legend>
            <div class="basics__fields">
              <label class="field">
                {{ $t("instanceForm.name") }}
                <input
                  v-model.trim="name"
                  v-normalize="normalizers.slug"
                  v-bind="nameField.attrs.value"
                  class="input mono"
                  required
                  maxlength="63"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  :disabled="editing !== undefined"
                />
                <FieldError :field="nameField" />
                <span v-if="!editing" class="field__hint hint--focus">{{ $t("instanceForm.nameHint") }}</span>
              </label>
              <label class="field">
                {{ $t("instanceForm.account") }}
                <select
                  v-model="accountId"
                  v-bind="accountField.attrs.value"
                  class="input"
                  required
                  :disabled="editing !== undefined"
                >
                  <option v-for="a in accounts" :key="a.id" :value="a.id">{{ accountLabel(a) }}</option>
                </select>
                <FieldError :field="accountField" />
              </label>
            </div>
            <p v-if="editing" class="field__hint">{{ $t("instanceForm.fixedHint") }}</p>
          </fieldset>
          <fieldset class="basics__group">
            <legend>{{ $t("instanceForm.tradingGroup") }}</legend>
            <div class="basics__fields">
              <label class="field">
                {{ $t("instanceForm.algo") }}
                <select v-model="algoId" v-bind="algoField.attrs.value" class="input" required>
                  <optgroup v-for="[algoName, versions] in algoGroups" :key="algoName" :label="algoName">
                    <option v-for="a in versions" :key="a.id" :value="a.id">{{ algoName }} {{ algoLabel(a) }}</option>
                  </optgroup>
                </select>
                <FieldError :field="algoField" />
                <span v-if="algo?.fullAccess" class="field__hint tone-warning">{{
                  $t("instanceForm.fullAccess")
                }}</span>
              </label>
              <label class="field">
                {{ $t("instanceForm.symbol") }}
                <input
                  v-model.trim="symbol"
                  v-normalize="normalizers.noSpaces"
                  v-bind="symbolField.attrs.value"
                  class="input mono"
                  list="symbols-list"
                  required
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                />
                <FieldError :field="symbolField" />
                <span v-if="symbolsError" class="field__hint tone-negative">
                  {{ $t("instanceForm.symbolsFailed", { reason: symbolsError }) }}
                </span>
                <span v-else class="field__hint hint--focus">
                  {{ $t("instanceForm.symbolsHint", { count: symbols.length }) }}
                </span>
              </label>
              <label class="field">
                {{ $t("instanceForm.period") }}
                <input
                  v-model.trim="period"
                  v-normalize="normalizers.noSpaces"
                  v-bind="periodField.attrs.value"
                  class="input mono"
                  list="periods-list"
                  required
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                />
                <FieldError :field="periodField" />
              </label>
            </div>
          </fieldset>
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
        <div v-if="(formats.length || templates.length) && algoId !== undefined" class="file-load">
          <label v-if="templates.length" class="field template-load">
            {{ $t("templates.loadTitle") }}
            <select
              class="input"
              :value="templateId ?? ''"
              @change="loadTemplate(Number(($event.target as HTMLSelectElement).value))"
            >
              <option value="" disabled>{{ $t("templates.loadPlaceholder") }}</option>
              <option v-for="tpl in templates" :key="tpl.id" :value="tpl.id">{{ tpl.name }}</option>
            </select>
          </label>
          <FileDrop
            v-if="formats.length"
            :accept="extensions.join(',')"
            :title="$t('parameters.fileTitle')"
            :hint="$t('parameters.fileHint', { formats: extensions.join(', ') })"
            @file="loadFile"
          />
          <div v-if="fileNotice" role="status">
            <p v-for="line in fileNotice" :key="line.text" class="file-load__line" :class="`tone-${line.tone}`">
              {{ line.text }}
            </p>
          </div>
        </div>
        <p v-if="!schema.length" class="muted">{{ $t("instanceForm.noParameters") }}</p>
        <p v-if="dropped.length" class="tone-warning">
          {{ $t("instanceForm.dropped", { names: dropped.join(", ") }) }}
        </p>
        <ParameterList
          v-if="schema.length"
          v-model:values="values"
          mode="edit"
          :schema="schema"
          :issues="shownIssues"
          :missing="missing"
          symbols-list="symbols-list"
          periods-list="periods-list"
        />
      </section>

      <section class="panel card" aria-labelledby="attribution-title">
        <h2 id="attribution-title">{{ $t("instanceForm.attribution") }}</h2>
        <p class="muted card__hint">{{ $t("instanceForm.attributionHint") }}</p>
        <!-- All modes with their meaning at once: choosing needs the comparison. -->
        <fieldset class="modes">
          <legend class="visually-hidden">{{ $t("instanceForm.attributionMode") }}</legend>
          <label v-for="m in ATTRIBUTION_MODES" :key="m" class="mode" :class="{ 'mode--chosen': mode === m }">
            <input v-model="mode" type="radio" name="attribution-mode" :value="m" class="mode__radio" />
            <span class="mode__text">
              <span class="mode__name">{{ $t(`instanceForm.modes.${m}`) }}</span>
              <span class="muted mode__hint">{{ $t(`instanceForm.modeHints.${m}`) }}</span>
            </span>
          </label>
        </fieldset>
        <label v-if="usesLabel" class="field mode__label">
          {{ mode === "label" ? $t("instanceForm.orderLabel") : $t("instanceForm.orderPattern") }}
          <input
            v-model="orderLabel"
            v-bind="labelField.attrs.value"
            class="input mono"
            maxlength="200"
            :required="mode === 'label-pattern'"
            :placeholder="mode === 'label' ? name : ''"
            autocomplete="off"
            spellcheck="false"
          />
          <FieldError :field="labelField" />
        </label>
      </section>

      <section class="panel card" aria-labelledby="comment-title">
        <h2 id="comment-title">{{ $t("instanceForm.commentTitle") }}</h2>
        <label class="field">
          <span class="visually-hidden">{{ $t("instanceForm.comment") }}</span>
          <input
            v-model="comment"
            class="input"
            maxlength="500"
            autocomplete="off"
            :placeholder="$t('instanceForm.commentPlaceholder')"
          />
          <span class="field__hint">{{ $t("instanceForm.commentHint") }} {{ $t("instanceForm.noRestart") }}</span>
        </label>
      </section>

      <p v-if="error" class="tone-negative" role="alert">{{ error }}</p>
      <!-- Stays in view at the bottom: the parameter list can be very long. -->
      <div class="panel savebar">
        <button type="submit" class="btn btn--primary" :disabled="busy || algoId === undefined">
          {{ $t("action.save") }}
        </button>
        <RouterLink :to="cancelTarget" class="btn btn--ghost">{{ $t("action.cancel") }}</RouterLink>
        <span
          v-if="changeCount !== undefined"
          class="savebar__count"
          :class="changeCount ? 'tone-warning' : 'muted'"
          role="status"
        >
          {{ $t("instanceForm.changes", changeCount) }}
        </span>
      </div>
    </form>
  </div>
</template>

<style scoped>
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

.modes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ww-space-3);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.mode {
  display: flex;
  gap: var(--ww-space-3);
  align-items: flex-start;
  padding: var(--ww-space-3) var(--ww-space-4);
  border: 1px solid var(--ww-border);
  border-radius: var(--ww-radius-md);
  cursor: pointer;
}

/* Chosen: frame and bold name, not colour alone. */
.mode--chosen {
  border-color: var(--ww-accent);
  box-shadow: inset 0 0 0 1px var(--ww-accent);
}

.mode--chosen .mode__name {
  font-weight: 700;
}

.mode__radio {
  margin-top: 3px;
  accent-color: var(--ww-accent);
}

.mode__text {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-1);
  min-width: 0;
}

.mode__name {
  font-size: var(--ww-size-sm);
  font-weight: 500;
}

.mode__hint {
  font-size: var(--ww-size-xs);
}

.mode__label {
  max-width: 480px;
}

.basics {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  gap: var(--ww-space-6);
}

.basics__group {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-3);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.basics__group legend {
  margin-bottom: var(--ww-space-3);
  padding: 0;
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
  font-weight: 600;
  text-transform: uppercase;
}

.basics__fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--ww-space-4);
}

/* Long hints only while the field is being filled in; errors always show. */
.field:not(:focus-within) > .hint--focus {
  display: none;
}

.savebar {
  position: sticky;
  bottom: var(--ww-space-4);
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  align-items: center;
  padding: var(--ww-space-3) var(--ww-space-5);
  border-color: var(--ww-border-strong);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--ww-bg) 70%, transparent);
}

.savebar__count {
  font-size: var(--ww-size-sm);
  font-weight: 600;
}

@media (max-width: 900px) {
  .basics,
  .modes {
    grid-template-columns: minmax(0, 1fr);
  }
}

.file-load {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
}

.template-load {
  max-width: 480px;
}

.file-load__line {
  margin: 0;
  font-size: var(--ww-size-sm);
}
</style>
