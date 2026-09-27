<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { api, errorKey, type TotpSetup } from "../api";
import AuthCard from "../components/AuthCard.vue";
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

const start = () =>
  run(async () => {
    totp.value = await api.setupTotp({ token: token.value.trim(), username: username.value });
  });

const finish = () =>
  run(async () => {
    if (passwordProblem.value) return;
    await api.setup({
      token: token.value.trim(),
      username: username.value,
      password: password.value,
      code: code.value,
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

    <form v-if="!totp" class="form" @submit.prevent="start">
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
      <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      <button type="submit" class="btn btn--primary" :disabled="busy">{{ $t("auth.setup.next") }}</button>
    </form>

    <form v-else class="form" @submit.prevent="finish">
      <p class="muted">{{ $t("auth.setup.scan") }}</p>
      <img class="qr" :src="totp.qr" :alt="$t('auth.setup.qrAlt')" width="240" height="240" />
      <details>
        <summary>{{ $t("auth.setup.manual") }}</summary>
        <code class="mono secret">{{ totp.secret }}</code>
      </details>
      <label class="field">
        {{ $t("auth.password") }}
        <input v-model="password" class="input" type="password" autocomplete="new-password" required />
        <span class="field__hint">{{ $t("auth.setup.passwordHint", { min: MIN_PASSWORD_LENGTH }) }}</span>
      </label>
      <label class="field">
        {{ $t("auth.setup.repeat") }}
        <input v-model="repeat" class="input" type="password" autocomplete="new-password" required />
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
      </label>
      <p v-if="passwordProblem" class="tone-warning">{{ $t(passwordProblem, { min: MIN_PASSWORD_LENGTH }) }}</p>
      <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      <button type="submit" class="btn btn--primary" :disabled="busy || !!passwordProblem">
        {{ $t("auth.setup.finish") }}
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

.qr {
  align-self: center;
  border-radius: var(--ww-radius-md);
}

.secret {
  display: block;
  margin-top: var(--ww-space-2);
  word-break: break-all;
}
</style>
