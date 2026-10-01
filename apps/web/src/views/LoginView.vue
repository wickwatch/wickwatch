<script setup lang="ts">
import { nextTick, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError, errorKey } from "../api";
import AuthCard from "../components/AuthCard.vue";
import CodeInput from "../components/CodeInput.vue";
import FieldError from "../components/FieldError.vue";
import { loadSession, session } from "../session";
import { checks, useValidation } from "../validation";

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
const v = useValidation();
const usernameField = v.field(() => username.value, checks.required);
const passwordField = v.field(() => password.value, checks.required);
const codeField = v.field(
  () => code.value,
  (value) => (needsCode.value ? checks.required(value) : undefined),
  (value) => (needsCode.value ? checks.code(value) : undefined),
);

async function submit() {
  // The code field appears after the first attempt; it is checked only from then on.
  if (!v.validate()) return;
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
    <form ref="form" class="form" novalidate @submit.prevent="submit">
      <label class="field">
        {{ $t("auth.username") }}
        <input
          v-model.trim="username"
          v-bind="usernameField.attrs.value"
          class="input"
          autocomplete="username"
          autocapitalize="off"
          spellcheck="false"
          required
          autofocus
          :readonly="needsCode"
        />
        <FieldError :field="usernameField" />
      </label>
      <label class="field">
        {{ $t("auth.password") }}
        <input
          v-model="password"
          v-bind="passwordField.attrs.value"
          class="input"
          type="password"
          autocomplete="current-password"
          required
          :readonly="needsCode"
        />
        <FieldError :field="passwordField" />
      </label>
      <CodeInput
        v-if="needsCode"
        v-model="code"
        :label="$t('auth.code')"
        :hint="$t('auth.codeHint')"
        :field="codeField"
        required
      />
      <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      <button type="submit" class="btn btn--primary" :disabled="busy" :aria-busy="busy">
        {{ $t("auth.login.submit") }}
      </button>
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
