<script setup lang="ts">
import type { InstanceSummary } from "@wickwatch/core";
import { isUp } from "@wickwatch/core/rules";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { InstanceAction } from "../api";
import { accountLabel, durationParts } from "../format";
import { useLogStream } from "../composables/useLogStream";
import IconButton from "./IconButton.vue";
import LogDialog from "./LogDialog.vue";
import MarketBadge from "./MarketBadge.vue";
import SignedValue from "./SignedValue.vue";
import StatusBadge from "./StatusBadge.vue";

const props = withDefaults(
  defineProps<{
    instances: InstanceSummary[];
    accountNames: ReadonlyMap<string, string>;
    busy: ReadonlyMap<string, InstanceAction>;
    now: number;
    /** Viewers see no start, stop and restart; the log is open to them. */
    canAct: boolean;
    /** Off on the account page, where every row is on that account. */
    showAccount?: boolean;
  }>(),
  { showAccount: true },
);
defineEmits<{ action: [instance: InstanceSummary, action: InstanceAction] }>();

const { t } = useI18n();
const uptime = (instance: InstanceSummary, now: number) => {
  if (instance.status !== "running" || !instance.startedAt) return t("format.none");
  const { key, params } = durationParts(instance.startedAt, now);
  return t(key, params);
};

/** The instance whose log is open in the larger view; its status comes from the rows as they update. */
const logRef = ref<string>();
const logInstance = computed(() => props.instances.find((i) => i.ref === logRef.value));
const log = useLogStream(() =>
  logInstance.value ? { ref: logInstance.value.ref, running: isUp(logInstance.value.status) } : undefined,
);
</script>

<template>
  <div class="panel table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th scope="col">{{ $t("table.instance") }}</th>
          <th v-if="showAccount" scope="col" class="wide">{{ $t("table.account") }}</th>
          <th scope="col" class="wide">{{ $t("table.symbol") }}</th>
          <th scope="col" class="wide">{{ $t("table.period") }}</th>
          <th scope="col">{{ $t("table.status") }}</th>
          <th scope="col" class="wide">{{ $t("table.market") }}</th>
          <th scope="col" class="wide">{{ $t("table.uptime") }}</th>
          <th scope="col" class="wide num">{{ $t("table.positions") }}</th>
          <th scope="col" class="num">{{ $t("table.dayPnl") }}</th>
          <th scope="col" class="wide">{{ $t("table.lastLog") }}</th>
          <th scope="col" class="num">{{ $t("table.actions") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="instance in instances" :key="instance.ref">
          <th scope="row">
            <RouterLink :to="{ name: 'instance', params: { ref: instance.ref } }" class="mono name">{{
              instance.name
            }}</RouterLink>
            <!-- Compact meta line for narrow screens, where the detail columns are hidden. -->
            <span class="narrow muted mono meta">{{
              [instance.symbol, instance.period].filter(Boolean).join(" · ")
            }}</span>
            <!-- The market column is hidden there too; its badge moves under the name. -->
            <MarketBadge v-if="instance.marketHours" class="narrow" :hours="instance.marketHours" :now="now" short />
          </th>
          <td v-if="showAccount" class="wide">
            {{
              instance.account
                ? accountLabel({ displayName: accountNames.get(instance.account), number: instance.account })
                : $t("format.none")
            }}
          </td>
          <td class="wide mono">{{ instance.symbol ?? $t("format.none") }}</td>
          <td class="wide mono">{{ instance.period ?? $t("format.none") }}</td>
          <td><StatusBadge :instance="instance.status" :connection-lost="!!instance.connectionLostSince" /></td>
          <td class="wide">
            <MarketBadge v-if="instance.marketHours" :hours="instance.marketHours" :now="now" short />
            <span v-else class="muted">{{ $t("format.none") }}</span>
          </td>
          <td class="wide mono muted">{{ uptime(instance, now) }}</td>
          <td class="wide mono num">{{ instance.openPositions }}</td>
          <td class="num"><SignedValue :value="instance.dayPnl" /></td>
          <td class="wide log mono" :class="instance.lastLog?.level ? `log--${instance.lastLog.level}` : ''">
            <span :title="instance.lastLog?.text">{{ instance.lastLog?.text ?? "" }}</span>
          </td>
          <td>
            <div class="actions">
              <IconButton
                icon="terminal"
                :label="$t('table.actionOn', { action: $t('log.show'), name: instance.name })"
                small
                @click="logRef = instance.ref"
              />
              <template v-if="canAct">
                <IconButton
                  v-if="isUp(instance.status)"
                  icon="stop"
                  :label="$t('table.actionOn', { action: $t('action.stop'), name: instance.name })"
                  small
                  :disabled="busy.has(instance.ref)"
                  :aria-busy="busy.get(instance.ref) === 'stop'"
                  @click="$emit('action', instance, 'stop')"
                />
                <IconButton
                  v-else
                  icon="play"
                  :label="$t('table.actionOn', { action: $t('action.start'), name: instance.name })"
                  small
                  :disabled="busy.has(instance.ref)"
                  :aria-busy="busy.get(instance.ref) === 'start'"
                  @click="$emit('action', instance, 'start')"
                />
                <IconButton
                  class="wide"
                  icon="restart"
                  :label="$t('table.actionOn', { action: $t('action.restart'), name: instance.name })"
                  small
                  :disabled="busy.has(instance.ref)"
                  :aria-busy="busy.get(instance.ref) === 'restart'"
                  @click="$emit('action', instance, 'restart')"
                />
              </template>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <LogDialog
      :open="logInstance !== undefined"
      :title="logInstance ? $t('table.actionOn', { action: $t('instance.liveLog'), name: logInstance.name }) : ''"
      :instance-ref="logInstance?.ref ?? ''"
      :lines="log.lines.value"
      :state="log.state.value"
      @close="logRef = undefined"
    />
  </div>
</template>

<style scoped>
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
  padding: var(--ww-space-3) var(--ww-space-4);
  border-bottom: 1px solid var(--ww-border);
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
}

tbody tr:last-child > * {
  border-bottom: 0;
}

thead th {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

tbody th {
  font-weight: 600;
}

.name {
  display: block;
}

.num {
  text-align: right;
}

.log {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
}

.log--warn {
  color: var(--ww-warning);
}

.log--error {
  color: var(--ww-negative);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.narrow {
  display: none;
}

.meta {
  font-size: var(--ww-size-xs);
  font-weight: 400;
}

@media (max-width: 900px) {
  .wide {
    display: none;
  }

  th,
  td {
    padding: var(--ww-space-3) var(--ww-space-2);
  }

  thead th {
    letter-spacing: 0;
  }

  tr > :first-child {
    padding-left: var(--ww-space-3);
  }

  tr > :last-child {
    padding-right: var(--ww-space-3);
  }

  .narrow {
    display: block;
  }
}
</style>
