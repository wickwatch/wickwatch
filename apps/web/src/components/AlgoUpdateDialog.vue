<script setup lang="ts">
import type { Algo, AlgoRollout, AlgoUpdateCandidate, AlgoUpdatePreview, ParameterIssue } from "@wickwatch/core";
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { useAsyncAction } from "../composables/useAsyncAction";
import { accountLabel } from "../format";
import { parameterTitle } from "../parameter-label";
import AppModal from "./AppModal.vue";

/**
 * Moves the instances on other versions of an algo to this one: a preview per instance of what happens to its
 * parameters, a choice of instances, then a new configuration version for each, optionally deployed afterwards in the
 * background (as "update all" for the platform image). No extra ConfirmDialog: this modal is already the step that
 * shows what happens, and deploying is a box to tick with its consequences spelled out next to it.
 */
const props = defineProps<{
  open: boolean;
  algo: Algo;
  /** All uploaded versions, for the labels of parameters a version dropped. */
  algos: Algo[];
}>();
const emit = defineEmits<{ close: []; done: [] }>();
/** How often the dialog asks again while the rollout runs. */
const POLL_MS = 2000;
const { t } = useI18n();
const { busy, error, run } = useAsyncAction();

const preview = ref<AlgoUpdatePreview>();
const chosen = ref(new Set<string>());
const deploy = ref(false);
const comment = ref("");
/** What the save did, once it ran. */
const result = ref<{ saved: string[]; failed: { name: string; error: string }[] }>();
const rollout = ref<AlgoRollout>();
/** Whether `rollout` was started by this dialog's save; only then does the result list what it deployed. */
const ownRollout = ref(false);

const candidates = computed(() => preview.value?.instances ?? []);
const movable = (c: AlgoUpdateCandidate) => !c.issues.length;
const selected = computed(() => candidates.value.filter((c) => chosen.value.has(c.name)));
const anyDeployed = computed(() => selected.value.some((c) => c.deployed));
const rolling = computed(() => rollout.value?.running === true);
let timer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => clearTimeout(timer));

watch(
  () => props.open,
  (open) => {
    clearTimeout(timer);
    if (!open) return;
    preview.value = undefined;
    result.value = undefined;
    ownRollout.value = false;
    deploy.value = false;
    comment.value = t("algoUpdate.comment", { version: props.algo.version });
    void run(async () => {
      const [loaded, progress] = await Promise.all([api.algoUpdatePreview(props.algo.id), api.algoRollout()]);
      preview.value = loaded;
      // All that can move, at first; those that need a manual edit cannot be chosen.
      chosen.value = new Set(loaded.instances.filter(movable).map((c) => c.name));
      rollout.value = progress.rollout;
      poll();
    });
  },
  // The page mounts the dialog already open.
  { immediate: true },
);

function poll() {
  clearTimeout(timer);
  if (!rolling.value) return;
  timer = setTimeout(() => {
    void api
      .algoRollout()
      .then((p) => (rollout.value = p.rollout))
      .catch(() => undefined)
      .finally(poll);
  }, POLL_MS);
}

function toggle(name: string, on: boolean) {
  const next = new Set(chosen.value);
  if (on) next.add(name);
  else next.delete(name);
  chosen.value = next;
}

const schemaOf = (id: number | null) => props.algos.find((a) => a.id === id)?.parameters ?? [];
const label = (name: string) => parameterTitle(props.algo.parameters, name);
const names = (list: string[], schema = props.algo.parameters) => list.map((n) => parameterTitle(schema, n)).join(", ");
const issues = (list: ParameterIssue[]) =>
  list.map((i) => `${label(i.parameter)} (${t(`parameterIssue.${i.code}`)})`).join(", ");
const show = (value: unknown) => (value === undefined || value === "" ? t("format.none") : String(value));
const newDefaults = (c: AlgoUpdateCandidate) =>
  c.newDefaults
    .map((d) => `${label(d.parameter)} ${t("format.fromTo", { from: show(d.from), to: show(d.to) })}`)
    .join(", ");

const progress = computed(() => {
  const r = rollout.value;
  if (!r?.running) return "";
  const done = r.updated.length + r.skipped.length;
  const total = done + r.pending.length + (r.current ? 1 : 0);
  return r.current
    ? t("algoUpdate.deploying", { done, total, name: r.current })
    : t("algoUpdate.deployingStart", { total });
});
const rolloutResult = computed(() => {
  const r = rollout.value;
  if (!r || r.running || !ownRollout.value) return [];
  const lines = r.updated.length ? [t("algoUpdate.deployed", { names: r.updated.join(", ") })] : [];
  for (const s of r.skipped) {
    lines.push(t(`platform.skipped.${s.reason}`, { name: s.name, error: s.error ? t(`error.api.${s.error}`) : "" }));
  }
  return lines;
});

function save() {
  const instances = selected.value.map((c) => c.name);
  if (!instances.length) return;
  const rollOut = deploy.value && anyDeployed.value;
  void run(async () => {
    const done = await api.updateAlgo({
      algoId: props.algo.id,
      instances,
      ...(rollOut ? { deploy: true, confirm: "all" } : {}),
      ...(comment.value.trim() ? { comment: comment.value.trim() } : {}),
    });
    result.value = { saved: done.saved, failed: done.failed };
    if (done.rollout) {
      rollout.value = done.rollout;
      ownRollout.value = true;
      poll();
    }
    emit("done");
  });
}
</script>

<template>
  <AppModal
    :open="open"
    :title="$t('algoUpdate.title', { name: algo.name, version: algo.version })"
    @close="emit('close')"
  >
    <template #default="{ close }">
      <div class="form">
        <p v-if="rolling" role="status" aria-live="polite">{{ progress }}</p>

        <template v-if="result">
          <div role="status" class="notes">
            <p v-if="result.saved.length" class="tone-positive">
              {{ $t("algoUpdate.saved", { names: result.saved.join(", "), version: algo.version }) }}
            </p>
            <p v-for="f in result.failed" :key="f.name" class="tone-negative">
              {{ $t("algoUpdate.failed", { name: f.name, error: $t(`error.api.${f.error}`) }) }}
            </p>
            <p v-if="result.saved.length && !ownRollout" class="muted">
              {{ $t("algoUpdate.notDeployed") }}
            </p>
            <p v-for="line in rolloutResult" :key="line">{{ line }}</p>
          </div>
          <div class="buttons">
            <button type="button" class="btn" @click="close()">{{ $t("action.done") }}</button>
          </div>
        </template>

        <form v-else-if="preview" class="form" novalidate @submit.prevent="save">
          <p v-if="!candidates.length" class="muted">
            {{ $t("algoUpdate.none", { name: algo.name, version: algo.version }) }}
          </p>
          <template v-else>
            <p class="muted hint">{{ $t("algoUpdate.intro") }}</p>
            <fieldset class="candidates">
              <legend>{{ $t("algoUpdate.instances", candidates.length) }}</legend>
              <label v-for="c in candidates" :key="c.name" class="candidate" :class="{ 'candidate--off': !movable(c) }">
                <input
                  type="checkbox"
                  :checked="chosen.has(c.name)"
                  :disabled="!movable(c)"
                  @change="toggle(c.name, ($event.target as HTMLInputElement).checked)"
                />
                <span class="candidate__body">
                  <span class="candidate__head">
                    <strong class="mono">{{ c.name }}</strong>
                    <span class="muted">{{ accountLabel(c.account) }}</span>
                    <span class="mono">{{ $t("format.fromTo", { from: c.from.version, to: algo.version }) }}</span>
                    <span v-if="c.deployed" class="pill tone-muted">{{ $t("algoUpdate.inContainer") }}</span>
                  </span>
                  <span v-if="c.added.length" class="detail">{{
                    $t("algoUpdate.added", { names: names(c.added) })
                  }}</span>
                  <span v-if="c.dropped.length" class="detail">
                    {{ $t("algoUpdate.dropped", { names: names(c.dropped, schemaOf(c.from.id)) }) }}
                  </span>
                  <span v-if="c.newDefaults.length" class="detail">
                    {{ $t("algoUpdate.newDefaults", { changes: newDefaults(c) }) }}
                  </span>
                  <span v-if="c.rejected.length" class="detail tone-warning">
                    {{ $t("algoUpdate.rejected", { names: issues(c.rejected) }) }}
                  </span>
                  <span v-if="c.issues.length" class="detail tone-negative">
                    {{ $t("algoUpdate.issues", { names: issues(c.issues) }) }}
                  </span>
                  <span
                    v-if="
                      !c.added.length && !c.dropped.length && !c.newDefaults.length && !c.rejected.length && movable(c)
                    "
                    class="detail muted"
                  >
                    {{ $t("algoUpdate.unchanged") }}
                  </span>
                </span>
              </label>
            </fieldset>

            <label class="field">
              {{ $t("instanceForm.comment") }}
              <input v-model="comment" class="input" maxlength="500" autocomplete="off" />
            </label>

            <label v-if="anyDeployed" class="check">
              <input v-model="deploy" type="checkbox" :disabled="rolling" />
              <span>
                {{ $t("algoUpdate.deploy") }}
                <span class="muted hint check__hint">{{ $t("algoUpdate.deployHint") }}</span>
              </span>
            </label>
          </template>

          <div class="buttons">
            <button
              v-if="candidates.length"
              type="submit"
              class="btn btn--primary"
              :disabled="busy || !selected.length"
              :aria-busy="busy"
            >
              {{
                deploy && anyDeployed
                  ? $t("algoUpdate.saveDeploy", selected.length)
                  : $t("algoUpdate.save", selected.length)
              }}
            </button>
            <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.cancel") }}</button>
          </div>
        </form>
        <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
  min-width: 0;
}

.form p {
  margin: 0;
}

.hint,
.notes {
  font-size: var(--ww-size-xs);
}

.notes {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-1);
  font-size: var(--ww-size-sm);
}

.candidates {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.candidates legend {
  margin-bottom: var(--ww-space-1);
  padding: 0;
  font-size: var(--ww-size-sm);
  font-weight: 600;
}

.candidate {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--ww-space-3);
  align-items: baseline;
  padding: var(--ww-space-2) 0;
  border-top: 1px solid var(--ww-border);
  font-size: var(--ww-size-sm);
  cursor: pointer;
}

.candidate--off {
  cursor: default;
}

.candidate input,
.check input {
  accent-color: var(--ww-accent);
}

.candidate__body {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-1);
  min-width: 0;
}

.candidate__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
  align-items: baseline;
}

.detail {
  font-size: var(--ww-size-xs);
  overflow-wrap: anywhere;
}

.check {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--ww-space-3);
  align-items: baseline;
  font-size: var(--ww-size-sm);
  cursor: pointer;
}

.check__hint {
  display: block;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}
</style>
