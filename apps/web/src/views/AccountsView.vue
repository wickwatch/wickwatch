<script setup lang="ts">
import type { Account, Credential } from "@wickwatch/core";
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, type OfferedAccount } from "../api";
import AppModal from "../components/AppModal.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import FieldError from "../components/FieldError.vue";
import IconButton from "../components/IconButton.vue";
import { useAsyncAction } from "../composables/useAsyncAction";
import { isAdmin } from "../session";
import { checks, normalizers, useValidation, vNormalize } from "../validation";
import AppSpinner from "../components/AppSpinner.vue";

const { t } = useI18n();
const accounts = ref<Account[]>([]);
const credentials = ref<Credential[]>([]);
const loading = ref(true);

async function load() {
  const [a, c] = await Promise.all([api.accounts(), isAdmin.value ? api.credentials() : Promise.resolve([])]);
  accounts.value = a;
  credentials.value = c;
}
const { busy, running, error, notice, run } = useAsyncAction({ reload: load });

onMounted(() => void run(async () => undefined).finally(() => (loading.value = false)));

/** Which form is open in the modal (add or edit); its errors stay inside the modal. */
type ModalKind = "account" | "login" | "edit" | "password";
const modal = ref<ModalKind>();
const modalError = ref<string>();
/** `action` resolves to true when the modal's work is done; it then closes. */
const runInModal = (action: () => Promise<boolean>, done?: () => string) =>
  run(
    async () => {
      if (!(await action())) return false;
      closeModal();
    },
    { done, error: modalError },
  );
function openModal(kind: ModalKind) {
  modalError.value = undefined;
  // Also here: closing blurs the field, which marks it touched after closeModal() reset it.
  for (const form of [addForm, loginForm, editForm, secretForm]) form.reset();
  modal.value = kind;
}
function closeModal() {
  modal.value = undefined;
  offered.value = undefined;
  Object.assign(adding, { credentialId: 0, number: "", displayName: "" });
  Object.assign(newLogin, { label: "", login: "", secret: "" });
  Object.assign(changingSecret, { id: 0, label: "", secret: "" });
  for (const form of [addForm, loginForm, editForm, secretForm]) form.reset();
}
const modalTitle = computed(() => {
  switch (modal.value) {
    case "login":
      return t("accounts.addLogin");
    case "edit":
      return t("table.actionOn", { action: t("action.edit"), name: editing.original.displayName });
    case "password":
      return t("table.actionOn", { action: t("accounts.changePassword"), name: changingSecret.label });
    default:
      return t("accounts.addAccount");
  }
});
/** Typed input that closing would lose. */
const modalDirty = computed(() => {
  switch (modal.value) {
    case "account":
      return adding.credentialId !== 0;
    case "login":
      return Object.values(newLogin).some((v) => v !== "");
    case "edit":
      return (
        editing.displayName !== editing.original.displayName || editing.credentialId !== editing.original.credentialId
      );
    case "password":
      return changingSecret.secret !== "";
    default:
      return false;
  }
});

// --- editing an account (name and login), in the modal like adding
const editing = reactive({ id: 0, displayName: "", credentialId: 0, original: { displayName: "", credentialId: 0 } });
const editForm = useValidation();
const editNameField = editForm.field(() => editing.displayName.trim(), checks.required);
function startEdit(a: Account) {
  const values = { displayName: a.displayName, credentialId: a.credentialId ?? 0 };
  Object.assign(editing, { id: a.id, ...values, original: values });
  openModal("edit");
}
const saveEdit = () =>
  runInModal(
    async () => {
      if (!editForm.validate()) return false;
      await api.updateAccount(editing.id, {
        displayName: editing.displayName.trim(),
        ...(editing.credentialId ? { credentialId: editing.credentialId } : {}),
      });
      return true;
    },
    () => t("accounts.saved"),
  );

// --- removing
const removing = ref<{ kind: "account"; row: Account } | { kind: "credential"; row: Credential }>();
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
  void run(() => (r.kind === "account" ? api.deleteAccount(r.row.id) : api.deleteCredential(r.row.id)), {
    done: () => t("accounts.removed"),
    as: `remove-${r.kind}-${r.row.id}`,
  });
};

// --- adding an account from the broker's list
const adding = reactive({ credentialId: 0, number: "", displayName: "" });
const selectable = (o: OfferedAccount) => !o.added && o.active !== false;
// Selectable accounts first, then already added ones, inactive ones last; the broker's order within each group.
const offeredRank = (o: OfferedAccount) => (selectable(o) ? 0 : o.active === false ? 2 : 1);
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
  runInModal(async () => {
    if (!addForm.validate()) return false;
    offered.value = (await api.brokerAccounts(adding.credentialId)).sort((a, b) => offeredRank(a) - offeredRank(b));
    const first = offered.value.find(selectable);
    adding.number = first?.number ?? "";
    adding.displayName = first?.name ?? "";
    // The list shows in the modal; adding is the next step.
    return false;
  });
const addAccount = () =>
  runInModal(
    async () => {
      if (!addForm.validate()) return false;
      await api.createAccount({
        number: adding.number,
        displayName: adding.displayName.trim() || adding.number,
        credentialId: adding.credentialId,
      });
      return true;
    },
    () => t("accounts.added"),
  );

// --- logins
const newLogin = reactive({ label: "", login: "", secret: "" });
const loginForm = useValidation();
const labelField = loginForm.field(() => newLogin.label, checks.required);
const loginField = loginForm.field(() => newLogin.login, checks.required);
const secretField = loginForm.field(() => newLogin.secret, checks.required);
const addLogin = () =>
  runInModal(
    async () => {
      if (!loginForm.validate()) return false;
      await api.createCredential({ ...newLogin, label: newLogin.label.trim() });
      return true;
    },
    () => t("accounts.loginAdded"),
  );

const changingSecret = reactive({ id: 0, label: "", secret: "" });
const secretForm = useValidation();
const newSecretField = secretForm.field(() => changingSecret.secret, checks.required);
function startPasswordChange(c: Credential) {
  Object.assign(changingSecret, { id: c.id, label: c.label, secret: "" });
  openModal("password");
}
const saveSecret = () =>
  runInModal(
    async () => {
      if (!secretForm.validate()) return false;
      await api.updateCredential(changingSecret.id, { secret: changingSecret.secret });
      return true;
    },
    () => t("accounts.passwordChanged"),
  );
</script>

<template>
  <div class="page">
    <h1>{{ $t("nav.accounts") }}</h1>
    <p class="status" role="status" aria-live="polite">{{ notice }}</p>
    <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
    <AppSpinner v-if="loading" />

    <template v-else>
      <section class="panel card" aria-labelledby="accounts-title">
        <div class="card__head">
          <h2 id="accounts-title">{{ $t("accounts.accounts") }}</h2>
          <IconButton
            v-if="isAdmin"
            icon="plus"
            :label="$t('accounts.addAccount')"
            show-label
            @click="openModal('account')"
          />
        </div>
        <p v-if="!accounts.length" class="muted">{{ $t("overview.noAccounts") }}</p>
        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ $t("accounts.name") }}</th>
                <th scope="col" class="wide">{{ $t("table.account") }}</th>
                <th scope="col" class="wide">{{ $t("accounts.broker") }}</th>
                <th scope="col" class="wide">{{ $t("accounts.currency") }}</th>
                <th scope="col" class="wide">{{ $t("accounts.login") }}</th>
                <th scope="col" class="wide">{{ $t("challenge.label") }}</th>
                <th v-if="isAdmin" scope="col" class="num">{{ $t("table.actions") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in accounts" :key="a.id">
                <th scope="row">
                  <RouterLink :to="{ name: 'account', params: { number: a.number } }">{{ a.displayName }}</RouterLink>
                  <!-- Compact meta line for narrow screens, where the detail columns are hidden. -->
                  <span class="narrow muted mono meta">{{ [a.number, a.currency].join(" · ") }}</span>
                </th>
                <td class="mono wide">{{ a.number }}</td>
                <td class="wide">{{ a.broker }}</td>
                <td class="mono wide">{{ a.currency }}</td>
                <td class="wide">{{ a.credentialLabel ?? $t("format.none") }}</td>
                <td class="wide">
                  <!-- Maintained on the account page. -->
                  {{ a.hasChallenge ? $t("accounts.challengeSet") : $t("format.none") }}
                </td>
                <td v-if="isAdmin">
                  <div class="actions">
                    <IconButton
                      icon="edit"
                      :label="$t('table.actionOn', { action: $t('action.edit'), name: a.displayName })"
                      small
                      :disabled="busy"
                      @click="startEdit(a)"
                    />
                    <IconButton
                      icon="trash"
                      :label="$t('table.actionOn', { action: $t('accounts.remove'), name: a.displayName })"
                      variant="danger"
                      small
                      :disabled="busy"
                      :aria-busy="running === `remove-account-${a.id}`"
                      @click="removing = { kind: 'account', row: a }"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <template v-if="isAdmin">
        <section class="panel card" aria-labelledby="logins-title">
          <div class="card__head">
            <h2 id="logins-title">{{ $t("accounts.logins") }}</h2>
            <IconButton icon="plus" :label="$t('accounts.addLogin')" show-label @click="openModal('login')" />
          </div>
          <p class="muted hint">{{ $t("accounts.loginsHint") }}</p>
          <div v-if="credentials.length" class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">{{ $t("accounts.label") }}</th>
                  <th scope="col" class="wide">{{ $t("accounts.loginName") }}</th>
                  <th scope="col" class="num">{{ $t("accounts.usedBy") }}</th>
                  <th scope="col" class="num">{{ $t("table.actions") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in credentials" :key="c.id">
                  <th scope="row">
                    {{ c.label }}
                    <span class="narrow muted mono meta">{{ c.login }}</span>
                  </th>
                  <td class="mono wide">{{ c.login }}</td>
                  <td class="mono num">{{ c.accounts }}</td>
                  <td>
                    <div class="actions">
                      <IconButton
                        icon="key"
                        :label="$t('table.actionOn', { action: $t('accounts.changePassword'), name: c.label })"
                        small
                        :disabled="busy"
                        @click="startPasswordChange(c)"
                      />
                      <!-- The reason sits on a wrapper: a disabled button gets no focus and would fade its tooltip. -->
                      <span
                        v-if="c.accounts > 0"
                        class="disabled-tip"
                        tabindex="0"
                        :data-tooltip="$t('accounts.loginInUse')"
                      >
                        <IconButton
                          icon="trash"
                          :label="$t('table.actionOn', { action: $t('accounts.remove'), name: c.label })"
                          variant="danger"
                          small
                          disabled
                          :aria-describedby="`in-use-${c.id}`"
                        />
                        <span :id="`in-use-${c.id}`" class="visually-hidden">{{ $t("accounts.loginInUse") }}</span>
                      </span>
                      <IconButton
                        v-else
                        icon="trash"
                        :label="$t('table.actionOn', { action: $t('accounts.remove'), name: c.label })"
                        variant="danger"
                        small
                        :disabled="busy"
                        :aria-busy="running === `remove-credential-${c.id}`"
                        @click="removing = { kind: 'credential', row: c }"
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>

    <AppModal :open="modal !== undefined" :title="modalTitle" :dirty="modalDirty" @close="closeModal">
      <template v-if="modal === 'account'" #default="{ close }">
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
            <button v-if="!offered" type="submit" class="btn" :disabled="busy" :aria-busy="busy">
              {{ $t("accounts.fetchOffered") }}
            </button>
            <button v-else type="submit" class="btn btn--primary" :disabled="busy" :aria-busy="busy">
              {{ $t("accounts.addAccount") }}
            </button>
            <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.cancel") }}</button>
          </div>
          <p v-if="modalError" class="tone-negative" role="alert">{{ $t(modalError) }}</p>
        </form>
      </template>
      <template v-else-if="modal === 'edit'" #default="{ close }">
        <form class="form" novalidate @submit.prevent="saveEdit">
          <label class="field">
            {{ $t("accounts.name") }}
            <input
              v-model="editing.displayName"
              v-bind="editNameField.attrs.value"
              class="input"
              maxlength="100"
              required
            />
            <FieldError :field="editNameField" />
          </label>
          <label class="field">
            {{ $t("accounts.login") }}
            <select v-model="editing.credentialId" class="input">
              <option v-for="c in credentials" :key="c.id" :value="c.id">
                {{ $t("accounts.loginOption", { label: c.label, login: c.login }) }}
              </option>
            </select>
          </label>
          <div class="buttons">
            <button type="submit" class="btn btn--primary" :disabled="busy" :aria-busy="busy">
              {{ $t("action.save") }}
            </button>
            <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.cancel") }}</button>
          </div>
          <p v-if="modalError" class="tone-negative" role="alert">{{ $t(modalError) }}</p>
        </form>
      </template>
      <template v-else-if="modal === 'password'" #default="{ close }">
        <form class="form" novalidate @submit.prevent="saveSecret">
          <label class="field">
            {{ $t("accounts.newPassword") }}
            <input
              v-model="changingSecret.secret"
              v-bind="newSecretField.attrs.value"
              class="input"
              type="password"
              autocomplete="new-password"
              required
            />
            <FieldError :field="newSecretField" />
          </label>
          <p class="field__hint">{{ $t("accounts.encrypted") }}</p>
          <div class="buttons">
            <button type="submit" class="btn btn--primary" :disabled="busy" :aria-busy="busy">
              {{ $t("action.save") }}
            </button>
            <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.cancel") }}</button>
          </div>
          <p v-if="modalError" class="tone-negative" role="alert">{{ $t(modalError) }}</p>
        </form>
      </template>
      <template v-else #default="{ close }">
        <form class="form" novalidate @submit.prevent="addLogin">
          <div class="grid">
            <label class="field">
              {{ $t("accounts.label") }}
              <input v-model="newLogin.label" v-bind="labelField.attrs.value" class="input" maxlength="100" required />
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
            <button type="submit" class="btn btn--primary" :disabled="busy" :aria-busy="busy">
              {{ $t("accounts.addLogin") }}
            </button>
            <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.cancel") }}</button>
          </div>
          <p v-if="modalError" class="tone-negative" role="alert">{{ $t(modalError) }}</p>
        </form>
      </template>
    </AppModal>
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

.card__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-3);
  justify-content: space-between;
  align-items: center;
}

p {
  margin: 0;
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
.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
  align-items: center;
}

td .actions {
  flex-wrap: nowrap;
  justify-content: flex-end;
}

.meta {
  display: block;
  font-size: var(--ww-size-xs);
  font-weight: 400;
}

.narrow {
  display: none;
}

/* Phones: name, a compact meta line and the actions; the detail columns only on wider screens. */
@media (max-width: 640px) {
  /* Section actions go below the heading at full width, with their text, like the page heads. */
  .card__head > .btn {
    width: 100%;
  }

  .wide {
    display: none;
  }

  .narrow {
    display: block;
  }
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
</style>
