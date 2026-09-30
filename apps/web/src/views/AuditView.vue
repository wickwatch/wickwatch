<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { RouteLocationRaw } from "vue-router";
import { api, errorKey, type AuditRecord } from "../api";
import AppSpinner from "../components/AppSpinner.vue";
import { formatDateTime } from "../format";
import { isAdmin } from "../session";

/** The audit log for admins: who did what, and what wickwatch did by itself (loss guard, autostart). */
const { t, te, locale } = useI18n();

const entries = ref<AuditRecord[]>([]);
const actions = ref<string[]>([]);
const more = ref(false);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref<string>();
const action = ref("");
/** "" for all, "today" from the viewer's midnight, or a number of days back. */
const period = ref<"" | "today" | "7" | "30">("");
const since = () => {
  if (!period.value) return undefined;
  const start = new Date();
  if (period.value === "today") start.setHours(0, 0, 0, 0);
  else start.setTime(start.getTime() - Number(period.value) * 24 * 60 * 60 * 1000);
  return start.toISOString();
};
const target = ref("");

/** Groups by the part before the dot ("instance."), each followed by its actions. */
const groups = computed(() => [...new Set(actions.value.map((a) => a.split(".")[0] ?? a))]);
const actionLabel = (code: string) => {
  const key = `audit.actions.${code.replace(/\./g, "_")}`;
  return te(key) ? t(key) : code;
};
const groupLabel = (group: string) => {
  const key = `audit.groups.${group}`;
  return te(key) ? t(key) : group;
};

async function load(append = false) {
  error.value = undefined;
  if (append) loadingMore.value = true;
  else loading.value = true;
  try {
    const before = append ? entries.value.at(-1)?.id : undefined;
    const from = since();
    const page = await api.audit({
      ...(action.value ? { action: action.value } : {}),
      ...(from ? { since: from } : {}),
      ...(target.value.trim() ? { target: target.value.trim() } : {}),
      ...(before !== undefined ? { before } : {}),
    });
    entries.value = append ? [...entries.value, ...page.entries] : page.entries;
    actions.value = page.actions;
    more.value = page.more;
  } catch (e) {
    error.value = t(errorKey(e));
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

/** Actions wickwatch takes by itself; other entries without a user are e.g. failed logins (the name tried is the target). */
const SYSTEM_ACTIONS = new Set(["account.loss_guard", "instance.autostart", "instance.autostart_gave_up"]);

/** Result of an action that can fail (`ok` in its details), in words, not colour alone. */
const result = (e: AuditRecord) => (typeof e.details?.["ok"] === "boolean" ? e.details["ok"] : undefined);
const format = (value: unknown): string => {
  if (Array.isArray(value)) return value.length ? value.map(format).join(", ") : t("format.none");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
};
const details = (e: AuditRecord) =>
  Object.entries(e.details ?? {})
    .filter(([key]) => key !== "ok")
    .map(([key, value]) => `${key}: ${format(value)}`)
    .join(" · ");

/** Targets that still have a page: instances and accounts, not ones the entry deleted. */
function targetLink(e: AuditRecord): RouteLocationRaw | undefined {
  if (!e.target || e.action.endsWith(".delete")) return undefined;
  if (e.action.startsWith("instance.")) return { name: "instance", params: { ref: e.target } };
  if (e.action.startsWith("account.") || e.action.startsWith("challenge.")) {
    return { name: "account", params: { number: e.target } };
  }
  return undefined;
}

onMounted(() => {
  if (isAdmin.value) void load();
  else loading.value = false;
});
</script>

<template>
  <div class="page">
    <div class="head">
      <h1>{{ $t("audit.title") }}</h1>
      <p class="muted intro">{{ $t("audit.intro") }}</p>
    </div>
    <p v-if="!isAdmin" class="tone-negative" role="alert">{{ $t("error.api.forbidden") }}</p>

    <template v-else>
      <form class="filters" @submit.prevent="load()">
        <label class="field">
          {{ $t("audit.period") }}
          <select v-model="period" class="input" @change="load()">
            <option value="">{{ $t("audit.periods.all") }}</option>
            <option value="today">{{ $t("audit.periods.today") }}</option>
            <option value="7">{{ $t("audit.periods.days", { days: 7 }) }}</option>
            <option value="30">{{ $t("audit.periods.days", { days: 30 }) }}</option>
          </select>
        </label>
        <label class="field">
          {{ $t("audit.action") }}
          <select v-model="action" class="input" @change="load()">
            <option value="">{{ $t("audit.allActions") }}</option>
            <optgroup v-for="group in groups" :key="group" :label="groupLabel(group)">
              <option :value="`${group}.`">{{ $t("audit.allOf", { group: groupLabel(group) }) }}</option>
              <option v-for="a in actions.filter((x) => x.startsWith(`${group}.`))" :key="a" :value="a">
                {{ actionLabel(a) }}
              </option>
            </optgroup>
          </select>
        </label>
        <label class="field">
          {{ $t("audit.target") }}
          <input
            v-model="target"
            class="input mono"
            type="search"
            :placeholder="$t('audit.targetPlaceholder')"
            autocomplete="off"
            spellcheck="false"
            @change="load()"
          />
        </label>
      </form>

      <p v-if="error" class="tone-negative" role="alert">{{ error }}</p>
      <AppSpinner v-if="loading" />
      <p v-else-if="!entries.length" class="muted">{{ $t("audit.none") }}</p>
      <section v-else class="panel card" :aria-label="$t('audit.title')">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ $t("audit.time") }}</th>
                <th scope="col">{{ $t("audit.user") }}</th>
                <th scope="col">{{ $t("audit.action") }}</th>
                <th scope="col">{{ $t("audit.target") }}</th>
                <th scope="col">{{ $t("audit.result") }}</th>
                <th scope="col">{{ $t("audit.details") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in entries" :key="e.id">
                <td class="mono">{{ formatDateTime(locale, e.time) }}</td>
                <td>
                  <span v-if="e.user">{{ e.user }}</span>
                  <span v-else-if="SYSTEM_ACTIONS.has(e.action)" class="muted">{{ $t("audit.system") }}</span>
                  <template v-else>{{ $t("format.none") }}</template>
                </td>
                <td>{{ actionLabel(e.action) }}</td>
                <td class="mono">
                  <RouterLink v-if="targetLink(e)" :to="targetLink(e) ?? '/'">{{ e.target }}</RouterLink>
                  <template v-else>{{ e.target ?? $t("format.none") }}</template>
                </td>
                <td>
                  <span v-if="result(e) === true" class="pill tone-positive">{{ $t("audit.ok") }}</span>
                  <span v-else-if="result(e) === false" class="pill tone-negative">{{ $t("audit.failed") }}</span>
                  <template v-else>{{ $t("format.none") }}</template>
                </td>
                <td class="mono details">{{ details(e) || $t("format.none") }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <button
          v-if="more"
          type="button"
          class="btn btn--ghost btn--small more"
          :disabled="loadingMore"
          @click="load(true)"
        >
          {{ $t("audit.more") }}
        </button>
      </section>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
}

.head h1,
.intro {
  margin: 0;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-4);
}

.filters .field {
  min-width: min(280px, 100%);
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-3);
  min-width: 0;
  padding: var(--ww-space-5);
}

.table-wrap {
  position: relative;
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ww-size-sm);
}

th,
td {
  padding: var(--ww-space-2) var(--ww-space-3);
  border-bottom: 1px solid var(--ww-border);
  text-align: left;
  white-space: nowrap;
  vertical-align: top;
}

tbody tr:last-child > * {
  border-bottom: 0;
}

thead th {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
  font-weight: 600;
}

/* Details can be long (e.g. the stopped instances of an emergency stop); they wrap instead of widening the table. */
.details {
  min-width: 240px;
  white-space: normal;
  overflow-wrap: anywhere;
  color: var(--ww-text-muted);
}

.more {
  align-self: flex-start;
}

@media (max-width: 640px) {
  .filters .field {
    flex: 1 1 100%;
  }
}
</style>
