<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorKey, type AccountRow, type CredentialRow, type OfferedAccount } from "../api";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import FieldError from "../components/FieldError.vue";
import { isAdmin } from "../session";
import { checks, normalizers, useValidation, vNormalize } from "../validation";

const { t } = useI18n();
const accounts = ref<AccountRow[]>([]);
const credentials = ref<CredentialRow[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref<string>();
const notice = ref<string>();

async function load() {
  const [a, c] = await Promise.all([api.accounts(), isAdmin.value ? api.credentials() : Promise.resolve([])]);
  accounts.value = a;
  credentials.value = c;
}

async function run(action: () => Promise<void>, done?: string) {
  busy.value = true;
  error.value = undefined;
  notice.value = undefined;
  try {
    await action();
    await load();
    if (done) notice.value = done;
  } catch (e) {
    error.value = t(errorKey(e));
  } finally {
    busy.value = false;
  }
}

onMounted(() => void run(async () => undefined).finally(() => (loading.value = false)));

// --- editing an account
const editing = reactive({ id: 0, displayName: "", credentialId: 0 });
function startEdit(a: AccountRow) {
  Object.assign(editing, { id: a.id, displayName: a.displayName, credentialId: a.credentialId ?? 0 });
}
const saveEdit = () =>
  run(async () => {
    await api.updateAccount(editing.id, {
      displayName: editing.displayName.trim(),
      ...(editing.credentialId ? { credentialId: editing.credentialId } : {}),
    });
    editing.id = 0;
  }, t("accounts.saved"));

// --- removing
const removing = ref<{ kind: "account"; row: AccountRow } | { kind: "credential"; row: CredentialRow }>();
const removeMessage = computed(() => {
  const r = removing.value;
  if (!r) return "";
  return r.kind === "account"
    ? t("accounts.removeAccountConfirm", { name: r.row.displayName, number: r.row.number })
    : t("accounts.removeLoginConfirm", { label: r.row.label });
});
const confirmRemove = () => {
  const r = removing.value;
  removing.value = undefined;
  if (!r) return;
  void run(
    () => (r.kind === "account" ? api.deleteAccount(r.row.id) : api.deleteCredential(r.row.id)),
    t("accounts.removed"),
  );
};

// --- adding an account from the broker's list
const adding = reactive({ credentialId: 0, number: "", displayName: "" });
const selectable = (o: OfferedAccount) => !o.added && o.active !== false;
const choose = (o: OfferedAccount) => {
  adding.number = o.number;
  adding.displayName = o.name ?? "";
};
const offered = ref<OfferedAccount[]>();
const addForm = useValidation();
const loginChoice = addForm.field(() => adding.credentialId || "", checks.required);
const accountChoice = addForm.field(
  () => (offered.value ? adding.number : "-"),
  (v) => (v ? undefined : { key: "validation.chooseAccount" }),
);
const fetchOffered = () =>
  run(async () => {
    if (!addForm.validate()) return;
    offered.value = await api.brokerAccounts(adding.credentialId);
    const first = offered.value.find(selectable);
    adding.number = first?.number ?? "";
    adding.displayName = first?.name ?? "";
  });
const addAccount = () =>
  run(async () => {
    if (!addForm.validate()) return;
    await api.createAccount({
      number: adding.number,
      displayName: adding.displayName.trim() || adding.number,
      credentialId: adding.credentialId,
    });
    offered.value = undefined;
    Object.assign(adding, { credentialId: 0, number: "", displayName: "" });
    addForm.reset();
  }, t("accounts.added"));

// --- logins
const newLogin = reactive({ label: "", login: "", secret: "" });
const loginForm = useValidation();
const labelField = loginForm.field(() => newLogin.label, checks.required);
const loginField = loginForm.field(() => newLogin.login, checks.required);
const secretField = loginForm.field(() => newLogin.secret, checks.required);
const addLogin = () =>
  run(async () => {
    if (!loginForm.validate()) return;
    await api.createCredential({ ...newLogin, label: newLogin.label.trim() });
    Object.assign(newLogin, { label: "", login: "", secret: "" });
    loginForm.reset();
  }, t("accounts.loginAdded"));

const changingSecret = reactive({ id: 0, secret: "" });
const secretForm = useValidation();
const newSecretField = secretForm.field(() => changingSecret.secret, checks.required);
const saveSecret = () =>
  run(async () => {
    if (!secretForm.validate()) return;
    await api.updateCredential(changingSecret.id, { secret: changingSecret.secret });
    Object.assign(changingSecret, { id: 0, secret: "" });
    secretForm.reset();
  }, t("accounts.passwordChanged"));
</script>

<template>
  <div class="page">
    <h1>{{ $t("nav.accounts") }}</h1>
    <p class="status" role="status" aria-live="polite">{{ notice }}</p>
    <p v-if="error" class="tone-negative" role="alert">{{ error }}</p>
    <p v-if="loading" class="muted">{{ $t("overview.loading") }}</p>

    <template v-else>
      <section class="panel card" aria-labelledby="accounts-title">
        <h2 id="accounts-title">{{ $t("accounts.accounts") }}</h2>
        <p v-if="!accounts.length" class="muted">{{ $t("overview.noAccounts") }}</p>
        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ $t("accounts.name") }}</th>
                <th scope="col">{{ $t("table.account") }}</th>
                <th scope="col">{{ $t("accounts.broker") }}</th>
                <th scope="col">{{ $t("accounts.currency") }}</th>
                <th scope="col">{{ $t("accounts.login") }}</th>
                <th scope="col">{{ $t("challenge.label") }}</th>
                <th v-if="isAdmin" scope="col" class="num">{{ $t("table.actions") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in accounts" :key="a.id">
                <template v-if="editing.id === a.id">
                  <td>
                    <label class="visually-hidden" :for="`name-${a.id}`">{{ $t("accounts.name") }}</label>
                    <input :id="`name-${a.id}`" v-model="editing.displayName" class="input" maxlength="100" />
                  </td>
                  <td class="mono">{{ a.number }}</td>
                  <td>{{ a.broker }}</td>
                  <td class="mono">{{ a.currency }}</td>
                  <td>
                    <label class="visually-hidden" :for="`login-${a.id}`">{{ $t("accounts.login") }}</label>
                    <select :id="`login-${a.id}`" v-model="editing.credentialId" class="input">
                      <option v-for="c in credentials" :key="c.id" :value="c.id">{{ c.label }}</option>
                    </select>
                  </td>
                  <td></td>
                  <td class="actions">
                    <button
                      type="button"
                      class="btn btn--primary btn--small"
                      :disabled="busy || !editing.displayName.trim()"
                      @click="saveEdit"
                    >
                      {{ $t("action.save") }}
                    </button>
                    <button type="button" class="btn btn--ghost btn--small" @click="editing.id = 0">
                      {{ $t("action.cancel") }}
                    </button>
                  </td>
                </template>
                <template v-else>
                  <th scope="row">{{ a.displayName }}</th>
                  <td class="mono">{{ a.number }}</td>
                  <td>{{ a.broker }}</td>
                  <td class="mono">{{ a.currency }}</td>
                  <td>{{ a.credentialLabel ?? $t("format.none") }}</td>
                  <td>
                    <RouterLink v-if="isAdmin" :to="{ name: 'challenge', params: { number: a.number } }">
                      {{ a.hasChallenge ? $t("accounts.challengeSet") : $t("accounts.challengeAdd") }}
                    </RouterLink>
                    <span v-else>{{ a.hasChallenge ? $t("accounts.challengeSet") : $t("format.none") }}</span>
                  </td>
                  <td v-if="isAdmin" class="actions">
                    <button type="button" class="btn btn--small" :disabled="busy" @click="startEdit(a)">
                      {{ $t("action.edit") }}
                    </button>
                    <button
                      type="button"
                      class="btn btn--danger btn--small"
                      :disabled="busy"
                      @click="removing = { kind: 'account', row: a }"
                    >
                      {{ $t("accounts.remove") }}
                    </button>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <template v-if="isAdmin">
        <section class="panel card" aria-labelledby="add-title">
          <h2 id="add-title">{{ $t("accounts.addAccount") }}</h2>
          <p v-if="!credentials.length" class="muted">{{ $t("accounts.needLogin") }}</p>
          <form v-else class="form" novalidate @submit.prevent="offered ? addAccount() : fetchOffered()">
            <label class="field">
              {{ $t("accounts.login") }}
              <select
                v-model="adding.credentialId"
                v-bind="loginChoice.attrs.value"
                class="input"
                required
                @change="offered = undefined"
              >
                <option :value="0" disabled>{{ $t("accounts.chooseLogin") }}</option>
                <option v-for="c in credentials" :key="c.id" :value="c.id">
                  {{ $t("accounts.loginOption", { label: c.label, login: c.login }) }}
                </option>
              </select>
              <FieldError :field="loginChoice" />
            </label>
            <template v-if="offered">
              <fieldset class="offered">
                <legend>{{ $t("accounts.offered") }}</legend>
                <p v-if="!offered.length" class="muted">{{ $t("accounts.noneOffered") }}</p>
                <label v-for="o in offered" :key="o.number" class="offered__item" :class="{ muted: !selectable(o) }">
                  <input
                    v-bind="accountChoice.attrs.value"
                    type="radio"
                    name="offered"
                    :value="o.number"
                    :checked="adding.number === o.number"
                    :disabled="!selectable(o)"
                    @change="choose(o)"
                  />
                  <span class="mono">{{ o.number }}</span>
                  <span>{{
                    [o.name, o.broker, o.currency, o.live ? $t("accounts.live") : $t("accounts.demo")]
                      .filter(Boolean)
                      .join(" · ")
                  }}</span>
                  <span v-if="o.added">{{ $t("accounts.alreadyAdded") }}</span>
                  <span v-else-if="o.active === false">{{ $t("accounts.inactive") }}</span>
                </label>
                <FieldError :field="accountChoice" />
              </fieldset>
              <label class="field">
                {{ $t("accounts.name") }}
                <input v-model="adding.displayName" class="input" maxlength="100" :placeholder="adding.number" />
              </label>
            </template>
            <div class="buttons">
              <button v-if="!offered" type="submit" class="btn" :disabled="busy">
                {{ $t("accounts.fetchOffered") }}
              </button>
              <button v-else type="submit" class="btn btn--primary" :disabled="busy">
                {{ $t("accounts.addAccount") }}
              </button>
            </div>
          </form>
        </section>

        <section class="panel card" aria-labelledby="logins-title">
          <h2 id="logins-title">{{ $t("accounts.logins") }}</h2>
          <p class="muted hint">{{ $t("accounts.loginsHint") }}</p>
          <div v-if="credentials.length" class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">{{ $t("accounts.label") }}</th>
                  <th scope="col">{{ $t("accounts.loginName") }}</th>
                  <th scope="col" class="num">{{ $t("accounts.usedBy") }}</th>
                  <th scope="col" class="num">{{ $t("table.actions") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in credentials" :key="c.id">
                  <th scope="row">{{ c.label }}</th>
                  <td class="mono">{{ c.login }}</td>
                  <td class="mono num">{{ c.accounts }}</td>
                  <td class="actions">
                    <form v-if="changingSecret.id === c.id" class="inline" novalidate @submit.prevent="saveSecret">
                      <label class="visually-hidden" :for="`secret-${c.id}`">{{ $t("accounts.newPassword") }}</label>
                      <input
                        :id="`secret-${c.id}`"
                        v-model="changingSecret.secret"
                        v-bind="newSecretField.attrs.value"
                        class="input"
                        type="password"
                        autocomplete="new-password"
                        :placeholder="$t('accounts.newPassword')"
                        required
                      />
                      <FieldError :field="newSecretField" />
                      <button type="submit" class="btn btn--primary btn--small" :disabled="busy">
                        {{ $t("action.save") }}
                      </button>
                      <button type="button" class="btn btn--ghost btn--small" @click="changingSecret.id = 0">
                        {{ $t("action.cancel") }}
                      </button>
                    </form>
                    <template v-else>
                      <button type="button" class="btn btn--small" :disabled="busy" @click="changingSecret.id = c.id">
                        {{ $t("accounts.changePassword") }}
                      </button>
                      <!-- The reason sits on a wrapper: a disabled button gets no focus and would fade its tooltip. -->
                      <span
                        v-if="c.accounts > 0"
                        class="disabled-tip"
                        tabindex="0"
                        :data-tooltip="$t('accounts.loginInUse')"
                      >
                        <button
                          type="button"
                          class="btn btn--danger btn--small"
                          disabled
                          :aria-describedby="`in-use-${c.id}`"
                        >
                          {{ $t("accounts.remove") }}
                        </button>
                        <span :id="`in-use-${c.id}`" class="visually-hidden">{{ $t("accounts.loginInUse") }}</span>
                      </span>
                      <button
                        v-else
                        type="button"
                        class="btn btn--danger btn--small"
                        :disabled="busy"
                        @click="removing = { kind: 'credential', row: c }"
                      >
                        {{ $t("accounts.remove") }}
                      </button>
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <form class="form" novalidate @submit.prevent="addLogin">
            <h3>{{ $t("accounts.addLogin") }}</h3>
            <div class="grid">
              <label class="field">
                {{ $t("accounts.label") }}
                <input
                  v-model="newLogin.label"
                  v-bind="labelField.attrs.value"
                  class="input"
                  maxlength="100"
                  required
                />
                <FieldError :field="labelField" />
              </label>
              <label class="field">
                {{ $t("accounts.loginName") }}
                <input
                  v-model="newLogin.login"
                  v-normalize="normalizers.noSpaces"
                  v-bind="loginField.attrs.value"
                  class="input"
                  maxlength="200"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  required
                />
                <FieldError :field="loginField" />
              </label>
              <label class="field">
                {{ $t("auth.password") }}
                <input
                  v-model="newLogin.secret"
                  v-bind="secretField.attrs.value"
                  class="input"
                  type="password"
                  autocomplete="new-password"
                  required
                />
                <FieldError :field="secretField" />
              </label>
            </div>
            <p class="field__hint">{{ $t("accounts.encrypted") }}</p>
            <div class="buttons">
              <button type="submit" class="btn btn--primary" :disabled="busy">{{ $t("accounts.addLogin") }}</button>
            </div>
          </form>
        </section>
      </template>
    </template>

    <ConfirmDialog
      :open="removing !== undefined"
      :title="$t('accounts.remove')"
      :message="removeMessage"
      :confirm-label="$t('accounts.remove')"
      @confirm="confirmRemove"
      @cancel="removing = undefined"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-5);
  min-width: 0;
  padding: var(--ww-space-8) var(--ww-space-10);
}

.card,
.form {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
  min-width: 0;
}

.card {
  padding: var(--ww-space-5);
}

h3 {
  margin: var(--ww-space-2) 0 0;
  font-size: var(--ww-size-md);
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

.hint {
  font-size: var(--ww-size-sm);
}

.table-wrap {
  position: relative;
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ww-size-sm);
}

th,
td {
  padding: var(--ww-space-2) var(--ww-space-3);
  border-bottom: 1px solid var(--ww-border);
  text-align: left;
  white-space: nowrap;
}

tbody tr:last-child > * {
  border-bottom: 0;
}

thead th {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
  font-weight: 600;
}

tbody th {
  font-weight: 600;
}

.num {
  text-align: right;
}

.actions,
.inline,
.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
  align-items: center;
}

td.actions,
td .inline {
  justify-content: flex-end;
}

.disabled-tip {
  display: inline-flex;
  border-radius: var(--ww-radius-md);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--ww-space-4);
}

.offered {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

.offered legend {
  margin-bottom: var(--ww-space-2);
  font-size: var(--ww-size-sm);
}

.offered__item {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
  align-items: center;
  min-height: var(--ww-touch-target);
}

@media (max-width: 640px) {
  .page {
    padding: var(--ww-space-4);
  }
}
</style>
