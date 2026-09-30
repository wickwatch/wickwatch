<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api, type TotpSetup } from "../api";
import AuthCard from "../components/AuthCard.vue";
import CodeInput from "../components/CodeInput.vue";
import FieldError from "../components/FieldError.vue";
import TotpEnroll from "../components/TotpEnroll.vue";
import { useAsyncAction } from "../composables/useAsyncAction";
import { loadSession, session } from "../session";
import { MIN_PASSWORD_LENGTH, checks, normalizers, useValidation, vNormalize } from "../validation";

const router = useRouter();
const token = ref("");
const username = ref("admin");
const password = ref("");
const repeat = ref("");
const code = ref("");
const totp = ref<TotpSetup>();
const { busy, error, run } = useAsyncAction();

const step1 = useValidation();
const fields = {
  token: step1.field(() => token.value, checks.required),
  username: step1.field(() => username.value, checks.required, checks.username),
  password: step1.field(() => password.value, checks.required, checks.minLength(MIN_PASSWORD_LENGTH)),
  repeat: step1.field(
    () => repeat.value,
    checks.required,
    checks.sameAs(() => password.value),
  ),
};
const step2 = useValidation();
const codeField = step2.field(() => code.value, checks.required, checks.code);

/** Step 1: checks the token and gets the QR code for the optional 2FA step. */
const next = () =>
  run(async () => {
    if (!step1.validate()) return;
    totp.value = await api.setupTotp({ token: token.value.trim(), username: username.value });
  });

/** Step 2: with a code 2FA is enabled; without, it is skipped. */
const finish = (withCode: boolean) =>
  run(async () => {
    if (withCode && !step2.validate()) return;
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

    <form v-if="!totp" class="form" novalidate @submit.prevent="next">
      <p class="muted">{{ $t("auth.setup.intro") }}</p>
      <label class="field">
        {{ $t("auth.setup.token") }}
        <input
          v-model="token"
          v-normalize="normalizers.noSpaces"
          v-bind="fields.token.attrs.value"
          class="input mono"
          autocomplete="off"
          spellcheck="false"
          required
          autofocus
        />
        <FieldError :field="fields.token" />
        <span class="field__hint">{{ $t("auth.setup.tokenHint") }}</span>
      </label>
      <label class="field">
        {{ $t("auth.username") }}
        <input
          v-model="username"
          v-normalize="normalizers.noSpaces"
          v-bind="fields.username.attrs.value"
          class="input"
          autocomplete="username"
          autocapitalize="off"
          spellcheck="false"
          required
        />
        <FieldError :field="fields.username" />
      </label>
      <label class="field">
        {{ $t("auth.password") }}
        <input
          v-model="password"
          v-bind="fields.password.attrs.value"
          class="input"
          type="password"
          autocomplete="new-password"
          required
        />
        <FieldError :field="fields.password" />
        <span class="field__hint">{{ $t("auth.setup.passwordHint", { min: MIN_PASSWORD_LENGTH }) }}</span>
      </label>
      <label class="field">
        {{ $t("auth.setup.repeat") }}
        <input
          v-model="repeat"
          v-bind="fields.repeat.attrs.value"
          class="input"
          type="password"
          autocomplete="new-password"
          required
        />
        <FieldError :field="fields.repeat" />
      </label>
      <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      <button type="submit" class="btn btn--primary" :disabled="busy">
        {{ $t("auth.setup.next") }}
      </button>
    </form>

    <form v-else class="form" novalidate @submit.prevent="finish(true)">
      <h2>{{ $t("auth.totp.title") }}</h2>
      <p class="muted">{{ $t("auth.totp.recommended") }}</p>
      <TotpEnroll :totp="totp" />
      <CodeInput v-model="code" :label="$t('auth.code')" :field="codeField" required />
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
