<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, errorKey } from "../api";
import AuthCard from "../components/AuthCard.vue";
import { loadSession, session } from "../session";

const router = useRouter();
const route = useRoute();
const username = ref("");
const password = ref("");
const code = ref("");
const error = ref<string>();
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = undefined;
  try {
    await api.login({ username: username.value, password: password.value, code: code.value });
    await loadSession();
    const redirect = typeof route.query["redirect"] === "string" ? route.query["redirect"] : "/";
    await router.replace(redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/");
  } catch (e) {
    error.value = errorKey(e);
    code.value = "";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthCard :title="$t('auth.login.title')">
    <p v-if="session && !session.masterKeyConfigured" class="tone-negative" role="alert">
      {{ $t("auth.masterKeyMissing") }}
    </p>
    <form class="form" @submit.prevent="submit">
      <label class="field">
        {{ $t("auth.username") }}
        <input v-model="username" class="input" autocomplete="username" required autofocus />
      </label>
      <label class="field">
        {{ $t("auth.password") }}
        <input v-model="password" class="input" type="password" autocomplete="current-password" required />
      </label>
      <label class="field">
        {{ $t("auth.code") }}
        <input
          v-model="code"
          class="input mono"
          autocomplete="one-time-code"
          inputmode="numeric"
          pattern="[0-9 ]{6,8}"
          maxlength="8"
          required
        />
        <span class="field__hint">{{ $t("auth.codeHint") }}</span>
      </label>
      <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      <button type="submit" class="btn btn--primary" :disabled="busy">{{ $t("auth.login.submit") }}</button>
    </form>
  </AuthCard>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
}

p {
  margin: 0;
}
</style>
