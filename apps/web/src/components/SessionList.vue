<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, type LoginSession } from "../api";
import { useAsyncAction } from "../composables/useAsyncAction";
import { deviceName, formatDateTime } from "../format";
import AppSpinner from "./AppSpinner.vue";

/** The logged-in user's sessions in the profile; any but this one can be logged out, e.g. on a lost device. */
const { t, locale } = useI18n();
const sessions = ref<LoginSession[]>();

async function load() {
  sessions.value = await api.sessions();
}
const { busy, running, error, notice, run } = useAsyncAction({ reload: load });
const others = computed(() => sessions.value?.filter((s) => !s.current).length ?? 0);

onMounted(() => void run(async () => undefined));

const end = (s: LoginSession) =>
  run(() => api.endSession(s.id), { done: () => t("profile.sessions.ended"), as: `end-${s.id}` });
const endOthers = () =>
  run(() => api.endOtherSessions(), { done: () => t("profile.sessions.endedOthers"), as: "others" });
</script>

<template>
  <section class="panel card" aria-labelledby="sessions-title">
    <div class="card__head">
      <h2 id="sessions-title">{{ $t("profile.sessions.title") }}</h2>
      <button
        type="button"
        class="btn btn--small"
        :disabled="busy || others === 0"
        :aria-busy="running === 'others'"
        @click="endOthers"
      >
        {{ $t("profile.sessions.endOthers") }}
      </button>
    </div>
    <p class="muted">{{ $t("profile.sessions.hint") }}</p>
    <p class="status" role="status" aria-live="polite">{{ notice }}</p>
    <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
    <AppSpinner v-if="!sessions && !error" />
    <ul v-else-if="sessions" class="sessions">
      <li v-for="s in sessions" :key="s.id" class="session">
        <div class="session__what">
          <span class="session__device">{{ deviceName(s.userAgent) ?? $t("profile.sessions.unknownDevice") }}</span>
          <span class="muted session__times">
            {{
              $t("profile.sessions.times", {
                since: formatDateTime(locale, s.createdAt),
                until: formatDateTime(locale, s.expiresAt),
              })
            }}
            <template v-if="s.remember"> · {{ $t("profile.sessions.remembered") }}</template>
          </span>
        </div>
        <span v-if="s.current" class="pill tone-positive">{{ $t("profile.sessions.current") }}</span>
        <button
          v-else
          type="button"
          class="btn btn--small"
          :disabled="busy"
          :aria-busy="running === `end-${s.id}`"
          @click="end(s)"
        >
          {{ $t("profile.sessions.end") }}
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
  padding: var(--ww-space-6);
}

.card__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  justify-content: space-between;
  align-items: center;
}

h2 {
  font-size: var(--ww-size-lg);
}

p {
  margin: 0;
}

.sessions {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.session {
  display: flex;
  gap: var(--ww-space-3);
  justify-content: space-between;
  align-items: center;
  padding: var(--ww-space-3) 0;
  border-top: 1px solid var(--ww-border);
}

.session__what {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-1);
  min-width: 0;
}

.session__device {
  font-weight: 600;
}

.session__times {
  font-size: var(--ww-size-xs);
}

@media (max-width: 640px) {
  .card__head > .btn {
    width: 100%;
  }
}
</style>
