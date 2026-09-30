<script setup lang="ts">
import type { ChallengeProfile, ChallengeRules, ChallengeTemplate, DailyLossReference } from "@wickwatch/core";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, ApiError, errorKey } from "../api";
import { isAdmin } from "../session";
import { checks, useValidation } from "../validation";
import ConfirmDialog from "./ConfirmDialog.vue";
import FieldError from "./FieldError.vue";

/** Challenge profile of an account, shown in a modal on the account page. `dirty`: inputs differ from what was loaded. */
const props = defineProps<{ number: string }>();
const emit = defineEmits<{ saved: []; deleted: []; cancel: []; dirty: [dirty: boolean] }>();
const { locale } = useI18n();
const number = computed(() => props.number);

const REFERENCES: DailyLossReference[] = [
  "balance-or-equity-at-day-start",
  "balance-at-day-start",
  "equity-at-day-start",
];
const TIME_ZONES = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];

const templates = ref<ChallengeTemplate[]>([]);
const exists = ref(false);
const loading = ref(true);
const busy = ref(false);
const error = ref<string>();
const confirmDelete = ref(false);

/** Flat form state; empty numbers mean "rule not used". */
const form = reactive({
  templateId: "",
  name: "",
  phase: "",
  startDate: new Date().toISOString().slice(0, 10),
  startBalance: undefined as number | undefined,
  profitTargetPct: undefined as number | undefined,
  dailyLossPct: undefined as number | undefined,
  dailyReference: "balance-or-equity-at-day-start" as DailyLossReference,
  resetTime: "00:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  limitBasis: "initial-balance" as "initial-balance" | "day-start",
  maxLossPct: undefined as number | undefined,
  maxLossType: "static" as NonNullable<ChallengeRules["maxLoss"]>["type"],
  minTradingDays: undefined as number | undefined,
  durationDays: undefined as number | undefined,
  guardOn: false,
  guardPct: 80 as number | undefined,
});
const hasLossLimit = computed(() => isSet(form.dailyLossPct) || isSet(form.maxLossPct));

function applyRules(rules: ChallengeRules) {
  form.profitTargetPct = rules.profitTargetPct || undefined;
  form.dailyLossPct = rules.dailyLoss?.limitPct;
  if (rules.dailyLoss) {
    form.dailyReference = rules.dailyLoss.reference;
    form.resetTime = rules.dailyLoss.resetTime;
    form.timezone = rules.dailyLoss.timezone;
    form.limitBasis = rules.dailyLoss.limitBasis ?? "initial-balance";
  }
  form.maxLossPct = rules.maxLoss?.limitPct;
  form.maxLossType = rules.maxLoss?.type ?? "static";
  form.minTradingDays = rules.minTradingDays || undefined;
  form.durationDays = rules.durationDays ?? undefined;
}

function applyTemplate() {
  const template = templates.value.find((t) => t.id === form.templateId);
  if (!template) return;
  applyRules(template);
  form.name = templateName(template);
  form.phase = template.phase;
}

const selectedTemplate = computed(() => templates.value.find((t) => t.id === form.templateId));
const templateName = (t: ChallengeTemplate) => t.name[locale.value] ?? t.name["en"] ?? t.id;
/** Templates by firm; names sorted with numbers compared by value ("$2.5k" before "$100k"). */
const templateGroups = computed(() => {
  const groups = new Map<string, ChallengeTemplate[]>();
  for (const t of templates.value) groups.set(t.firm, [...(groups.get(t.firm) ?? []), t]);
  const byName = (a: ChallengeTemplate, b: ChallengeTemplate) =>
    templateName(a).localeCompare(templateName(b), locale.value, { numeric: true });
  return [...groups].map(([firm, list]) => ({ firm, templates: list.sort(byName) }));
});
const isSet = (n: number | undefined): n is number => typeof n === "number" && !Number.isNaN(n);

function toProfile(): ChallengeProfile {
  const rules: ChallengeRules = {
    ...(isSet(form.profitTargetPct) && form.profitTargetPct > 0 ? { profitTargetPct: form.profitTargetPct } : {}),
    ...(isSet(form.dailyLossPct)
      ? {
          dailyLoss: {
            limitPct: form.dailyLossPct,
            reference: form.dailyReference,
            resetTime: form.resetTime,
            timezone: form.timezone,
            limitBasis: form.limitBasis,
          },
        }
      : {}),
    ...(isSet(form.maxLossPct) ? { maxLoss: { limitPct: form.maxLossPct, type: form.maxLossType } } : {}),
    ...(isSet(form.minTradingDays) && form.minTradingDays > 0 ? { minTradingDays: form.minTradingDays } : {}),
    ...(isSet(form.durationDays) && form.durationDays > 0 ? { durationDays: form.durationDays } : {}),
  };
  return {
    ...(form.templateId ? { templateId: form.templateId } : {}),
    name: form.name.trim(),
    ...(form.phase.trim() ? { phase: form.phase.trim() } : {}),
    startDate: form.startDate,
    startBalance: form.startBalance ?? 0,
    rules,
    ...(form.guardOn && hasLossLimit.value && isSet(form.guardPct) ? { guard: { usagePct: form.guardPct } } : {}),
  };
}

onMounted(async () => {
  try {
    templates.value = await api.challengeTemplates();
    const profile = await api.challenge(number.value);
    exists.value = true;
    form.templateId = profile.templateId ?? "";
    form.name = profile.name;
    form.phase = profile.phase ?? "";
    form.startDate = profile.startDate;
    form.startBalance = profile.startBalance;
    applyRules(profile.rules);
    form.guardOn = profile.guard !== undefined;
    form.guardPct = profile.guard?.usagePct ?? 80;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) error.value = errorKey(e);
  } finally {
    loading.value = false;
    initial.value = JSON.stringify(form);
  }
});

/** The form as loaded, to know whether closing would lose input. */
const initial = ref<string>();
const dirty = computed(() => initial.value !== undefined && JSON.stringify(form) !== initial.value);
watch(dirty, (d) => emit("dirty", d));

async function run(action: () => Promise<void>) {
  busy.value = true;
  error.value = undefined;
  try {
    await action();
  } catch (e) {
    error.value = errorKey(e);
  } finally {
    busy.value = false;
  }
}

const v = useValidation();
const whenDaily = (check: (value: unknown) => ReturnType<typeof checks.required>) => (value: unknown) =>
  isSet(form.dailyLossPct) ? check(value) : undefined;
const fields = {
  name: v.field(() => form.name, checks.required),
  startDate: v.field(() => form.startDate, checks.required),
  startBalance: v.field(() => form.startBalance, checks.required, checks.number({ min: 0.01 })),
  profitTarget: v.field(() => form.profitTargetPct, checks.number({ min: 0 })),
  dailyLoss: v.field(() => form.dailyLossPct, checks.number({ min: 0.1, max: 100 })),
  resetTime: v.field(() => form.resetTime, whenDaily(checks.required)),
  timezone: v.field(() => form.timezone, whenDaily(checks.required), whenDaily(checks.timeZone)),
  maxLoss: v.field(() => form.maxLossPct, checks.number({ min: 0.1, max: 100 })),
  tradingDays: v.field(() => form.minTradingDays, checks.number({ min: 0, integer: true })),
  duration: v.field(() => form.durationDays, checks.number({ min: 1, integer: true })),
  guardPct: v.field(
    () => form.guardPct,
    (value) => (form.guardOn ? checks.required(value) : undefined),
    (value) => (form.guardOn ? checks.number({ min: 10, max: 100, integer: true })(value) : undefined),
  ),
};

const save = () =>
  run(async () => {
    if (!v.validate()) return;
    await api.saveChallenge(number.value, toProfile());
    emit("saved");
  });

const remove = () =>
  run(async () => {
    confirmDelete.value = false;
    await api.deleteChallenge(number.value);
    emit("deleted");
  });
</script>

<template>
  <div class="editor">
    <p v-if="!isAdmin" class="tone-warning">{{ $t("error.api.forbidden") }}</p>
    <p v-else-if="loading" class="muted">{{ $t("overview.loading") }}</p>

    <form v-else class="form" novalidate @submit.prevent="save">
      <label v-if="templates.length" class="field">
        {{ $t("challenge.template") }}
        <select v-model="form.templateId" class="input" @change="applyTemplate">
          <option value="">{{ $t("challenge.noTemplate") }}</option>
          <optgroup v-for="group in templateGroups" :key="group.firm" :label="group.firm">
            <option v-for="t in group.templates" :key="t.id" :value="t.id">{{ templateName(t) }}</option>
          </optgroup>
        </select>
        <span v-if="selectedTemplate" class="field__hint">
          {{ $t("challenge.templateSource", { date: selectedTemplate.asOf }) }}
          <a :href="selectedTemplate.source" target="_blank" rel="noopener noreferrer">{{ selectedTemplate.source }}</a>
        </span>
      </label>
      <p v-else class="muted hint">{{ $t("challenge.noTemplatesHint") }}</p>

      <fieldset>
        <legend>{{ $t("challenge.basics") }}</legend>
        <label class="field">
          {{ $t("challenge.name") }}
          <input v-model="form.name" v-bind="fields.name.attrs.value" class="input" required maxlength="100" />
          <FieldError :field="fields.name" />
        </label>
        <label class="field">
          {{ $t("challenge.phase") }}
          <input v-model="form.phase" class="input" maxlength="100" />
        </label>
        <div class="grid">
          <label class="field">
            {{ $t("challenge.startDate") }}
            <input v-model="form.startDate" v-bind="fields.startDate.attrs.value" class="input" type="date" required />
            <FieldError :field="fields.startDate" />
          </label>
          <label class="field">
            {{ $t("challenge.startBalance") }}
            <input
              v-model.number="form.startBalance"
              v-bind="fields.startBalance.attrs.value"
              class="input mono"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
            <FieldError :field="fields.startBalance" />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>{{ $t("challenge.rules") }}</legend>
        <p class="field__hint">{{ $t("challenge.rulesHint") }}</p>
        <div class="grid">
          <label class="field">
            {{ $t("challenge.rule.profitTarget") }} (%)
            <input
              v-model.number="form.profitTargetPct"
              v-bind="fields.profitTarget.attrs.value"
              class="input mono"
              type="number"
              min="0"
              step="0.1"
            />
            <FieldError :field="fields.profitTarget" />
          </label>
          <label class="field">
            {{ $t("challenge.rule.dailyLoss") }} (%)
            <input
              v-model.number="form.dailyLossPct"
              v-bind="fields.dailyLoss.attrs.value"
              class="input mono"
              type="number"
              min="0.1"
              max="100"
              step="0.1"
            />
            <FieldError :field="fields.dailyLoss" />
          </label>
        </div>
        <template v-if="isSet(form.dailyLossPct)">
          <label class="field">
            {{ $t("challenge.reference") }}
            <select v-model="form.dailyReference" class="input">
              <option v-for="r in REFERENCES" :key="r" :value="r">{{ $t(`challenge.references.${r}`) }}</option>
            </select>
          </label>
          <div class="grid">
            <label class="field">
              {{ $t("challenge.resetTime") }}
              <input
                v-model="form.resetTime"
                v-bind="fields.resetTime.attrs.value"
                class="input mono"
                type="time"
                required
              />
              <FieldError :field="fields.resetTime" />
            </label>
            <label class="field">
              {{ $t("challenge.timezone") }}
              <input
                v-model.trim="form.timezone"
                v-bind="fields.timezone.attrs.value"
                class="input mono"
                list="time-zones"
                required
                autocomplete="off"
                spellcheck="false"
              />
              <FieldError :field="fields.timezone" />
              <datalist id="time-zones">
                <option v-for="tz in TIME_ZONES" :key="tz" :value="tz" />
              </datalist>
            </label>
          </div>
          <label class="field">
            {{ $t("challenge.limitBasis") }}
            <select v-model="form.limitBasis" class="input">
              <option value="initial-balance">{{ $t("challenge.basis.initialBalance") }}</option>
              <option value="day-start">{{ $t("challenge.basis.dayStart") }}</option>
            </select>
          </label>
        </template>
        <div class="grid">
          <label class="field">
            {{ $t("challenge.rule.maxLoss") }} (%)
            <input
              v-model.number="form.maxLossPct"
              v-bind="fields.maxLoss.attrs.value"
              class="input mono"
              type="number"
              min="0.1"
              max="100"
              step="0.1"
            />
            <FieldError :field="fields.maxLoss" />
          </label>
          <label v-if="isSet(form.maxLossPct)" class="field">
            {{ $t("challenge.maxLossType") }}
            <select v-model="form.maxLossType" class="input">
              <option value="static">{{ $t("challenge.maxLossTypes.static") }}</option>
              <option value="trailing">{{ $t("challenge.maxLossTypes.trailing") }}</option>
              <option value="trailing-eod-balance">{{ $t("challenge.maxLossTypes.trailingEodBalance") }}</option>
            </select>
          </label>
        </div>
        <div class="grid">
          <label class="field">
            {{ $t("challenge.rule.tradingDays") }}
            <input
              v-model.number="form.minTradingDays"
              v-bind="fields.tradingDays.attrs.value"
              class="input mono"
              type="number"
              min="0"
              step="1"
            />
            <FieldError :field="fields.tradingDays" />
          </label>
          <label class="field">
            {{ $t("challenge.durationDays") }}
            <input
              v-model.number="form.durationDays"
              v-bind="fields.duration.attrs.value"
              class="input mono"
              type="number"
              min="1"
              step="1"
            />
            <FieldError :field="fields.duration" />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>{{ $t("challenge.guard.title") }}</legend>
        <p v-if="!hasLossLimit" class="field__hint">{{ $t("challenge.guard.needsLimit") }}</p>
        <template v-else>
          <label class="check">
            <input v-model="form.guardOn" type="checkbox" />
            {{ $t("challenge.guard.enable") }}
          </label>
          <label v-if="form.guardOn" class="field">
            {{ $t("challenge.guard.usage") }}
            <input
              v-model.number="form.guardPct"
              v-bind="fields.guardPct.attrs.value"
              class="input mono"
              type="number"
              min="10"
              max="100"
              step="1"
            />
            <FieldError :field="fields.guardPct" />
          </label>
          <p class="field__hint">{{ $t("challenge.guard.hint") }}</p>
        </template>
      </fieldset>

      <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      <div class="actions">
        <button type="submit" class="btn btn--primary" :disabled="busy">{{ $t("action.save") }}</button>
        <button type="button" class="btn btn--ghost" @click="emit('cancel')">{{ $t("action.cancel") }}</button>
        <button
          v-if="exists"
          type="button"
          class="btn btn--danger actions__delete"
          :disabled="busy"
          @click="confirmDelete = true"
        >
          {{ $t("challenge.delete") }}
        </button>
      </div>
    </form>

    <ConfirmDialog
      :open="confirmDelete"
      :title="$t('challenge.delete')"
      :message="$t('challenge.deleteConfirm', { account: number })"
      :confirm-label="$t('challenge.delete')"
      @confirm="remove"
      @cancel="confirmDelete = false"
    />
  </div>
</template>

<style scoped>
.editor,
.form {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-5);
}

/* min-width: a fieldset is never narrower than its content by default, which overflows a phone-wide sheet. */
fieldset {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: var(--ww-space-3);
  font-size: var(--ww-size-lg);
  font-weight: 600;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--ww-space-4);
}

.hint,
p[role="alert"] {
  margin: 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}

.actions__delete {
  margin-left: auto;
}

.check {
  display: flex;
  gap: var(--ww-space-2);
  align-items: center;
  font-size: var(--ww-size-sm);
}

.check input {
  accent-color: var(--ww-accent);
}
</style>
