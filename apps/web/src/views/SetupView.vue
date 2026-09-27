<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { api, errorKey, type TotpSetup } from "../api";
import AuthCard from "../components/AuthCard.vue";
import CodeInput from "../components/CodeInput.vue";
import TotpEnroll from "../components/TotpEnroll.vue";
import { loadSession, session } from "../session";

const MIN_PASSWORD_LENGTH = 12;

const router = useRouter();
const token = ref("");
const username = ref("admin");
const password = ref("");
const repeat = ref("");
const code = ref("");
const totp = ref<TotpSetup>();
const error = ref<string>();
const busy = ref(false);

const passwordProblem = computed(() => {
  if (password.value && password.value.length < MIN_PASSWORD_LENGTH) return "auth.setup.passwordTooShort";
  if (repeat.value && repeat.value !== password.value) return "auth.setup.passwordMismatch";
  return undefined;
});

async function run(action: () => Promise<void>) {
  busy.value = true;
  error.value = undefined;
  try {
    await action();
  } catch (e) {
    error.value = errorKey(e);
  } finally {
    busy.value = false;
  }
}

/** Step 1: checks the token and gets the QR code for the optional 2FA step. */
const next = () =>
  run(async () => {
    if (passwordProblem.value) return;
    totp.value = await api.setupTotp({ token: token.value.trim(), username: username.value });
  });

/** Step 2: with a code 2FA is enabled; without, it is skipped. */
const finish = (withCode: boolean) =>
  run(async () => {
    await api.setup({
      token: token.value.trim(),
      username: username.value,
      password: password.value,
      ...(withCode ? { code: code.value } : {}),
    });
    await loadSession();
    await router.replace("/");
  });
</script>

<template>
  <AuthCard :title="$t('auth.setup.title')">
    <p v-if="session && !session.masterKeyConfigured" class="tone-negative" role="alert">
      {{ $t("auth.masterKeyMissing") }}
    </p>

    <form v-if="!totp" class="form" @submit.prevent="next">
      <p class="muted">{{ $t("auth.setup.intro") }}</p>
      <label class="field">
        {{ $t("auth.setup.token") }}
        <input v-model="token" class="input mono" autocomplete="off" required autofocus />
        <span class="field__hint">{{ $t("auth.setup.tokenHint") }}</span>
      </label>
      <label class="field">
        {{ $t("auth.username") }}
        <input v-model="username" class="input" autocomplete="username" pattern="[A-Za-z0-9._@\-]+" required />
      </label>
      <label class="field">
        {{ $t("auth.password") }}
        <input v-model="password" class="input" type="password" autocomplete="new-password" required />
        <span class="field__hint">{{ $t("auth.setup.passwordHint", { min: MIN_PASSWORD_LENGTH }) }}</span>
      </label>
      <label class="field">
        {{ $t("auth.setup.repeat") }}
        <input v-model="repeat" class="input" type="password" autocomplete="new-password" required />
      </label>
      <p v-if="passwordProblem" class="tone-warning">{{ $t(passwordProblem, { min: MIN_PASSWORD_LENGTH }) }}</p>
      <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      <button type="submit" class="btn btn--primary" :disabled="busy || !!passwordProblem">
        {{ $t("auth.setup.next") }}
      </button>
    </form>

    <form v-else class="form" @submit.prevent="finish(true)">
      <h2>{{ $t("auth.totp.title") }}</h2>
      <p class="muted">{{ $t("auth.totp.recommended") }}</p>
      <TotpEnroll :totp="totp" />
      <CodeInput v-model="code" :label="$t('auth.code')" required />
      <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      <button type="submit" class="btn btn--primary" :disabled="busy">{{ $t("auth.setup.finishWithTotp") }}</button>
      <button type="button" class="btn btn--ghost" :disabled="busy" @click="finish(false)">
        {{ $t("auth.setup.skipTotp") }}
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

h2 {
  font-size: var(--ww-size-lg);
}
</style>
