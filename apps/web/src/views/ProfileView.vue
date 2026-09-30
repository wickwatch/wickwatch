<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, type TotpSetup } from "../api";
import AppModal from "../components/AppModal.vue";
import CodeInput from "../components/CodeInput.vue";
import FieldError from "../components/FieldError.vue";
import IconButton from "../components/IconButton.vue";
import TotpEnroll from "../components/TotpEnroll.vue";
import { useAsyncAction } from "../composables/useAsyncAction";
import { currentUser, loadSession } from "../session";
import { checks, MIN_PASSWORD_LENGTH, useValidation } from "../validation";

const totp = ref<TotpSetup>();
const code = ref("");
const password = ref("");
const { t } = useI18n();
const { busy, error, notice, run } = useAsyncAction();

const startEnable = () =>
  run(async () => {
    totp.value = await api.totpSetup();
  });

const enableForm = useValidation();
const codeField = enableForm.field(() => code.value, checks.required, checks.code);
const disableForm = useValidation();
const passwordField = disableForm.field(() => password.value, checks.required);

const confirmEnable = () =>
  run(
    async () => {
      if (!enableForm.validate()) return false;
      await api.totpEnable(code.value);
      totp.value = undefined;
      code.value = "";
      enableForm.reset();
      await loadSession();
    },
    { done: () => t("profile.totpEnabledNotice") },
  );

// --- password, changed in the shared modal like the other edits
const changing = ref(false);
const pw = reactive({ current: "", next: "", repeat: "" });
const pwForm = useValidation();
const pwFields = {
  current: pwForm.field(() => pw.current, checks.required),
  next: pwForm.field(() => pw.next, checks.required, checks.minLength(MIN_PASSWORD_LENGTH)),
  repeat: pwForm.field(
    () => pw.repeat,
    checks.required,
    checks.sameAs(() => pw.next),
  ),
};
const pwError = ref<string>();
const pwDirty = computed(() => Object.values(pw).some((v) => v !== ""));
function openPassword() {
  Object.assign(pw, { current: "", next: "", repeat: "" });
  pwError.value = undefined;
  pwForm.reset();
  changing.value = true;
}
function closePassword() {
  changing.value = false;
  Object.assign(pw, { current: "", next: "", repeat: "" });
  pwForm.reset();
}
function savePassword() {
  if (!pwForm.validate()) return;
  void run(
    async () => {
      await api.changePassword(pw.current, pw.next);
      closePassword();
    },
    { done: () => t("profile.passwordChanged"), error: pwError },
  );
}

const disable = () =>
  run(
    async () => {
      if (!disableForm.validate()) return false;
      await api.totpDisable(password.value);
      password.value = "";
      disableForm.reset();
      await loadSession();
    },
    { done: () => t("profile.totpDisabledNotice") },
  );
</script>

<template>
  <div class="account">
    <h1>{{ $t("profile.title") }}</h1>
    <p class="status" role="status" aria-live="polite">{{ notice }}</p>
    <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>

    <template v-if="currentUser">
      <section class="panel card">
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
      </section>

      <section class="panel card" aria-labelledby="password-title">
        <div class="card__head">
          <h2 id="password-title">{{ $t("auth.password") }}</h2>
          <IconButton icon="key" :label="$t('profile.changePassword')" show-label @click="openPassword" />
        </div>
        <p class="muted">{{ $t("profile.passwordHint") }}</p>
      </section>

      <section class="panel card" aria-labelledby="totp-title">
        <div class="card__head">
          <h2 id="totp-title">{{ $t("auth.totp.title") }}</h2>
          <span class="pill" :class="currentUser.totpEnabled ? 'tone-positive' : 'tone-warning'">
            {{ currentUser.totpEnabled ? $t("profile.totpOn") : $t("profile.totpOff") }}
          </span>
        </div>

        <template v-if="!currentUser.totpEnabled">
          <p class="muted">{{ $t("auth.totp.recommended") }}</p>
          <div>
            <button v-if="!totp" type="button" class="btn btn--primary" :disabled="busy" @click="startEnable">
              {{ $t("profile.enableTotp") }}
            </button>
          </div>
          <form v-if="totp" class="form" novalidate @submit.prevent="confirmEnable">
            <TotpEnroll :totp="totp" />
            <CodeInput v-model="code" :label="$t('auth.code')" :field="codeField" required />
            <div>
              <button type="submit" class="btn btn--primary" :disabled="busy">{{ $t("profile.confirmTotp") }}</button>
            </div>
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
          <div>
            <button type="submit" class="btn btn--danger" :disabled="busy">{{ $t("profile.disableTotp") }}</button>
          </div>
        </form>
      </section>
    </template>

    <AppModal :open="changing" :title="$t('profile.changePassword')" :dirty="pwDirty" @close="closePassword">
      <template #default="{ close }">
        <form class="form" novalidate @submit.prevent="savePassword">
          <!-- For password managers: the account the new password belongs to. -->
          <input
            class="visually-hidden"
            type="text"
            autocomplete="username"
            :value="currentUser?.username"
            tabindex="-1"
            aria-hidden="true"
            readonly
          />
          <label class="field">
            {{ $t("profile.currentPassword") }}
            <input
              v-model="pw.current"
              v-bind="pwFields.current.attrs.value"
              class="input"
              type="password"
              autocomplete="current-password"
              required
            />
            <FieldError :field="pwFields.current" />
          </label>
          <label class="field">
            {{ $t("profile.newPassword") }}
            <input
              v-model="pw.next"
              v-bind="pwFields.next.attrs.value"
              class="input"
              type="password"
              autocomplete="new-password"
              required
            />
            <FieldError :field="pwFields.next" />
            <span class="field__hint">{{ $t("auth.setup.passwordHint", { min: MIN_PASSWORD_LENGTH }) }}</span>
          </label>
          <label class="field">
            {{ $t("auth.setup.repeat") }}
            <input
              v-model="pw.repeat"
              v-bind="pwFields.repeat.attrs.value"
              class="input"
              type="password"
              autocomplete="new-password"
              required
            />
            <FieldError :field="pwFields.repeat" />
          </label>
          <div class="buttons">
            <button type="submit" class="btn btn--primary" :disabled="busy">{{ $t("action.save") }}</button>
            <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.cancel") }}</button>
          </div>
          <p v-if="pwError" class="tone-negative" role="alert">{{ $t(pwError) }}</p>
        </form>
      </template>
    </AppModal>
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

.card__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  justify-content: space-between;
  align-items: center;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}

h2 {
  font-size: var(--ww-size-lg);
}

p {
  margin: 0;
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

  /* Section actions go below the heading at full width, with their text, like the page heads. */
  .card__head > .btn {
    width: 100%;
  }
}
</style>
