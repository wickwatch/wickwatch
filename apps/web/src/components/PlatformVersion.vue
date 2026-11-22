<script setup lang="ts">
import type { ImageRollout, ManagedInstance, PlatformInfo } from "@wickwatch/core";
import { splitImage } from "@wickwatch/core/rules";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, codeKey } from "../api";
import { useAsyncAction } from "../composables/useAsyncAction";
import { formatDateTime } from "../format";
import { isAdmin } from "../session";
import ConfirmDialog from "./ConfirmDialog.vue";

/**
 * The platform version new instances run on (for a platform that ships as an image), the versions to choose from, and
 * the instances still on another one, to update them all at once. Also wickwatch's own version.
 */
/** How often the card asks again while an image downloads or "update all" runs. */
const POLL_MS = 2000;
const { t, locale } = useI18n();
const { busy, running, error, notice, run } = useAsyncAction();
const info = ref<PlatformInfo>();
const instances = ref<ManagedInstance[]>([]);
const rollout = ref<ImageRollout>();
const chosen = ref("");
const confirming = ref(false);

const tagOf = (image: string) => splitImage(image).tag ?? image;
const platform = computed(() => info.value?.platform);
const current = computed(() => (platform.value ? tagOf(platform.value.image) : ""));
watch(current, (tag) => (chosen.value = tag), { immediate: true });
/** The registry's versions, and the one in use even when the registry does not list it (or was not asked). */
const versions = computed(() => {
  const list = platform.value?.versions ?? [];
  return list.includes(current.value) || !current.value ? list : [current.value, ...list];
});
/** Instances wickwatch deployed on another image than new ones get. */
const outdated = computed(() =>
  instances.value.filter(
    (i) => i.deployment?.managed && i.deployment.image && i.deployment.image !== platform.value?.image,
  ),
);
const outdatedText = computed(() =>
  outdated.value.map((i) => `${i.name} (${tagOf(i.deployment?.image ?? "")})`).join(", "),
);
const checked = computed(() => {
  if (!info.value?.updateCheck) return t("platform.checkOff");
  const at = platform.value?.checkedAt;
  return at ? t("platform.checkedAt", { time: formatDateTime(locale.value, at) }) : t("platform.notChecked");
});
const wickwatchText = computed(() => {
  const own = info.value?.wickwatch;
  if (!own) return "";
  if (own.latest) return t("platform.wickwatchLatest", { version: own.current, latest: own.latest });
  return t(own.checkedAt ? "platform.wickwatchNewest" : "platform.wickwatch", { version: own.current });
});
const updating = computed(() => rollout.value?.running === true);
const progress = computed(() => {
  const r = rollout.value;
  if (!r?.running) return "";
  const done = r.updated.length + r.skipped.length;
  const total = done + r.pending.length + (r.current ? 1 : 0);
  const version = tagOf(r.image);
  return r.current
    ? t("platform.updating", { version, done, total, name: r.current })
    : t("platform.updatingStart", { version });
});

function resultText(r: ImageRollout): string {
  const version = tagOf(r.image);
  const parts = [
    r.updated.length ? t("platform.updated", { names: r.updated.join(", "), version }) : t("platform.nothingUpdated"),
  ];
  for (const s of r.skipped) {
    parts.push(t(`platform.skipped.${s.reason}`, { name: s.name, error: s.error ? t(codeKey(s.error)) : "" }));
  }
  return parts.join(" ");
}

let timer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => clearTimeout(timer));

/** Asks again while something runs in the background; says what "update all" did once it is done. */
function poll() {
  clearTimeout(timer);
  if (!updating.value && platform.value?.download !== "running") return;
  timer = setTimeout(() => {
    void (async () => {
      const wasUpdating = updating.value;
      try {
        await load();
      } catch {
        // Tried again with the next round.
      }
      if (wasUpdating && rollout.value && !rollout.value.running) notice.value = resultText(rollout.value);
      poll();
    })();
  }, POLL_MS);
}

async function load() {
  const [platformInfo, list, progressed] = await Promise.all([
    api.platform(),
    api.managedInstances(),
    api.imageRollout(),
  ]);
  info.value = platformInfo;
  instances.value = list;
  rollout.value = progressed.rollout;
}
onMounted(() => void run(load).then(poll));

function save() {
  const repository = platform.value?.repository;
  if (!repository) return;
  void run(
    async () => {
      info.value = await api.setPlatformImage(`${repository}:${chosen.value}`);
    },
    { done: () => t("platform.saved", { version: chosen.value }), as: "save" },
  ).then(poll);
}

function updateAll() {
  confirming.value = false;
  void run(
    async () => {
      rollout.value = await api.updateAllImages();
    },
    { as: "update" },
  ).then(poll);
}
</script>

<template>
  <section v-if="info" class="panel card" aria-labelledby="platform-title">
    <h2 id="platform-title">{{ $t("platform.title") }}</h2>
    <template v-if="platform">
      <p>
        {{ $t("platform.inUse", { version: current }) }}
        <span class="mono muted">{{ platform.repository }}</span>
      </p>
      <p v-if="platform.latest">
        <strong>{{ $t("platform.latest", { version: platform.latest }) }}</strong>
      </p>
      <p class="muted hint">{{ checked }}</p>
      <p v-if="platform.download === 'running'" role="status">{{ $t("platform.downloading", { version: current }) }}</p>
      <p v-else-if="platform.download === 'failed'" class="tone-negative" role="alert">
        {{ $t("platform.downloadFailed", { version: current }) }}
      </p>
      <p class="muted hint">{{ $t("platform.hint") }}</p>
      <form v-if="isAdmin" class="row" novalidate @submit.prevent="save">
        <label class="field">
          {{ $t("platform.version") }}
          <select v-model="chosen" class="input">
            <option v-for="v in versions" :key="v" :value="v">{{ v }}</option>
          </select>
        </label>
        <button
          type="submit"
          class="btn"
          :disabled="busy || updating || chosen === current"
          :aria-busy="running === 'save'"
        >
          {{ $t("action.save") }}
        </button>
      </form>
      <p v-if="updating" role="status" aria-live="polite">{{ progress }}</p>
      <template v-else-if="outdated.length">
        <p>{{ $t("platform.outdated", { count: outdated.length, names: outdatedText }, outdated.length) }}</p>
        <div v-if="isAdmin">
          <button
            type="button"
            class="btn btn--primary"
            :disabled="busy"
            :aria-busy="running === 'update'"
            @click="confirming = true"
          >
            {{ $t("platform.updateAll", { version: current }) }}
          </button>
        </div>
      </template>
    </template>
    <p class="muted hint">{{ wickwatchText }}</p>
    <p v-if="notice" class="tone-positive" role="status">{{ notice }}</p>
    <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
    <ConfirmDialog
      v-if="isAdmin"
      :open="confirming"
      :title="$t('platform.updateAll', { version: current })"
      :message="$t('platform.confirmUpdateAll', { names: outdated.map((i) => i.name).join(', '), version: current })"
      :confirm-label="$t('platform.updateAll', { version: current })"
      @confirm="updateAll"
      @cancel="confirming = false"
    />
  </section>
</template>

<style scoped>
.card p {
  margin: 0;
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  align-items: end;
}

.hint {
  font-size: var(--ww-size-xs);
}

/* A long registry path wraps on phones instead of running off the card. */
.mono {
  overflow-wrap: anywhere;
}
</style>
