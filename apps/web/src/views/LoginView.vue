<script setup lang="ts">
import { nextTick, ref, useId } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError, errorKey } from "../api";
import AuthCard from "../components/AuthCard.vue";
import CodeInput from "../components/CodeInput.vue";
import FieldError from "../components/FieldError.vue";
import IconButton from "../components/IconButton.vue";
import { loadSession, session } from "../session";
import { checks, useValidation } from "../validation";

const router = useRouter();
const route = useRoute();
const username = ref("");
const password = ref("");
const code = ref("");
/** "Stay logged in", on by default: 30 days instead of the browser session (ending after 12 hours idle at the latest). */
const remember = ref(true);
/** The explanation behind the info button, opened by a click or tap (touch has no hover), as in ParameterName. */
const rememberInfo = ref(false);
const rememberInfoId = useId();
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
      remember: remember.value,
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
      <div class="remember">
        <label class="check">
          <input v-model="remember" type="checkbox" />
          {{ $t("auth.login.remember") }}
        </label>
        <IconButton
          icon="info"
          :label="$t('auth.login.rememberAbout')"
          :tooltip="$t('auth.login.rememberHint')"
          variant="ghost"
          small
          class="remember__info"
          data-tooltip-wrap
          :aria-expanded="rememberInfo"
          :aria-controls="rememberInfoId"
          @click="rememberInfo = !rememberInfo"
        />
      </div>
      <p v-show="rememberInfo" :id="rememberInfoId" class="muted remember__hint">
        {{ $t("auth.login.rememberHint") }}
      </p>
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

.check {
  display: flex;
  gap: var(--ww-space-2);
  align-items: center;
  font-size: var(--ww-size-sm);
}

.check input {
  accent-color: var(--ww-accent);
}

.remember {
  display: flex;
  gap: var(--ww-space-1);
  align-items: center;
}

/* Smaller than a row action: it sits inside the text line, like ParameterName's info button. */
.remember__info {
  flex: none;
  width: 24px;
  min-width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  color: var(--ww-text-muted);
}

.remember__hint {
  margin-top: calc(-1 * var(--ww-space-2));
  font-size: var(--ww-size-xs);
}

@media (pointer: coarse) {
  .remember__info {
    width: var(--ww-control-sm-touch);
    height: var(--ww-control-sm-touch);
  }
}
</style>
