<script setup lang="ts">
import type { AccountDeal, InstanceSummary } from "@wickwatch/core";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../api";
import { useAsyncAction } from "../composables/useAsyncAction";
import AppModal from "./AppModal.vue";

/** The trade to attribute: a position, or a deal by its position (its other deals follow). */
export type AttributedTrade = Pick<AccountDeal, "positionId" | "symbol" | "instance" | "manual">;
/** `undefined`: the rules decide; `null`: no instance. */
type Choice = string | null | undefined;

/**
 * Attributes a position (and its deals) by hand: to one of the account's instances, to none, or back to the rules.
 * For trades the rules cannot place, e.g. one opened by hand next to two bots on the same symbol.
 */
const props = defineProps<{
  open: boolean;
  account: string;
  trade: AttributedTrade | undefined;
  instances: InstanceSummary[];
}>();
const emit = defineEmits<{ close: []; saved: [message: string] }>();
const { t } = useI18n();
const { busy, error, run } = useAsyncAction();

/**
 * The select holds a key, not the choice itself: Vue compares option values as strings, so `null` and `undefined`
 * would match instances named like that.
 */
const keyOf = (choice: Choice) => (choice === undefined ? "auto" : choice === null ? "none" : `=${choice}`);
const choices = computed<{ value: Choice; label: string }[]>(() => [
  { value: undefined, label: t("attribution.automatic") },
  { value: null, label: t("trade.noInstance") },
  ...props.instances.map((i) => ({ value: i.name, label: i.name })),
]);
const current = computed<Choice>(() => (props.trade?.manual ? (props.trade.instance ?? null) : undefined));
const selected = ref(keyOf(undefined));
const unchanged = computed(() => selected.value === keyOf(current.value));

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    selected.value = keyOf(current.value);
    error.value = undefined;
  },
);

function save() {
  const trade = props.trade;
  const choice = choices.value.find((c) => keyOf(c.value) === selected.value);
  if (!trade || !choice) return;
  const { value } = choice;
  void run(async () => {
    if (value === undefined) await api.clearAttribution(props.account, trade.positionId);
    else await api.setAttribution(props.account, trade.positionId, value);
    const key = value === undefined ? "attribution.byRules" : value === null ? "attribution.toNone" : "attribution.to";
    emit("saved", t(key, { id: trade.positionId, instance: value ?? "" }));
  });
}
</script>

<template>
  <AppModal :open="open" :title="$t('attribution.assignTitle')" :dirty="!unchanged" @close="emit('close')">
    <template #default="{ close }">
      <form class="form" novalidate @submit.prevent="save">
        <p v-if="trade" class="muted">
          {{ $t("attribution.assignHint", { id: trade.positionId, symbol: trade.symbol }) }}
        </p>
        <label class="field">
          {{ $t("table.instance") }}
          <select v-model="selected" class="input">
            <option v-for="c in choices" :key="keyOf(c.value)" :value="keyOf(c.value)">{{ c.label }}</option>
          </select>
        </label>
        <div class="buttons">
          <button type="submit" class="btn btn--primary" :disabled="busy || unchanged" :aria-busy="busy">
            {{ $t("action.save") }}
          </button>
          <button type="button" class="btn btn--ghost" @click="close()">{{ $t("action.cancel") }}</button>
        </div>
        <p v-if="error" class="tone-negative" role="alert">{{ $t(error) }}</p>
      </form>
    </template>
  </AppModal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--ww-space-4);
  min-width: 0;
}

.form p {
  margin: 0;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ww-space-2);
}
</style>
