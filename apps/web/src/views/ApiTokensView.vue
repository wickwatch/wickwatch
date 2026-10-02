<script setup lang="ts">
import { API_TOKEN_EXPIRY_DAYS } from "@wickwatch/core/rules";
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, type ApiToken, type CreatedApiToken } from "../api";
import AppModal from "../components/AppModal.vue";
import AppSpinner from "../components/AppSpinner.vue";
import CodeInput from "../components/CodeInput.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import FieldError from "../components/FieldError.vue";
import IconButton from "../components/IconButton.vue";
import { useAsyncAction } from "../composables/useAsyncAction";
import { formatDateTime } from "../format";
import { currentUser, isAdmin } from "../session";
import { system } from "../system";
import { checks, useValidation } from "../validation";

/** API tokens for scripts and MCP clients, for admins. A token is shown once, right after it was created. */
const { t, locale } = useI18n();
const tokens = ref<ApiToken[]>([]);
const loading = ref(true);
const removing = ref<ApiToken>();
const mcpUrl = api.mcpUrl();
/** Off with MCP=off on the server; until /system has loaded it counts as on, the default. */
const mcpOn = computed(() => system.value?.mcp !== false);
const totpOn = computed(() => currentUser.value?.totpEnabled === true);
/** API_TOKENS_REQUIRE_2FA=on and this user has no 2FA: creating is refused, so the page says why instead. */
const needs2fa = computed(() => system.value?.apiTokensRequire2fa === true && !totpOn.value);

async function load() {
  tokens.value = await api.apiTokens();
}
const { busy, running, error, notice, run } = useAsyncAction({ reload: load });

onMounted(() => {
  if (isAdmin.value) void run(async () => undefined).finally(() => (loading.value = false));
  else loading.value = false;
});

// --- create, in the shared modal; afterwards the same modal shows the new token once
const DEFAULT_EXPIRY = "90";
const creating = ref(false);
const draft = reactive({
  name: "",
  role: "viewer" as ApiToken["role"],
  expiry: DEFAULT_EXPIRY,
  password: "",
  code: "",
});
const created = ref<CreatedApiToken>();
const createError = ref<string>();
const copied = ref(false);
const form = useValidation();
const nameField = form.field(() => draft.name, checks.required);
const passwordField = form.field(() => draft.password, checks.required);
const codeField = form.field(
  () => draft.code,
  (value) => (totpOn.value ? checks.required(value) : undefined),
  (value) => (totpOn.value ? checks.code(value) : undefined),
);
const createDirty = computed(() => !created.value && draft.name !== "");

function openCreate() {
  Object.assign(draft, { name: "", role: "viewer", expiry: DEFAULT_EXPIRY, password: "", code: "" });
  created.value = undefined;
  createError.value = undefined;
  copied.value = false;
  form.reset();
  creating.value = true;
}
function closeCreate() {
  creating.value = false;
  // The token leaves the page with the modal; only its prefix stays in the list.
  created.value = undefined;
  Object.assign(draft, { password: "", code: "" });
  form.reset();
}
function create() {
  if (!form.validate()) return;
  void run(
    async () => {
      try {
        created.value = await api.createApiToken({
          name: draft.name.trim(),
          role: draft.role,
          ...(draft.expiry ? { expiresInDays: Number(draft.expiry) } : {}),
          password: draft.password,
          ...(totpOn.value ? { code: draft.code } : {}),
        });
      } catch (e) {
        // Like the login: a code that did not work is not sent again.
        draft.code = "";
        throw e;
      }
      Object.assign(draft, { password: "", code: "" });
      return created.value;
    },
    { done: (token) => t("apiTokens.created", { name: token.name }), error: createError, as: "create" },
  );
}
async function copy() {
  if (!created.value) return;
  try {
    await navigator.clipboard.writeText(created.value.token);
    copied.value = true;
  } catch {
    // No clipboard (e.g. plain HTTP): the field is selected, to copy by hand.
    document.querySelector<HTMLInputElement>("#api-token-value")?.select();
  }
}

const confirmRemove = () => {
  const token = removing.value;
  removing.value = undefined;
  if (token)
    void run(() => api.deleteApiToken(token.id), {
      done: () => t("apiTokens.deleted", { name: token.name }),
      as: `remove-${token.id}`,
    });
};
</script>

<template>
  <div class="page">
    <div class="head">
      <h1>{{ $t("apiTokens.title") }}</h1>
      <IconButton
        v-if="isAdmin && !needs2fa"
        icon="plus"
        :label="$t('apiTokens.create')"
        show-label
        class="head__action"
        @click="openCreate"
      />
      <p class="muted intro">{{ $t("apiTokens.intro") }}</p>
    </div>
    <p v-if="!isAdmin" class="tone-negative" role="alert">{{ $t("error.api.forbidden") }}</p>

    <template v-else>
      <p v-if="needs2fa" class="tone-warning">
        {{ $t("apiTokens.needs2fa") }}
        <RouterLink :to="{ name: 'profile' }">{{ $t("apiTokens.setUp2fa") }}</RouterLink>
      </p>
      <p class="status" role="status" aria-live="polite">{{ notice }}</p>
      <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>

      <section class="panel card" aria-labelledby="mcp-title">
        <div class="card__head">
          <h2 id="mcp-title">{{ $t("apiTokens.mcpTitle") }}</h2>
          <span class="pill" :class="mcpOn ? 'tone-positive' : 'tone-muted'">
            {{ mcpOn ? $t("apiTokens.mcpOn") : $t("apiTokens.mcpOff") }}
          </span>
        </div>
        <p class="muted">{{ mcpOn ? $t("apiTokens.mcpIntro") : $t("apiTokens.mcpOffHint") }}</p>
        <dl v-if="mcpOn" class="facts">
          <div>
            <dt>{{ $t("apiTokens.mcpUrl") }}</dt>
            <dd class="mono">{{ mcpUrl }}</dd>
          </div>
          <div>
            <dt>{{ $t("apiTokens.mcpHeader") }}</dt>
            <dd class="mono">{{ $t("apiTokens.mcpHeaderValue") }}</dd>
          </div>
        </dl>
      </section>

      <AppSpinner v-if="loading" />
      <section v-else class="panel card" :aria-label="$t('apiTokens.title')">
        <p v-if="!tokens.length" class="muted">{{ $t("apiTokens.none") }}</p>
        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ $t("apiTokens.name") }}</th>
                <th scope="col">{{ $t("apiTokens.token") }}</th>
                <th scope="col">{{ $t("profile.role") }}</th>
                <th scope="col">{{ $t("apiTokens.user") }}</th>
                <th scope="col">{{ $t("apiTokens.createdAt") }}</th>
                <th scope="col">{{ $t("apiTokens.expiresAt") }}</th>
                <th scope="col">{{ $t("apiTokens.lastUsed") }}</th>
                <th scope="col">
                  <span class="visually-hidden">{{ $t("table.actions") }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="token in tokens" :key="token.id">
                <td>{{ token.name }}</td>
                <td class="mono">{{ $t("apiTokens.prefix", { prefix: token.prefix }) }}</td>
                <td>{{ $t(`profile.roles.${token.role}`) }}</td>
                <td>{{ token.user }}</td>
                <td class="mono">{{ formatDateTime(locale, token.createdAt) }}</td>
                <td>
                  <span v-if="token.expired" class="pill tone-negative">{{ $t("apiTokens.expired") }}</span>
                  <span v-else-if="token.expiresAt" class="mono">{{ formatDateTime(locale, token.expiresAt) }}</span>
                  <template v-else>{{ $t("apiTokens.never") }}</template>
                </td>
                <td class="mono">
                  {{ token.lastUsedAt ? formatDateTime(locale, token.lastUsedAt) : $t("apiTokens.unused") }}
                </td>
                <td class="actions">
                  <button
                    type="button"
                    class="btn btn--danger btn--small"
                    :disabled="busy"
                    :aria-busy="running === `remove-${token.id}`"
                    @click="removing = token"
                  >
                    {{ $t("action.delete") }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <AppModal :open="creating" :title="$t('apiTokens.create')" :dirty="createDirty" @close="closeCreate">
      <template #default="{ close }">
        <div v-if="created" class="form">
          <p class="tone-warning" role="alert">{{ $t("apiTokens.copyNow") }}</p>
          <label class="field">
            {{ $t("apiTokens.token") }}
            <input
              id="api-token-value"
              class="input mono"
              type="text"
              :value="created.token"
              readonly
              spellcheck="false"
              @focus="($event.target as HTMLInputElement).select()"
            />
          </label>
          <div class="buttons">
            <button type="button" class="btn btn--primary" @click="copy">
              {{ copied ? $t("apiTokens.copied") : $t("apiTokens.copy") }}
            </button>
            <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.done") }}</button>
          </div>
        </div>
        <form v-else class="form" novalidate @submit.prevent="create">
          <label class="field">
            {{ $t("apiTokens.name") }}
            <input
              v-model="draft.name"
              v-bind="nameField.attrs.value"
              class="input"
              maxlength="64"
              autocomplete="off"
              required
            />
            <FieldError :field="nameField" />
            <span class="field__hint">{{ $t("apiTokens.nameHint") }}</span>
          </label>
          <label class="field">
            {{ $t("profile.role") }}
            <select v-model="draft.role" class="input">
              <option value="viewer">{{ $t("profile.roles.viewer") }}</option>
              <option value="admin">{{ $t("profile.roles.admin") }}</option>
            </select>
            <span class="field__hint">{{ $t("apiTokens.roleHint") }}</span>
          </label>
          <label class="field">
            {{ $t("apiTokens.expiry") }}
            <select v-model="draft.expiry" class="input">
              <option v-for="days in API_TOKEN_EXPIRY_DAYS" :key="days" :value="String(days)">
                {{ $t("apiTokens.days", { days }) }}
              </option>
              <option value="">{{ $t("apiTokens.never") }}</option>
            </select>
          </label>
          <!-- For password managers: the account the password belongs to. -->
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
            {{ $t("apiTokens.password") }}
            <input
              v-model="draft.password"
              v-bind="passwordField.attrs.value"
              class="input"
              type="password"
              autocomplete="current-password"
              required
            />
            <FieldError :field="passwordField" />
            <span class="field__hint">{{ $t("apiTokens.confirmHint") }}</span>
          </label>
          <CodeInput v-if="totpOn" v-model="draft.code" :label="$t('auth.code')" :field="codeField" required />
          <div class="buttons">
            <button type="submit" class="btn btn--primary" :disabled="busy" :aria-busy="running === 'create'">
              {{ $t("apiTokens.create") }}
            </button>
            <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.cancel") }}</button>
          </div>
          <p v-if="createError" class="tone-negative" role="alert">{{ $t(createError) }}</p>
        </form>
      </template>
    </AppModal>
    <ConfirmDialog
      :open="removing !== undefined"
      :title="$t('action.delete')"
      :message="removing ? $t('apiTokens.deleteConfirm', { name: removing.name }) : ''"
      :confirm-label="$t('action.delete')"
      @confirm="confirmRemove"
      @cancel="removing = undefined"
    />
  </div>
</template>

<style scoped>
.head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "title action"
    "intro intro";
  gap: var(--ww-space-2) var(--ww-space-4);
  align-items: center;
}

.head h1 {
  grid-area: title;
  margin: 0;
}

.head .intro {
  grid-area: intro;
  margin: 0;
}

.head__action {
  grid-area: action;
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

h2 {
  font-size: var(--ww-size-lg);
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
  overflow-wrap: anywhere;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}

.table-wrap {
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
  vertical-align: middle;
}

tbody tr:last-child > * {
  border-bottom: 0;
}

thead th {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
  font-weight: 600;
}

.actions {
  text-align: right;
}

@media (max-width: 640px) {
  .head {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "title"
      "intro"
      "action";
  }

  .head__action {
    width: 100%;
    margin-top: var(--ww-space-2);
  }

  .facts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
