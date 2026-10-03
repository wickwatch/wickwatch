<script setup lang="ts">
import type { Schedule } from "@wickwatch/core";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import AppModal from "../components/AppModal.vue";
import AppSpinner from "../components/AppSpinner.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import IconButton from "../components/IconButton.vue";
import PauseList from "../components/PauseList.vue";
import ScheduleForm from "../components/ScheduleForm.vue";
import { useAsyncAction } from "../composables/useAsyncAction";
import { weekdayName } from "../format";
import { isAdmin } from "../session";

/** Schedules pause bots on weekends, holidays and around news; an instance can have several (also on its Configuration tab). */
const { t, locale } = useI18n();
const schedules = ref<Schedule[]>([]);
const loading = ref(true);

async function load() {
  schedules.value = await api.schedules();
}
const { busy, running, error, notice, run } = useAsyncAction({ reload: load });
onMounted(async () => {
  await run(async () => undefined);
  loading.value = false;
});

/** What a schedule pauses, in one line. */
function summary(s: Schedule): string {
  const { weekend, holidays, news } = s.rules;
  return [
    weekend &&
      t("schedules.weekendSummary", {
        from: `${weekdayName(locale.value, weekend.from.day)} ${weekend.from.time}`,
        to: `${weekdayName(locale.value, weekend.to.day)} ${weekend.to.time}`,
      }),
    holidays.length && t("schedules.holidaysSummary", holidays.length),
    s.rules.periods?.length && t("schedules.periodsSummary", s.rules.periods.length),
    news &&
      t("schedules.newsSummary", {
        currencies: news.currencies.join(", "),
        impact: t(`schedules.impacts.${news.impact}`),
        before: news.before,
        after: news.after,
      }),
    s.rules.timezone,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The modal: open with the schedule to edit, or none for a new one. */
const editing = ref<{ schedule?: Schedule }>();
const dirty = ref(false);
function edit(schedule?: Schedule) {
  dirty.value = false;
  editing.value = schedule ? { schedule } : {};
}
/** The saved schedule comes back from the server; the list takes it without loading all again. */
function saved(schedule: Schedule) {
  const isNew = !editing.value?.schedule;
  editing.value = undefined;
  schedules.value = [...schedules.value.filter((s) => s.id !== schedule.id), schedule].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  notice.value = t(isNew ? "schedules.created" : "schedules.saved", { name: schedule.name });
}

const removing = ref<Schedule>();
function confirmRemove() {
  const schedule = removing.value;
  removing.value = undefined;
  if (!schedule) return;
  void run(() => api.deleteSchedule(schedule.id), {
    as: `remove-${String(schedule.id)}`,
    done: () => t("schedules.deleted", { name: schedule.name }),
  });
}
</script>

<template>
  <div class="page">
    <div class="head">
      <h1>{{ $t("nav.schedules") }}</h1>
      <IconButton
        v-if="isAdmin"
        icon="plus"
        :label="$t('schedules.add')"
        show-label
        class="head__action"
        @click="edit()"
      />
      <p class="muted intro">{{ $t("schedules.intro") }}</p>
    </div>
    <p class="status" role="status" aria-live="polite">{{ notice }}</p>
    <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
    <AppSpinner v-if="loading" />

    <template v-else>
      <section v-if="!schedules.length" class="panel card">
        <p class="muted">{{ $t("schedules.none") }}</p>
      </section>
      <section v-for="s in schedules" :key="s.id" class="panel card schedule" :aria-label="s.name">
        <div class="schedule__head">
          <h2>{{ s.name }}</h2>
          <span v-if="isAdmin" class="schedule__actions">
            <IconButton
              icon="edit"
              small
              :label="$t('table.actionOn', { action: $t('schedules.edit'), name: s.name })"
              @click="edit(s)"
            />
            <IconButton
              icon="trash"
              variant="danger"
              small
              :label="$t('table.actionOn', { action: $t('action.delete'), name: s.name })"
              :disabled="busy"
              :aria-busy="running === `remove-${s.id}`"
              @click="removing = s"
            />
          </span>
        </div>
        <p class="muted meta">{{ summary(s) }}</p>
        <p class="meta">
          {{ $t("schedules.instances") }}:
          <template v-if="s.instances.length">
            <template v-for="(name, i) in s.instances" :key="name"
              >{{ i ? ", " : ""
              }}<RouterLink :to="{ name: 'instance-config', params: { ref: name } }">{{ name }}</RouterLink></template
            >
          </template>
          <span v-else class="muted">{{ $t("schedules.noInstances") }}</span>
        </p>
        <div class="next">
          <h3>{{ $t("schedules.nextPause") }}</h3>
          <PauseList :windows="s.nextPause ? [s.nextPause] : []" />
        </div>
      </section>
    </template>

    <AppModal
      :open="editing !== undefined"
      :title="editing?.schedule ? $t('schedules.editTitle', { name: editing.schedule.name }) : $t('schedules.add')"
      :dirty="dirty"
      @close="editing = undefined"
    >
      <template #default="{ close }">
        <ScheduleForm
          v-if="editing"
          :schedule="editing.schedule"
          :close="close"
          @saved="saved"
          @dirty="dirty = $event"
        />
      </template>
    </AppModal>
    <ConfirmDialog
      :open="removing !== undefined"
      :title="$t('action.delete')"
      :message="removing ? $t('schedules.deleteConfirm', { name: removing.name }) : ''"
      :confirm-label="$t('action.delete')"
      @confirm="confirmRemove"
      @cancel="removing = undefined"
    />
  </div>
</template>

<style scoped>
.head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "title action"
    "intro intro";
  gap: var(--ww-space-2) var(--ww-space-4);
  align-items: center;
}

.head h1 {
  grid-area: title;
  margin: 0;
}

.head .intro {
  grid-area: intro;
}

.head__action {
  grid-area: action;
}

/* Cards like on the Algos page; the empty-list text sits inside one too. */
.card {
  padding: var(--ww-space-5);
}

.card > p {
  margin: 0;
}

.schedule {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
}

.schedule p,
.schedule h2,
.schedule h3 {
  margin: 0;
}

.schedule__head {
  display: flex;
  gap: var(--ww-space-3);
  align-items: center;
  justify-content: space-between;
}

.schedule__actions {
  display: flex;
  gap: var(--ww-space-1);
}

.meta {
  font-size: var(--ww-size-sm);
}

.next {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-1);
  padding-top: var(--ww-space-2);
  border-top: 1px solid var(--ww-border);
}

.next h3 {
  font-size: var(--ww-size-sm);
}

@media (max-width: 640px) {
  .head {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "title"
      "intro"
      "action";
  }

  .head__action {
    width: 100%;
    margin-top: var(--ww-space-2);
  }
}
</style>
