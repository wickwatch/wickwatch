<script setup lang="ts">
import { ref } from "vue";
import { api, errorKey, type TotpSetup } from "../api";
import CodeInput from "../components/CodeInput.vue";
import FieldError from "../components/FieldError.vue";
import TotpEnroll from "../components/TotpEnroll.vue";
import { currentUser, loadSession } from "../session";
import { checks, useValidation } from "../validation";

const totp = ref<TotpSetup>();
const code = ref("");
const password = ref("");
const error = ref<string>();
const notice = ref<string>();
const busy = ref(false);

async function run(action: () => Promise<void>) {
  busy.value = true;
  error.value = undefined;
  notice.value = undefined;
  try {
    await action();
  } catch (e) {
    error.value = errorKey(e);
  } finally {
    busy.value = false;
  }
}

const startEnable = () =>
  run(async () => {
    totp.value = await api.totpSetup();
  });

const enableForm = useValidation();
const codeField = enableForm.field(() => code.value, checks.required, checks.code);
const disableForm = useValidation();
const passwordField = disableForm.field(() => password.value, checks.required);

const confirmEnable = () =>
  run(async () => {
    if (!enableForm.validate()) return;
    await api.totpEnable(code.value);
    totp.value = undefined;
    code.value = "";
    enableForm.reset();
    await loadSession();
    notice.value = "profile.totpEnabledNotice";
  });

const disable = () =>
  run(async () => {
    if (!disableForm.validate()) return;
    await api.totpDisable(password.value);
    password.value = "";
    disableForm.reset();
    await loadSession();
    notice.value = "profile.totpDisabledNotice";
  });
</script>

<template>
  <div class="account">
    <h1>{{ $t("profile.title") }}</h1>
    <section v-if="currentUser" class="panel card" aria-labelledby="totp-title">
      <dl class="facts">
        <div>
          <dt>{{ $t("auth.username") }}</dt>
          <dd class="mono">{{ currentUser.username }}</dd>
        </div>
        <div>
          <dt>{{ $t("profile.role") }}</dt>
          <dd>{{ $t(`profile.roles.${currentUser.role}`) }}</dd>
        </div>
      </dl>

      <h2 id="totp-title">{{ $t("auth.totp.title") }}</h2>
      <p>
        <span class="pill" :class="currentUser.totpEnabled ? 'tone-positive' : 'tone-warning'">
          {{ currentUser.totpEnabled ? $t("profile.totpOn") : $t("profile.totpOff") }}
        </span>
      </p>

      <template v-if="!currentUser.totpEnabled">
        <p class="muted">{{ $t("auth.totp.recommended") }}</p>
        <button v-if="!totp" type="button" class="btn btn--primary" :disabled="busy" @click="startEnable">
          {{ $t("profile.enableTotp") }}
        </button>
        <form v-else class="form" novalidate @submit.prevent="confirmEnable">
          <TotpEnroll :totp="totp" />
          <CodeInput v-model="code" :label="$t('auth.code')" :field="codeField" required />
          <button type="submit" class="btn btn--primary" :disabled="busy">{{ $t("profile.confirmTotp") }}</button>
        </form>
      </template>

      <form v-else class="form" novalidate @submit.prevent="disable">
        <label class="field">
          {{ $t("profile.passwordToDisable") }}
          <input
            v-model="password"
            v-bind="passwordField.attrs.value"
            class="input"
            type="password"
            autocomplete="current-password"
            required
          />
          <FieldError :field="passwordField" />
        </label>
        <button type="submit" class="btn btn--danger" :disabled="busy">{{ $t("profile.disableTotp") }}</button>
      </form>

      <p class="status" role="status" aria-live="polite">{{ notice ? $t(notice) : "" }}</p>
      <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
    </section>
  </div>
</template>

<style scoped>
.account {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-6);
  max-width: 560px;
  padding: var(--ww-space-8) var(--ww-space-10);
}

.card,
.form {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
}

.card {
  padding: var(--ww-space-6);
}

h2 {
  font-size: var(--ww-size-lg);
}

p {
  margin: 0;
}

.status:empty {
  display: none;
}

.status {
  color: var(--ww-positive);
  font-weight: 600;
}

.facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ww-space-3);
  margin: 0;
}

dt {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
}

dd {
  margin: var(--ww-space-1) 0 0;
}

@media (max-width: 640px) {
  .account {
    padding: var(--ww-space-4);
  }
}
</style>
