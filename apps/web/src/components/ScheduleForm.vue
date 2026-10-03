<script setup lang="ts">
import type { PauseWindow, Schedule, ScheduleInput, ScheduleRules } from "@wickwatch/core";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { useAsyncAction } from "../composables/useAsyncAction";
import { weekdayName } from "../format";
import { isTimeZone } from "@wickwatch/core/trading-day";
import { system } from "../system";
import { checks, TIME_ZONES, useValidation } from "../validation";
import FieldError from "./FieldError.vue";
import IconButton from "./IconButton.vue";
import PauseList from "./PauseList.vue";

/**
 * Creates or changes a schedule, inside AppModal: weekend, holidays and news pauses, with the pauses of the next two
 * weeks they make (asked from the server, which knows the news calendar). `close` comes from the modal.
 */
const props = defineProps<{ schedule?: Schedule | undefined; close: () => void }>();
const emit = defineEmits<{ saved: [schedule: Schedule]; dirty: [dirty: boolean] }>();
const { locale } = useI18n();
const { busy, error, run } = useAsyncAction();

const initial = props.schedule?.rules;
const name = ref(props.schedule?.name ?? "");
const timezone = ref(initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
// Nothing is paused until it is chosen.
const useWeekend = ref(initial?.weekend !== undefined);
// Copies: the form must not change the schedule on the page before it is saved.
// Field by field: the schedule is reactive, which structuredClone cannot copy.
const { from, to } = initial?.weekend ?? { from: { day: 5, time: "21:00" }, to: { day: 0, time: "23:00" } };
const weekend = ref({ from: { ...from }, to: { ...to } });
const holidays = ref((initial?.holidays ?? []).map((h) => ({ from: h.from, to: h.to ?? "", name: h.name ?? "" })));
const periods = ref((initial?.periods ?? []).map((p) => ({ from: p.from, to: p.to, name: p.name ?? "" })));
const useNews = ref(initial?.news !== undefined);
/** The instances it pauses, chosen from those set up in wickwatch. */
const initialInstances = props.schedule?.instances ?? [];
const chosen = ref<string[]>([...initialInstances]);
const choices = ref<string[]>();
onMounted(async () => {
  try {
    choices.value = await api.scheduleInstances();
  } catch {
    choices.value = [];
  }
});
// Sent only when changed, so saving the rules does not undo links changed on an instance's page meanwhile.
const instancesChanged = () =>
  chosen.value.length !== initialInstances.length || chosen.value.some((n) => !initialInstances.includes(n));
/** News pauses need a calendar (NEWS_CALENDAR_URL); without one they are shown only to remove ones saved before. */
const newsCalendar = computed(() => system.value?.newsCalendar === true);
const news = ref({
  currencies: initial?.news?.currencies.join(", ") ?? "USD",
  impact: initial?.news?.impact ?? ("high" as const),
  before: initial?.news?.before ?? 15,
  after: initial?.news?.after ?? 15,
});

const form = useValidation();
const nameField = form.field(() => name.value, checks.required);
const zoneField = form.field(() => timezone.value, checks.required, checks.timeZone);
const minutes = checks.number({ min: 0, max: 240, integer: true });
const beforeField = form.field(() => (useNews.value ? news.value.before : undefined), minutes);
const afterField = form.field(() => (useNews.value ? news.value.after : undefined), minutes);
const days = computed(() => [1, 2, 3, 4, 5, 6, 0].map((day) => ({ day, name: weekdayName(locale.value, day) })));
const currencies = computed(() => [...new Set(news.value.currencies.toUpperCase().match(/[A-Z]{3}/g) ?? [])]);

const rules = computed<ScheduleRules>(() => ({
  timezone: timezone.value.trim(),
  ...(useWeekend.value ? { weekend: weekend.value } : {}),
  holidays: holidays.value
    .filter((h) => h.from)
    .map((h) => ({
      from: h.from,
      ...(h.to && h.to !== h.from ? { to: h.to } : {}),
      ...(h.name.trim() ? { name: h.name.trim() } : {}),
    })),
  ...(periods.value.some((p) => p.from && p.to)
    ? {
        periods: periods.value
          .filter((p) => p.from && p.to)
          .map((p) => ({ from: p.from, to: p.to, ...(p.name.trim() ? { name: p.name.trim() } : {}) })),
      }
    : {}),
  ...(useNews.value && currencies.value.length
    ? {
        news: {
          currencies: currencies.value,
          impact: news.value.impact,
          before: news.value.before,
          after: news.value.after,
        },
      }
    : {}),
}));

// The modal asks before closing once something changed.
const snapshot = () => JSON.stringify({ name: name.value.trim(), rules: rules.value, instances: chosen.value });
const start = snapshot();
watch(snapshot, (now) => emit("dirty", now !== start));

/** The pauses the rules make, asked shortly after the last change; not again for the same rules or an unknown zone. */
const preview = ref<PauseWindow[]>();
const previewError = ref<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let asked = "";
watch(
  rules,
  (value) => {
    const key = JSON.stringify(value);
    if (key === asked || !isTimeZone(value.timezone)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      asked = key;
      api.previewSchedule(value).then(
        (windows) => {
          preview.value = windows;
          previewError.value = undefined;
        },
        () => {
          preview.value = undefined;
          previewError.value = "schedules.previewFailed";
        },
      );
    }, 400);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(timer));

function submit() {
  if (!form.validate()) return;
  const body: ScheduleInput = {
    name: name.value.trim(),
    rules: rules.value,
    ...(instancesChanged() ? { instances: chosen.value } : {}),
  };
  const editing = props.schedule;
  void run(async () => {
    emit("saved", editing ? await api.updateSchedule(editing.id, body) : await api.createSchedule(body));
  });
}
</script>

<template>
  <form class="form" novalidate @submit.prevent="submit">
    <div class="row">
      <label class="field grow">
        {{ $t("schedules.name") }}
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
      <label class="field grow">
        {{ $t("schedules.timezone") }}
        <input
          v-model="timezone"
          v-bind="zoneField.attrs.value"
          class="input mono"
          maxlength="64"
          list="schedule-time-zones"
          autocomplete="off"
          spellcheck="false"
        />
        <datalist id="schedule-time-zones">
          <option v-for="tz in TIME_ZONES" :key="tz" :value="tz" />
        </datalist>
        <FieldError :field="zoneField" />
      </label>
    </div>

    <fieldset class="group">
      <legend>
        <label class="check"><input v-model="useWeekend" type="checkbox" /> {{ $t("schedules.weekend") }}</label>
      </legend>
      <div v-if="useWeekend" class="row">
        <span class="muted">{{ $t("schedules.from") }}</span>
        <select v-model.number="weekend.from.day" class="input" :aria-label="$t('schedules.fromDay')">
          <option v-for="d in days" :key="d.day" :value="d.day">{{ d.name }}</option>
        </select>
        <input v-model="weekend.from.time" type="time" class="input" :aria-label="$t('schedules.fromTime')" required />
        <span class="muted">{{ $t("schedules.to") }}</span>
        <select v-model.number="weekend.to.day" class="input" :aria-label="$t('schedules.toDay')">
          <option v-for="d in days" :key="d.day" :value="d.day">{{ d.name }}</option>
        </select>
        <input v-model="weekend.to.time" type="time" class="input" :aria-label="$t('schedules.toTime')" required />
      </div>
    </fieldset>

    <fieldset class="group">
      <legend>{{ $t("schedules.holidays") }}</legend>
      <p class="muted hint">{{ $t("schedules.holidaysHint") }}</p>
      <div v-for="(h, i) in holidays" :key="i" class="row">
        <input v-model="h.from" type="date" class="input" :aria-label="$t('schedules.holidayFrom')" required />
        <span class="muted">–</span>
        <input v-model="h.to" type="date" class="input" :min="h.from" :aria-label="$t('schedules.holidayTo')" />
        <input
          v-model="h.name"
          class="input grow"
          maxlength="100"
          :placeholder="$t('schedules.holidayName')"
          :aria-label="$t('schedules.holidayName')"
        />
        <IconButton
          icon="trash"
          variant="danger"
          small
          :label="$t('schedules.holidayRemove')"
          @click="holidays.splice(i, 1)"
        />
      </div>
      <div>
        <IconButton
          icon="plus"
          small
          show-label
          :label="$t('schedules.holidayAdd')"
          @click="holidays.push({ from: '', to: '', name: '' })"
        />
      </div>
    </fieldset>

    <fieldset class="group">
      <legend>{{ $t("schedules.periods") }}</legend>
      <p class="muted hint">{{ $t("schedules.periodsHint") }}</p>
      <div v-for="(p, i) in periods" :key="i" class="row">
        <input v-model="p.from" type="datetime-local" class="input" :aria-label="$t('schedules.periodFrom')" required />
        <span class="muted">–</span>
        <input
          v-model="p.to"
          type="datetime-local"
          class="input"
          :min="p.from"
          :aria-label="$t('schedules.periodTo')"
          required
        />
        <input
          v-model="p.name"
          class="input grow"
          maxlength="100"
          :placeholder="$t('schedules.periodName')"
          :aria-label="$t('schedules.periodName')"
        />
        <IconButton
          icon="trash"
          variant="danger"
          small
          :label="$t('schedules.periodRemove')"
          @click="periods.splice(i, 1)"
        />
      </div>
      <div>
        <IconButton
          icon="plus"
          small
          show-label
          :label="$t('schedules.periodAdd')"
          @click="periods.push({ from: '', to: '', name: '' })"
        />
      </div>
    </fieldset>

    <fieldset v-if="newsCalendar || initial?.news" class="group">
      <legend>
        <label class="check"><input v-model="useNews" type="checkbox" /> {{ $t("schedules.news") }}</label>
      </legend>
      <p v-if="!newsCalendar" class="tone-warning hint">{{ $t("schedules.newsOff") }}</p>
      <template v-if="useNews">
        <div class="row">
          <label class="field grow">
            {{ $t("schedules.currencies") }}
            <input
              v-model="news.currencies"
              class="input mono"
              maxlength="100"
              :placeholder="$t('schedules.currenciesPlaceholder')"
              autocomplete="off"
            />
          </label>
          <label class="field">
            {{ $t("schedules.impact") }}
            <select v-model="news.impact" class="input">
              <option value="high">{{ $t("schedules.impacts.high") }}</option>
              <option value="medium">{{ $t("schedules.impacts.medium") }}</option>
            </select>
          </label>
          <label class="field">
            {{ $t("schedules.before") }}
            <input
              v-model.number="news.before"
              v-bind="beforeField.attrs.value"
              type="number"
              min="0"
              max="240"
              class="input minutes"
            />
            <FieldError :field="beforeField" />
          </label>
          <label class="field">
            {{ $t("schedules.after") }}
            <input
              v-model.number="news.after"
              v-bind="afterField.attrs.value"
              type="number"
              min="0"
              max="240"
              class="input minutes"
            />
            <FieldError :field="afterField" />
          </label>
        </div>
        <p class="muted hint">{{ $t("schedules.newsHint") }}</p>
      </template>
    </fieldset>

    <fieldset class="group">
      <legend>{{ $t("schedules.instances") }}</legend>
      <p class="muted hint">{{ $t("schedules.instancesHint") }}</p>
      <p v-if="choices && !choices.length" class="muted">{{ $t("schedules.noManaged") }}</p>
      <div v-else class="row">
        <label v-for="instance in choices" :key="instance" class="check mono">
          <input v-model="chosen" type="checkbox" :value="instance" /> {{ instance }}
        </label>
      </div>
    </fieldset>

    <section class="group" aria-live="polite">
      <h3>{{ $t("schedules.preview") }}</h3>
      <p v-if="previewError" class="tone-warning">{{ $t(previewError) }}</p>
      <PauseList v-else-if="preview" :windows="preview" />
    </section>

    <div class="buttons">
      <button type="submit" class="btn btn--primary" :disabled="busy" :aria-busy="busy">
        {{ $t(schedule ? "schedules.save" : "schedules.create") }}
      </button>
      <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.cancel") }}</button>
    </div>
    <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
  </form>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
  min-width: 0;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
  align-items: flex-end;
}

.row > span {
  align-self: center;
}

.grow {
  flex: 1 1 12rem;
  min-width: 0;
}

.minutes {
  width: 6rem;
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
  min-width: 0;
  margin: 0;
  padding: var(--ww-space-3) 0 0;
  border: 0;
  border-top: 1px solid var(--ww-border);
}

.group legend,
.group h3 {
  padding: 0;
  font-size: var(--ww-size-sm);
  font-weight: 600;
}

.group h3,
.group p {
  margin: 0;
}

.check {
  display: inline-flex;
  gap: var(--ww-space-2);
  align-items: center;
}

.hint {
  font-size: var(--ww-size-xs);
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}
</style>
