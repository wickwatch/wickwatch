<script setup lang="ts">
import { nextTick, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError, errorKey } from "../api";
import AuthCard from "../components/AuthCard.vue";
import CodeInput from "../components/CodeInput.vue";
import { loadSession, session } from "../session";

const router = useRouter();
const route = useRoute();
const username = ref("");
const password = ref("");
const code = ref("");
/** Shown once the server says 2FA is enabled for this user. */
const needsCode = ref(false);
const error = ref<string>();
const busy = ref(false);
const form = ref<HTMLFormElement>();

async function submit() {
  busy.value = true;
  error.value = undefined;
  try {
    await api.login({
      username: username.value,
      password: password.value,
      ...(needsCode.value ? { code: code.value } : {}),
    });
    await loadSession();
    const redirect = typeof route.query["redirect"] === "string" ? route.query["redirect"] : "/";
    await router.replace(redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/");
  } catch (e) {
    if (e instanceof ApiError && e.code === "totp_required") {
      needsCode.value = true;
      await nextTick();
      form.value?.querySelector<HTMLInputElement>("[autocomplete=one-time-code]")?.focus();
    } else {
      error.value = errorKey(e);
      code.value = "";
    }
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
    <form ref="form" class="form" @submit.prevent="submit">
      <label class="field">
        {{ $t("auth.username") }}
        <input v-model="username" class="input" autocomplete="username" required autofocus :readonly="needsCode" />
      </label>
      <label class="field">
        {{ $t("auth.password") }}
        <input
          v-model="password"
          class="input"
          type="password"
          autocomplete="current-password"
          required
          :readonly="needsCode"
        />
      </label>
      <CodeInput v-if="needsCode" v-model="code" :label="$t('auth.code')" :hint="$t('auth.codeHint')" required />
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
