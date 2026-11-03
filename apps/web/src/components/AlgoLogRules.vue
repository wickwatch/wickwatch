<script setup lang="ts">
import type { AlgoSettings, LogRule } from "@wickwatch/core";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { useAsyncAction } from "../composables/useAsyncAction";
import { isAdmin } from "../session";
import { checks, type Check, type FieldMessage } from "../validation";
import LogRuleList from "./LogRuleList.vue";

/**
 * The log rules of an algo: restart or stop an instance of it when its log shows a matching line, for all its versions.
 * Folded like the account size settings beside it; the summary says how many rules there are.
 */
const props = defineProps<{ algoName: string; settings: AlgoSettings | undefined }>();
const emit = defineEmits<{ changed: [message: string] }>();
const { t } = useI18n();
const { busy, error, run } = useAsyncAction();

/** A rule as edited: the recovery pattern as text, empty for none. */
type Draft = Omit<LogRule, "recoveryPattern"> & { recoveryPattern: string };

const NEW_RULE: Draft = {
  pattern: "",
  regex: false,
  recoveryPattern: "",
  waitSeconds: 120,
  action: "restart",
  withOpenPosition: true,
  cooldownMinutes: 30,
  maxPerDay: 6,
};

const toDraft = (rule: LogRule): Draft => ({ ...rule, recoveryPattern: rule.recoveryPattern ?? "" });
function toRule({ recoveryPattern, ...rest }: Draft): LogRule {
  const recovery = recoveryPattern.trim();
  return { ...rest, pattern: rest.pattern.trim(), ...(recovery ? { recoveryPattern: recovery } : {}) };
}

const saved = computed(() => props.settings?.logRules ?? []);
const drafts = ref<Draft[]>([]);
watch(saved, (rules) => (drafts.value = rules.map(toDraft)), { immediate: true });

const unchanged = computed(() => JSON.stringify(drafts.value.map(toRule)) === JSON.stringify(saved.value));

/** The shared field checks, per rule and field; shown at once except "required", which waits for a save. */
const tried = ref(false);
const first = (value: unknown, ...list: Check[]) => list.map((check) => check(value)).find(Boolean);
const integer = (min: number, max: number) => checks.number({ min, max, integer: true });
const problems = computed(() =>
  drafts.value.map((d): Partial<Record<keyof Draft, FieldMessage>> => {
    const pattern = first(d.pattern, ...(tried.value ? [checks.required] : []), ...(d.regex ? [checks.regex] : []));
    const recovery = d.regex ? checks.regex(d.recoveryPattern) : undefined;
    const numbers = {
      waitSeconds: d.recoveryPattern.trim() ? first(d.waitSeconds, checks.required, integer(10, 3600)) : undefined,
      cooldownMinutes: first(d.cooldownMinutes, checks.required, integer(1, 1440)),
      maxPerDay: first(d.maxPerDay, checks.required, integer(1, 50)),
    };
    return Object.fromEntries(
      Object.entries({ pattern, recoveryPattern: recovery, ...numbers }).filter(([, m]) => m),
    ) as Partial<Record<keyof Draft, FieldMessage>>;
  }),
);
const valid = () => drafts.value.every((d) => d.pattern.trim()) && problems.value.every((p) => !Object.keys(p).length);

function save() {
  tried.value = true;
  if (!valid()) return;
  void run(async () => {
    await api.saveAlgoSettings(props.algoName, { logRules: drafts.value.map(toRule) });
    emit("changed", t("logRules.saved", { algo: props.algoName }));
  });
}
</script>

<template>
  <details class="rules">
    <summary class="rules__summary">
      <span class="rules__title">{{ $t("logRules.title") }}</span
      ><span class="muted rules__state"> · {{ $t("logRules.state", saved.length) }}</span>
    </summary>
    <p class="muted hint">{{ $t("logRules.hint", { algo: algoName }) }}</p>
    <LogRuleList v-if="!isAdmin" :rules="saved" />
    <form v-else class="rules__form" novalidate @submit.prevent="save">
      <fieldset v-for="(rule, i) in drafts" :key="i" class="rule">
        <legend>{{ $t("logRules.rule", { n: i + 1 }) }}</legend>
        <label class="field rule__wide">
          {{ $t("logRules.pattern") }}
          <input
            v-model="rule.pattern"
            class="input mono"
            maxlength="300"
            required
            :aria-invalid="problems[i]?.pattern ? true : undefined"
          />
          <span v-if="problems[i]?.pattern" class="field__error">
            {{ $t(problems[i].pattern.key, problems[i].pattern.params ?? {}) }}
          </span>
        </label>
        <label class="check"><input v-model="rule.regex" type="checkbox" /> {{ $t("logRules.regex") }}</label>
        <label class="field rule__wide">
          {{ $t("logRules.recoveryPattern") }}
          <input
            v-model="rule.recoveryPattern"
            class="input mono"
            maxlength="300"
            :aria-invalid="problems[i]?.recoveryPattern ? true : undefined"
          />
          <span v-if="problems[i]?.recoveryPattern" class="field__error">
            {{ $t(problems[i].recoveryPattern.key, problems[i].recoveryPattern.params ?? {}) }}
          </span>
        </label>
        <label v-if="rule.recoveryPattern.trim()" class="field">
          {{ $t("logRules.waitSeconds") }}
          <input
            v-model.number="rule.waitSeconds"
            type="number"
            min="10"
            max="3600"
            class="input"
            :aria-invalid="problems[i]?.waitSeconds ? true : undefined"
          />
          <span v-if="problems[i]?.waitSeconds" class="field__error">
            {{ $t(problems[i].waitSeconds.key, problems[i].waitSeconds.params ?? {}) }}
          </span>
        </label>
        <label class="field">
          {{ $t("logRules.action") }}
          <select v-model="rule.action" class="input">
            <option value="restart">{{ $t("logRules.actions.restart") }}</option>
            <option value="stop">{{ $t("logRules.actions.stop") }}</option>
          </select>
        </label>
        <label class="field">
          {{ $t("logRules.cooldownMinutes") }}
          <input
            v-model.number="rule.cooldownMinutes"
            type="number"
            min="1"
            max="1440"
            class="input"
            :aria-invalid="problems[i]?.cooldownMinutes ? true : undefined"
          />
          <span v-if="problems[i]?.cooldownMinutes" class="field__error">
            {{ $t(problems[i].cooldownMinutes.key, problems[i].cooldownMinutes.params ?? {}) }}
          </span>
        </label>
        <label class="field">
          {{ $t("logRules.maxPerDay") }}
          <input
            v-model.number="rule.maxPerDay"
            type="number"
            min="1"
            max="50"
            class="input"
            :aria-invalid="problems[i]?.maxPerDay ? true : undefined"
          />
          <span v-if="problems[i]?.maxPerDay" class="field__error">
            {{ $t(problems[i].maxPerDay.key, problems[i].maxPerDay.params ?? {}) }}
          </span>
        </label>
        <label class="check">
          <input v-model="rule.withOpenPosition" type="checkbox" /> {{ $t("logRules.withOpenPosition") }}
        </label>
        <button type="button" class="btn btn--small" :disabled="busy" @click="drafts.splice(i, 1)">
          {{ $t("logRules.remove") }}
        </button>
      </fieldset>
      <div class="rules__actions">
        <button type="button" class="btn" :disabled="busy || drafts.length >= 20" @click="drafts.push({ ...NEW_RULE })">
          {{ $t("logRules.add") }}
        </button>
        <button type="submit" class="btn" :disabled="busy || unchanged" :aria-busy="busy">
          {{ $t("logRules.save") }}
        </button>
      </div>
    </form>
    <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
  </details>
</template>

<style scoped>
.rules {
  padding-top: var(--ww-space-3);
  border-top: 1px solid var(--ww-border);
}

.rules[open] {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
}

.rules p {
  margin: 0;
}

/* Like the account size settings above it. */
.rules__summary {
  font-size: var(--ww-size-sm);
  cursor: pointer;
}

.rules__title {
  font-weight: 600;
}

.rules__state,
.hint {
  font-size: var(--ww-size-xs);
}

.rules__form {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-3);
}

.rule {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2) var(--ww-space-3);
  align-items: flex-end;
  margin: 0;
  padding: var(--ww-space-3);
  border: 1px solid var(--ww-border);
  border-radius: var(--ww-radius-md);
}

.rule legend {
  padding: 0 var(--ww-space-1);
  font-size: var(--ww-size-xs);
  font-weight: 600;
}

.rule .field {
  flex: 0 1 11rem;
  min-width: 0;
}

.rule .rule__wide {
  flex: 1 1 18rem;
}

.check {
  display: inline-flex;
  gap: var(--ww-space-2);
  align-items: center;
  font-size: var(--ww-size-sm);
}

.rules__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}

@media (max-width: 640px) {
  .rule .field {
    flex: 1 1 100%;
  }
}
</style>
