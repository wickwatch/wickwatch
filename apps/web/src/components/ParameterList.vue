<script setup lang="ts">
import type { ParameterIssueCode, ParameterSchema } from "@wickwatch/core";
import { groupBy } from "@wickwatch/core/group-by";
import { parameterDefaults } from "@wickwatch/core/parameters";
import { computed, reactive, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "./AppIcon.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import ParameterField from "./ParameterField.vue";
import ParameterName from "./ParameterName.vue";

/**
 * The parameters of an algo, grouped by the algo's parameter groups (collapsible, all closed at first), with search and
 * an "only changed" filter. The same list everywhere (BRAND.md, "Consistency"):
 * - `view`: the values of a configuration, changed ones marked;
 * - `edit`: inputs for `values` (v-model), with reset per value and for all;
 * - `schema`: an algo's parameters with type, default and range, no values.
 * An algo without groups gets a flat list.
 */
const props = defineProps<{
  schema: ParameterSchema[];
  mode: "view" | "edit" | "schema";
  values?: Record<string, unknown> | undefined;
  issues?: ReadonlyMap<string, ParameterIssueCode | "required"> | undefined;
  symbolsList?: string | undefined;
  periodsList?: string | undefined;
}>();
const emit = defineEmits<{ "update:values": [values: Record<string, unknown>] }>();
const { t } = useI18n();
const id = useId();

interface Group {
  key: string;
  title: string;
  params: ParameterSchema[];
}

const value = (p: ParameterSchema) => props.values?.[p.name];
const isChanged = (p: ParameterSchema) =>
  props.mode !== "schema" && p.default !== undefined && value(p) !== undefined && value(p) !== p.default;
/** An empty value shows as "–", so it reads as empty rather than missing. */
const show = (v: unknown) => (v === undefined || v === "" ? t("format.none") : String(v));

/** Values the algo does not know (view only): shown in a group of their own, so nothing is hidden. */
const unknown = computed<ParameterSchema[]>(() =>
  props.mode === "view"
    ? Object.keys(props.values ?? {})
        .filter((k) => !props.schema.some((p) => p.name === k))
        .map((name) => ({ name, type: "string" }))
    : [],
);
const grouped = computed(() => props.schema.some((p) => p.group));
const groups = computed<Group[]>(() => {
  const list = [...groupBy(props.schema, (p) => p.group ?? "")].map(([key, params]) => ({
    key,
    title: key || t("instanceForm.general"),
    params,
  }));
  if (unknown.value.length)
    list.push({ key: "\u0000unknown", title: t("parameters.unknownGroup"), params: unknown.value });
  return list;
});

const query = ref("");
const onlyChanged = ref(false);
const filtering = computed(() => query.value.trim() !== "" || onlyChanged.value);
const matches = (p: ParameterSchema) => {
  const q = query.value.trim().toLowerCase();
  if (q && !p.name.toLowerCase().includes(q) && !(p.label ?? "").toLowerCase().includes(q)) return false;
  return !onlyChanged.value || isChanged(p);
};
const visible = (g: Group) => g.params.filter(matches);
const shownGroups = computed(() => groups.value.filter((g) => visible(g).length));
const changedCount = computed(() => props.schema.filter(isChanged).length);

const open = reactive(new Set<string>());
/** While searching or filtering, every group with a match is open. */
const isOpen = (g: Group) => !grouped.value || filtering.value || open.has(g.key);
function toggle(g: Group) {
  if (open.has(g.key)) open.delete(g.key);
  else open.add(g.key);
}
/** Changed values per group key. */
const changedIn = computed(() => new Map(groups.value.map((g) => [g.key, g.params.filter(isChanged).length])));
const issuesIn = (g: Group) => g.params.filter((p) => props.issues?.has(p.name)).length;
// A group with a problem opens, so the marked field can be seen and focused.
watch(
  () => [...(props.issues?.keys() ?? [])],
  (names) => {
    for (const g of groups.value) if (g.params.some((p) => names.includes(p.name))) open.add(g.key);
  },
);

function update(name: string, v: unknown) {
  emit("update:values", { ...props.values, [name]: v });
}
const resetting = ref(false);
function resetAll() {
  resetting.value = false;
  emit("update:values", { ...props.values, ...parameterDefaults(props.schema) });
}

const range = (p: ParameterSchema) =>
  p.options
    ? p.options.join(" | ")
    : p.min !== undefined || p.max !== undefined
      ? `${p.min ?? ""} … ${p.max ?? ""}`
      : "";
</script>

<template>
  <div class="params">
    <div class="params__bar">
      <label class="params__search">
        <span class="visually-hidden">{{ $t("parameters.search") }}</span>
        <AppIcon name="search" :size="16" />
        <input
          v-model="query"
          type="search"
          class="input"
          :placeholder="$t('parameters.searchPlaceholder')"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <button
        v-if="mode !== 'schema'"
        type="button"
        class="btn btn--ghost"
        :aria-pressed="onlyChanged"
        @click="onlyChanged = !onlyChanged"
      >
        {{ $t("parameters.onlyChanged") }}
        <span v-if="changedCount" class="params__count">{{ changedCount }}</span>
      </button>
      <button
        v-if="mode === 'edit'"
        type="button"
        class="btn btn--ghost params__reset"
        :disabled="!changedCount"
        @click="resetting = true"
      >
        {{ $t("parameters.resetAll") }}
      </button>
    </div>

    <p v-if="!shownGroups.length" class="muted">{{ $t("parameters.noMatch") }}</p>

    <section v-for="(g, i) in shownGroups" :key="g.key" class="group" :class="{ 'group--flat': !grouped }">
      <h3 v-if="grouped" class="group__heading">
        <button
          type="button"
          class="group__toggle"
          :aria-expanded="isOpen(g)"
          :aria-controls="`${id}-g${i}`"
          :disabled="filtering"
          @click="toggle(g)"
        >
          <AppIcon name="chevronDown" class="group__chevron" :size="16" />
          <span class="group__title">{{ g.title }}</span>
          <span class="muted group__meta">{{ $t("parameters.count", g.params.length) }}</span>
          <span v-if="changedIn.get(g.key)" class="pill tone-warning">
            {{ $t("parameters.changedCount", { count: changedIn.get(g.key) }) }}
          </span>
          <span v-if="issuesIn(g)" class="pill tone-negative">
            {{ $t("parameters.issueCount", issuesIn(g)) }}
          </span>
        </button>
      </h3>

      <!-- Closed groups stay in the page, so the form can still read and focus their fields. -->
      <div v-show="isOpen(g)" :id="`${id}-g${i}`" class="group__rows">
        <template v-if="mode === 'edit'">
          <ParameterField
            v-for="p in visible(g)"
            :key="p.name"
            :model-value="value(p)"
            :param="p"
            :issue="issues?.get(p.name)"
            :symbols-list="symbolsList"
            :periods-list="periodsList"
            @update:model-value="update(p.name, $event)"
          />
        </template>
        <dl v-else class="rows">
          <div v-for="p in visible(g)" :key="p.name" class="row">
            <dt class="row__name">
              <ParameterName
                :label="p.label ?? p.name"
                :detail="
                  mode === 'schema' ? (p.label ? `${p.name} · ${p.type}` : p.type) : p.label ? p.name : undefined
                "
              />
            </dt>
            <dd v-if="mode === 'view'" class="row__value">
              <span class="mono">{{ show(value(p)) }}</span>
              <!-- Changed: sign and text, the default in the tooltip and for screen readers. -->
              <span
                v-if="isChanged(p)"
                class="pill tone-warning"
                :data-tooltip="$t('parameters.default', { value: String(p.default) })"
              >
                {{ $t("instanceForm.changed") }}
                <span class="visually-hidden">{{ $t("parameters.default", { value: String(p.default) }) }}</span>
              </span>
            </dd>
            <dd v-else class="row__value">
              <span class="mono">{{ show(p.default) }}</span>
              <span v-if="range(p)" class="mono muted row__range">{{ range(p) }}</span>
            </dd>
          </div>
        </dl>
      </div>
    </section>

    <ConfirmDialog
      v-if="mode === 'edit'"
      :open="resetting"
      :title="$t('parameters.resetAll')"
      :message="$t('parameters.resetAllConfirm', { count: changedCount })"
      :confirm-label="$t('parameters.resetAll')"
      @confirm="resetAll"
      @cancel="resetting = false"
    />
  </div>
</template>

<style scoped>
.params {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-3);
  min-width: 0;
}

.params__bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
  align-items: center;
}

.params__search {
  position: relative;
  display: flex;
  flex: 1 1 240px;
  max-width: 360px;
  align-items: center;
  color: var(--ww-text-muted);
}

.params__search .icon {
  position: absolute;
  left: var(--ww-space-3);
  pointer-events: none;
}

.params__search .input {
  width: 100%;
  padding-left: calc(var(--ww-space-3) + 16px + var(--ww-space-2));
}

.params__count {
  min-width: 1.5em;
  padding: 0 6px;
  border-radius: var(--ww-radius-full);
  background: var(--ww-warning-bg);
  color: var(--ww-warning);
  font-size: var(--ww-size-xs);
  font-weight: 700;
}

.params__reset {
  margin-left: auto;
}

.group {
  border-top: 1px solid var(--ww-border);
}

.group--flat {
  border-top: 0;
}

.group__heading {
  margin: 0;
  font-size: var(--ww-size-md);
}

.group__toggle {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2) var(--ww-space-3);
  align-items: center;
  width: 100%;
  min-height: var(--ww-touch-target);
  padding: var(--ww-space-2) 0;
  border: 0;
  background: none;
  color: var(--ww-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.group__toggle:disabled {
  cursor: default;
}

.group__chevron {
  transform: rotate(-90deg);
  transition: transform 0.15s;
}

.group__toggle[aria-expanded="true"] .group__chevron {
  transform: none;
}

.group__title {
  font-weight: 600;
}

.group__meta {
  font-size: var(--ww-size-xs);
  font-weight: 400;
}

/* Two columns of rows on wide screens, one below. */
.group__rows,
.rows {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  column-gap: var(--ww-space-8);
  margin: 0;
}

.group__rows:has(> .rows) {
  display: block;
}

@media (min-width: 1200px) {
  .group__rows,
  .rows {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--ww-space-4);
  align-items: baseline;
  padding: var(--ww-space-2) 0;
  border-bottom: 1px solid var(--ww-border);
  font-size: var(--ww-size-sm);
}

.row__name {
  min-width: 0;
}

.row__value {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
  align-items: center;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.row__range {
  font-size: var(--ww-size-xs);
}

@media (max-width: 640px) {
  .row {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--ww-space-1);
  }
}
</style>
