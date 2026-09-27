<script setup lang="ts">
import type { ChallengeProfile, ChallengeRules, ChallengeTemplate, DailyLossReference } from "@wickwatch/core";
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError, errorKey } from "../api";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import { isAdmin } from "../session";

const route = useRoute();
const router = useRouter();
const { locale } = useI18n();
const number = computed(() => String(route.params["number"]));

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
  maxLossType: "static" as "static" | "trailing",
  minTradingDays: undefined as number | undefined,
  durationDays: undefined as number | undefined,
});

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
  form.name = template.name[locale.value] ?? template.name["en"] ?? template.program;
  form.phase = template.phase;
}

const selectedTemplate = computed(() => templates.value.find((t) => t.id === form.templateId));
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
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) error.value = errorKey(e);
  } finally {
    loading.value = false;
  }
});

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

const save = () =>
  run(async () => {
    await api.saveChallenge(number.value, toProfile());
    await router.push("/");
  });

const remove = () =>
  run(async () => {
    confirmDelete.value = false;
    await api.deleteChallenge(number.value);
    await router.push("/");
  });
</script>

<template>
  <div class="editor">
    <RouterLink to="/" class="back">{{ $t("instance.back") }}</RouterLink>
    <h1>{{ $t("challenge.editorTitle", { account: number }) }}</h1>
    <p v-if="!isAdmin" class="tone-warning">{{ $t("error.api.forbidden") }}</p>
    <p v-else-if="loading" class="muted">{{ $t("overview.loading") }}</p>

    <form v-else class="form panel" @submit.prevent="save">
      <label v-if="templates.length" class="field">
        {{ $t("challenge.template") }}
        <select v-model="form.templateId" class="input" @change="applyTemplate">
          <option value="">{{ $t("challenge.noTemplate") }}</option>
          <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name[locale] ?? t.name["en"] ?? t.id }}</option>
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
          <input v-model="form.name" class="input" required maxlength="100" />
        </label>
        <label class="field">
          {{ $t("challenge.phase") }}
          <input v-model="form.phase" class="input" maxlength="100" />
        </label>
        <div class="grid">
          <label class="field">
            {{ $t("challenge.startDate") }}
            <input v-model="form.startDate" class="input" type="date" required />
          </label>
          <label class="field">
            {{ $t("challenge.startBalance") }}
            <input
              v-model.number="form.startBalance"
              class="input mono"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>{{ $t("challenge.rules") }}</legend>
        <p class="field__hint">{{ $t("challenge.rulesHint") }}</p>
        <div class="grid">
          <label class="field">
            {{ $t("challenge.rule.profitTarget") }} (%)
            <input v-model.number="form.profitTargetPct" class="input mono" type="number" min="0" step="0.1" />
          </label>
          <label class="field">
            {{ $t("challenge.rule.dailyLoss") }} (%)
            <input v-model.number="form.dailyLossPct" class="input mono" type="number" min="0.1" max="100" step="0.1" />
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
              <input v-model="form.resetTime" class="input mono" type="time" required />
            </label>
            <label class="field">
              {{ $t("challenge.timezone") }}
              <input v-model="form.timezone" class="input mono" list="time-zones" required />
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
            <input v-model.number="form.maxLossPct" class="input mono" type="number" min="0.1" max="100" step="0.1" />
          </label>
          <label v-if="isSet(form.maxLossPct)" class="field">
            {{ $t("challenge.maxLossType") }}
            <select v-model="form.maxLossType" class="input">
              <option value="static">{{ $t("challenge.maxLossTypes.static") }}</option>
              <option value="trailing">{{ $t("challenge.maxLossTypes.trailing") }}</option>
            </select>
          </label>
        </div>
        <div class="grid">
          <label class="field">
            {{ $t("challenge.rule.tradingDays") }}
            <input v-model.number="form.minTradingDays" class="input mono" type="number" min="0" step="1" />
          </label>
          <label class="field">
            {{ $t("challenge.durationDays") }}
            <input v-model.number="form.durationDays" class="input mono" type="number" min="1" step="1" />
          </label>
        </div>
      </fieldset>

      <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      <div class="actions">
        <button type="submit" class="btn btn--primary" :disabled="busy">{{ $t("action.save") }}</button>
        <RouterLink to="/" class="btn btn--ghost">{{ $t("action.cancel") }}</RouterLink>
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
.editor {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-5);
  max-width: 720px;
  padding: var(--ww-space-6) var(--ww-space-10) var(--ww-space-10);
}

.back {
  align-self: flex-start;
  font-size: var(--ww-size-sm);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-5);
  padding: var(--ww-space-6);
}

fieldset {
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

@media (max-width: 640px) {
  .editor {
    padding: var(--ww-space-4);
  }

  .form {
    padding: var(--ww-space-4);
  }
}
</style>
